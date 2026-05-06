import { and, eq, inArray, like, or } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import type { Env, SearchResult, SourceConfig, SourceType } from "@/types";
import { encryptSecret } from "@/lib/crypto";
import { parseJsonObject, safeJson } from "@/lib/json";
import { catalogOpenApi, fetchOpenApiSpec } from "@/lib/openapi";

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
  const existing = await getSourceBySlug(db, input.slug, input.ownerId ?? null);
  if (existing) throw new Error(`source "${input.slug}" already exists`);

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
        kind: entry.kind,
        operationKey: entry.operation,
        title: entry.title,
        description: entry.description ?? null,
        searchText: [entry.source, entry.type, entry.kind, entry.operation, entry.title, entry.description].filter(Boolean).join("\n"),
        inputSchemaJson: entry.inputSchema === undefined ? null : safeJson(entry.inputSchema),
        executionRefJson: safeJson(entry.executionRef)
      })
      .run();
  }
  return entries;
}

export async function searchCatalog(
  db: Db,
  query: string,
  ownerId: string | null = null,
  options: { enabledOnly?: boolean; limit?: number } = {}
): Promise<SearchResult[]> {
  const terms = query.trim().split(/\s+/).filter(Boolean).slice(0, 8);
  const ownerSources = ownerId ? await listSources(db, ownerId) : [];
  const allowedSourceIds = ownerId ? ownerSources.map((source) => source.id) : [];
  if (ownerId && allowedSourceIds.length === 0) return [];

  const textPredicate =
    terms.length > 0 ? or(...terms.map((term) => like(schema.catalogEntries.searchText, `%${term}%`))) : undefined;
  const ownerPredicate = ownerId ? inArray(schema.catalogEntries.sourceId, allowedSourceIds) : undefined;
  const enabledSourceIds = options.enabledOnly
    ? (ownerId ? ownerSources : await listSources(db)).filter((source) => source.enabled).map((source) => source.id)
    : [];
  if (options.enabledOnly && enabledSourceIds.length === 0) return [];
  const enabledPredicate = options.enabledOnly ? inArray(schema.catalogEntries.sourceId, enabledSourceIds) : undefined;
  const predicates = [textPredicate, ownerPredicate, enabledPredicate].filter(Boolean);
  const where = predicates.length > 0 ? and(...predicates) : undefined;
  const rows = await db
    .select()
    .from(schema.catalogEntries)
    .where(where)
    .limit(options.limit ?? 100);

  return Promise.all(rows.map(async (row) => catalogRowToResult(row)));
}

export async function listEnabledCatalogEntries(
  db: Db,
  ownerId: string | null,
  kinds?: Array<SearchResult["kind"]>
): Promise<SearchResult[]> {
  const ownerSources = ownerId ? await listSources(db, ownerId) : await listSources(db);
  const enabledSourceIds = ownerSources.filter((source) => source.enabled).map((source) => source.id);
  if (enabledSourceIds.length === 0) return [];
  const where = inArray(schema.catalogEntries.sourceId, enabledSourceIds);
  const rows = await db.select().from(schema.catalogEntries).where(where);
  const entries = await Promise.all(rows.map(async (row) => catalogRowToResult(row)));
  return entries.filter((entry) => !kinds || kinds.includes(entry.kind));
}

export async function setSourceEnabled(db: Db, slug: string, enabled: boolean, ownerId: string | null = null): Promise<SourceConfig> {
  const source = await getSourceBySlug(db, slug, ownerId);
  if (!source) throw new Error("source not found");
  await db.update(schema.sources).set({ enabled }).where(eq(schema.sources.id, source.id)).run();
  return { ...source, enabled };
}

export async function catalogStats(
  db: Db,
  ownerId: string | null
): Promise<{ openapiEndpoints: number; mcpTools: number; enabledSources: number }> {
  const sources = await listSources(db, ownerId);
  const entries = await searchCatalog(db, "", ownerId, { enabledOnly: true, limit: 10_000 });
  return {
    openapiEndpoints: entries.filter((entry) => entry.kind === "openapi_operation").length,
    mcpTools: entries.filter((entry) => entry.kind === "mcp_tool").length,
    enabledSources: sources.filter((source) => source.enabled).length
  };
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

function catalogRowToResult(row: typeof schema.catalogEntries.$inferSelect): SearchResult {
  const kind = row.sourceType === "mcp" && row.kind === "openapi_operation" ? "mcp_tool" : row.kind;
  return {
    id: row.id,
    source: row.sourceSlug,
    type: row.sourceType,
    kind,
    operation: row.operationKey,
    title: row.title,
    description: row.description ?? undefined,
    inputSchema: row.inputSchemaJson ? JSON.parse(row.inputSchemaJson) : undefined,
    executionRef: JSON.parse(row.executionRefJson) as unknown
  };
}

function validateSource(input: SourceInput): void {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(input.slug)) {
    throw new Error("slug must be lowercase letters, numbers, and dashes");
  }
  if (input.type === "openapi") {
    if (!input.baseUrl) throw new Error("OpenAPI sources require baseUrl");
    if (!input.specUrl) throw new Error("OpenAPI sources require specUrl");
    if (input.authType === "oauth") throw new Error("OpenAPI source OAuth is not supported");
  }
  if (input.type === "mcp" && !input.baseUrl) {
    throw new Error("MCP sources require baseUrl");
  }
  if (input.baseUrl) validateHttpUrl(input.baseUrl, "baseUrl");
  if (input.specUrl) validateHttpUrl(input.specUrl, "specUrl");
}

function validateHttpUrl(value: string, label: string): void {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error(`${label} must use https`);
  }
}
