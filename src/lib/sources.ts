import { and, eq, like, or } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import type { Env, SearchResult, SourceConfig, SourceType } from "../types";
import { encryptSecret } from "./crypto";
import { parseJsonObject, safeJson } from "./json";
import { catalogOpenApi, fetchOpenApiSpec } from "./openapi";

type Db = DrizzleD1Database<typeof schema>;

interface SourceInput {
  ownerId?: string | null;
  slug: string;
  type: SourceType;
  name?: string;
  baseUrl?: string;
  specUrl?: string;
  authType?: "none" | "bearer" | "header" | "oauth";
  authHeaderName?: string;
  secret?: string;
  metadata?: Record<string, unknown>;
}

export async function listSources(db: Db, ownerId: string | null = null): Promise<SourceConfig[]> {
  const rows = ownerId
    ? await db.select().from(schema.sources).where(eq(schema.sources.ownerId, ownerId))
    : await db.select().from(schema.sources);
  return rows.map(rowToSource);
}

export async function getSourceBySlug(db: Db, slug: string, ownerId: string | null = null): Promise<SourceConfig | null> {
  const where = ownerId
    ? and(eq(schema.sources.slug, slug), eq(schema.sources.ownerId, ownerId))
    : eq(schema.sources.slug, slug);
  const row = await db.select().from(schema.sources).where(where).get();
  return row ? rowToSource(row) : null;
}

export async function createSource(db: Db, env: Env, input: SourceInput): Promise<SourceConfig> {
  validateSource(input);
  const id = crypto.randomUUID();
  const source = {
    id,
    ownerId: input.ownerId ?? null,
    slug: input.slug,
    type: input.type,
    name: input.name ?? input.slug,
    baseUrl: input.baseUrl ?? null,
    specUrl: input.specUrl ?? null,
    authType: input.authType ?? "none",
    authHeaderName: input.authHeaderName ?? null,
    encryptedSecret: await encryptSecret(input.secret, env.ENCRYPTION_KEY),
    metadataJson: safeJson(input.metadata ?? {}),
    enabled: true
  };
  await db.insert(schema.sources).values(source).run();
  return rowToSource({ ...source, createdAt: new Date(), updatedAt: new Date() });
}

export async function deleteSource(db: Db, slug: string, ownerId: string | null = null): Promise<boolean> {
  const source = await getSourceBySlug(db, slug, ownerId);
  if (!source) return false;
  await db.delete(schema.sources).where(eq(schema.sources.id, source.id)).run();
  return true;
}

export async function refreshSourceCatalog(db: Db, env: Env, source: SourceConfig): Promise<SearchResult[]> {
  let entries: SearchResult[];
  if (source.type === "openapi") {
    const spec = await fetchOpenApiSpec(source, env.ENCRYPTION_KEY);
    entries = catalogOpenApi(source, spec);
  } else {
    const broker = env.MCP_BROKER.getByName(source.ownerId ?? "default");
    entries = await broker.listTools(source);
  }

  await db.delete(schema.catalogEntries).where(eq(schema.catalogEntries.sourceId, source.id)).run();
  for (const entry of entries) {
    await db
      .insert(schema.catalogEntries)
      .values({
        id: crypto.randomUUID(),
        sourceId: source.id,
        sourceSlug: entry.source,
        sourceType: entry.type,
        operationKey: entry.operation,
        title: entry.title,
        description: entry.description ?? null,
        searchText: [entry.source, entry.type, entry.operation, entry.title, entry.description].filter(Boolean).join("\n"),
        inputSchemaJson: entry.inputSchema === undefined ? null : safeJson(entry.inputSchema),
        executionRefJson: safeJson(entry.executionRef)
      })
      .run();
  }
  return entries;
}

export async function searchCatalog(db: Db, query: string, ownerId: string | null = null): Promise<SearchResult[]> {
  const terms = query.trim().split(/\s+/).filter(Boolean).slice(0, 8);
  if (terms.length === 0) return [];
  const predicates = terms.map((term) => like(schema.catalogEntries.searchText, `%${term}%`));
  const rows = await db
    .select()
    .from(schema.catalogEntries)
    .where(or(...predicates))
    .limit(30);

  const ownerSources = ownerId ? await listSources(db, ownerId) : [];
  const allowedSlugs = new Set(ownerSources.map((source) => source.slug));
  const filtered = ownerId ? rows.filter((row) => allowedSlugs.has(row.sourceSlug)) : rows;

  return Promise.all(
    filtered.map(async (row) => ({
      source: row.sourceSlug,
      type: row.sourceType,
      operation: row.operationKey,
      title: row.title,
      description: row.description ?? undefined,
      inputSchema: row.inputSchemaJson ? JSON.parse(row.inputSchemaJson) : undefined,
      executionRef: JSON.parse(row.executionRefJson) as unknown
    }))
  );
}

export async function logExecution(
  db: Db,
  input: { ownerId: string | null; code: string; status: "ok" | "error"; result?: unknown; error?: string; durationMs: number }
): Promise<void> {
  await db
    .insert(schema.executionLogs)
    .values({
      id: crypto.randomUUID(),
      ownerId: input.ownerId,
      code: input.code,
      status: input.status,
      resultJson: input.result === undefined ? null : safeJson(input.result),
      error: input.error ?? null,
      durationMs: input.durationMs
    })
    .run();
}

function rowToSource(row: typeof schema.sources.$inferSelect): SourceConfig {
  return {
    id: row.id,
    ownerId: row.ownerId,
    slug: row.slug,
    type: row.type,
    name: row.name,
    baseUrl: row.baseUrl,
    specUrl: row.specUrl,
    authType: row.authType,
    authHeaderName: row.authHeaderName,
    encryptedSecret: row.encryptedSecret,
    metadata: parseJsonObject(row.metadataJson),
    enabled: row.enabled
  };
}

function validateSource(input: SourceInput): void {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(input.slug)) {
    throw new Error("slug must be lowercase letters, numbers, and dashes");
  }
  if (input.type === "openapi") {
    if (!input.baseUrl) throw new Error("OpenAPI sources require baseUrl");
    if (!input.specUrl) throw new Error("OpenAPI sources require specUrl");
  }
  if (input.type === "mcp" && !input.baseUrl) {
    throw new Error("MCP sources require baseUrl");
  }
  if (input.baseUrl) validateHttpUrl(input.baseUrl, "baseUrl");
  if (input.specUrl) validateHttpUrl(input.specUrl, "specUrl");
}

function validateHttpUrl(value: string, label: string): void {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must use http or https`);
  }
}
