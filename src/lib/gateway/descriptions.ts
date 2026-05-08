export const SEARCH_DESCRIPTION = `Search the combined catalog and OpenAPI specs.

Available in your code:

interface CatalogEntry {
  source: string;
  type: "openapi" | "mcp";
  operation: string;
  callName?: string;
  title: string;
  description?: string;
  inputSchema?: unknown;
  executionRef: unknown;
}

interface CatalogQuery {
  query?: string;
  source?: string;
  type?: "openapi" | "mcp";
  kind?: "openapi_operation" | "mcp_tool";
  limit?: number;
  match?: "any" | "all";
}

interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, unknown>;
  components?: Record<string, unknown>;
}

declare const codemode: {
  catalog(query: string | CatalogQuery): Promise<CatalogEntry[]>;
  spec(): Promise<OpenApiSpec>;
  sources(): Promise<Array<{ slug: string; type: "openapi" | "mcp"; name: string; enabled: boolean }>>;
};

Write an async arrow function and return the result.`;

export const EXECUTE_DESCRIPTION = `Execute calls against user-added OpenAPI and MCP sources.

First use search to find operations. Credentials never enter the sandbox; calls route directly through host-side OpenAPI request and MCP broker functions.

Available in your code:

interface RequestOptions {
  params?: Record<string, string | number | boolean | undefined>;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  contentType?: string;
  rawBody?: boolean;
}

interface OpenApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: T;
}

declare const codemode: {
  [sourceOrTool: string]: unknown;
};

Each OpenAPI operation is exposed as codemode.<callName>(requestOptions) and returns OpenApiResponse.
Each MCP tool is exposed as codemode.<callName>(args).
Use the callName returned by catalog search when present; it is the exact generated function name, including any collision suffix.

Names are sanitized for JavaScript identifiers: dashes and other punctuation become underscores.
For example, source "workos-api" with operation "AuthorizationResourcesController_list" is called as:

async () => {
  return codemode.workos_api_AuthorizationPermissionsController_update({
    params: { slug: "agents:manage" },
    body: { description: "Manage agents" }
  });
}

For a list endpoint:

async () => {
  return codemode.workos_api_AuthorizationResourcesController_list({
    query: { limit: 100, order: "asc" }
  });
}

OpenAPI requestOptions may include:
- params: path parameters for placeholders like {slug}, {id}, or {organization_id}.
- query: URL query parameters.
- headers: operation-specific headers, not credentials.
- body: JSON request body for POST/PUT/PATCH requests.
- contentType/rawBody: only for non-JSON or multipart requests.

Do not pass method or path for cataloged OpenAPI operations; the generated function already knows them.
Use search first to find source slugs, operation names, callName values, OpenAPI paths, and MCP tool names.
Write an async arrow function and return the result.`;
