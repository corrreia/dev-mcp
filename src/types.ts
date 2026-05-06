export type Env = Cloudflare.Env;

export type SourceType = "openapi" | "mcp";
export type SourceAuthType = "none" | "bearer" | "header" | "oauth";
export type CatalogEntryKind = "openapi_operation" | "mcp_tool";

export interface SourceConfig {
  id: string;
  ownerId: string | null;
  slug: string;
  type: SourceType;
  name: string;
  baseUrl: string | null;
  specUrl: string | null;
  authType: SourceAuthType;
  authHeaderName: string | null;
  encryptedSecret: string | null;
  metadata: Record<string, unknown>;
  enabled: boolean;
}

export interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  params?: Record<string, string | number | boolean | undefined>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  contentType?: string;
  rawBody?: boolean;
}

export interface SearchResult {
  id?: string;
  source: string;
  type: SourceType;
  kind: CatalogEntryKind;
  operation: string;
  title: string;
  description?: string;
  inputSchema?: unknown;
  executionRef: unknown;
}
