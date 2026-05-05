export const SEARCH_DESCRIPTION = `Search the combined catalog and OpenAPI specs.

Available in your code:

interface CatalogEntry {
  source: string;
  type: "openapi" | "mcp";
  operation: string;
  title: string;
  description?: string;
  inputSchema?: unknown;
  executionRef: unknown;
}

interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, unknown>;
  components?: Record<string, unknown>;
}

declare const codemode: {
  catalog(query: string): Promise<CatalogEntry[]>;
  spec(): Promise<OpenApiSpec>;
  sources(): Promise<Array<{ slug: string; type: "openapi" | "mcp"; name: string }>>;
};

Write an async arrow function and return the result.`;

export const EXECUTE_DESCRIPTION = `Execute calls against user-added OpenAPI and MCP sources.

First use search to find operations. Credentials never enter the sandbox; calls route directly through host-side OpenAPI request and MCP broker functions.

Available in your code:

interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  contentType?: string;
  rawBody?: boolean;
}

declare const codemode: {
  [sourceOrTool: string]: unknown;
};

Each OpenAPI operation is exposed as codemode.<source>_<operation>(requestOptions).
Each MCP tool is exposed as codemode.<source>_<tool>(args).

Names are sanitized for JavaScript identifiers: dashes and other punctuation become underscores.
For example, source "workos-api" with operation "AuthorizationResourcesController_list" is called as:

async () => {
  return codemode.workos_api_AuthorizationResourcesController_list({
    query: { limit: 100, order: "asc" }
  });
}

OpenAPI requestOptions may include:
- query: URL query parameters.
- body: JSON request body for POST/PUT/PATCH requests.
- contentType/rawBody: only for non-JSON or multipart requests.

Do not pass method or path for cataloged OpenAPI operations; the generated function already knows them.
Use search first to find source slugs, operation names, OpenAPI paths, and MCP tool names.
Write an async arrow function and return the result.`;
