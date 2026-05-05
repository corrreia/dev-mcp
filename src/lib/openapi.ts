import { load } from "js-yaml";
import type { RequestOptions, SearchResult, SourceConfig } from "../types";
import { decryptSecret } from "./crypto";

const METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
const MAX_UPSTREAM_RESPONSE_BYTES = 1_000_000;

export async function fetchOpenApiSpec(source: SourceConfig, encryptionKey?: string): Promise<Record<string, unknown>> {
  const specUrl = source.specUrl ?? source.baseUrl;
  if (!specUrl) throw new Error(`Source ${source.slug} does not have a spec URL`);
  const headers = shouldSendSpecAuth(source, specUrl) ? await authHeaders(source, encryptionKey) : undefined;
  const response = await fetch(specUrl, { headers });
  if (!response.ok) throw new Error(`Failed to fetch ${specUrl}: ${response.status} ${response.statusText}`);
  const text = await readLimitedText(response, `OpenAPI spec for ${source.slug}`);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return load(text) as Record<string, unknown>;
  }
}

function shouldSendSpecAuth(source: SourceConfig, specUrl: string): boolean {
  if (source.authType === "none" || source.authType === "oauth") return false;
  if (!source.baseUrl) return false;
  return new URL(source.baseUrl).origin === new URL(specUrl).origin;
}

export function catalogOpenApi(source: SourceConfig, spec: Record<string, unknown>): SearchResult[] {
  const paths = (spec.paths ?? {}) as Record<string, Record<string, unknown>>;
  const results: SearchResult[] = [];
  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!METHODS.has(method)) continue;
      const op = operation as Record<string, unknown>;
      const operationKey = typeof op.operationId === "string" ? op.operationId : `${method.toUpperCase()} ${path}`;
      const title = [method.toUpperCase(), path, op.summary].filter(Boolean).join(" ");
      const description = [op.description, Array.isArray(op.tags) ? `tags: ${op.tags.join(", ")}` : undefined]
        .filter(Boolean)
        .join("\n");
      results.push({
        source: source.slug,
        type: "openapi",
        kind: "openapi_operation",
        operation: operationKey,
        title,
        description,
        inputSchema: inputSchemaForOperation(op),
        executionRef: { source: source.slug, kind: "openapi", method: method.toUpperCase(), path }
      });
    }
  }
  return results;
}

export function mergeOpenApiSpecs(entries: Array<{ source: SourceConfig; spec: Record<string, unknown> }>): Record<string, unknown> {
  const paths: Record<string, unknown> = {};
  const components: Record<string, Record<string, unknown>> = { schemas: {} };
  for (const entry of entries) {
    const sourcePaths = (entry.spec.paths ?? {}) as Record<string, unknown>;
    for (const [path, methods] of Object.entries(sourcePaths)) {
      paths[`/${entry.source.slug}${path}`] = methods;
    }
    const schemas = ((entry.spec.components as Record<string, unknown> | undefined)?.schemas ?? {}) as Record<string, unknown>;
    for (const [name, schema] of Object.entries(schemas)) {
      components.schemas[`${entry.source.slug}_${name}`] = schema;
    }
  }
  return {
    openapi: "3.1.0",
    info: { title: "Dev MCP Combined API", version: "0.1.0" },
    servers: [{ url: "https://worker.invalid" }],
    paths,
    components
  };
}

export async function requestOpenApi(
  source: SourceConfig,
  options: RequestOptions,
  encryptionKey?: string
): Promise<unknown> {
  if (!source.baseUrl) throw new Error(`Source ${source.slug} does not have a base URL`);
  const path = stripSourcePrefix(options.path, source.slug);
  const base = new URL(source.baseUrl);
  const basePath = base.pathname.replace(/\/+$/, "");
  const requestPath = path.replace(/^\/+/, "");
  base.pathname = `${basePath}/${requestPath}`.replace(/\/{2,}/g, "/");
  const url = base;
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const headers = await authHeaders(source, encryptionKey);
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers.set("content-type", options.contentType ?? "application/json");
    body = options.rawBody ? String(options.body) : JSON.stringify(options.body);
  }

  const response = await fetch(url, { method: options.method, headers, body });
  const contentType = response.headers.get("content-type") ?? "";
  const text = await readLimitedText(response, `Response from ${source.slug}`);
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

async function authHeaders(source: SourceConfig, encryptionKey?: string): Promise<Headers> {
  const headers = new Headers();
  const secret = await decryptSecret(source.encryptedSecret, encryptionKey);
  if (source.authType === "bearer" && secret) headers.set("authorization", `Bearer ${secret}`);
  if (source.authType === "header" && source.authHeaderName && secret) headers.set(source.authHeaderName, secret);
  return headers;
}

function stripSourcePrefix(path: string, slug: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const prefix = `/${slug}/`;
  if (normalized === `/${slug}`) return "/";
  if (normalized.startsWith(prefix)) return normalized.slice(slug.length + 1);
  return normalized;
}

function inputSchemaForOperation(operation: Record<string, unknown>): unknown {
  const requestBody = operation.requestBody as Record<string, unknown> | undefined;
  const content = requestBody?.content as Record<string, { schema?: unknown }> | undefined;
  return content?.["application/json"]?.schema ?? { type: "object" };
}

async function readLimitedText(response: Response, label: string): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_UPSTREAM_RESPONSE_BYTES) {
    throw new Error(`${label} is too large`);
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_UPSTREAM_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`${label} is too large`);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
}
