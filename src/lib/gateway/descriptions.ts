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

First use search to find operations. Credentials never enter the sandbox; calls route through host-side bindings.

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
  request(options: RequestOptions): Promise<unknown>;
  [sourceOrTool: string]: unknown;
};

Each OpenAPI source is exposed as codemode.<source>(requestOptions).
Each MCP tool is exposed as codemode.<source>_<tool>(args).
Use search first to find source slugs, OpenAPI paths, and MCP tool names.
Write an async arrow function and return the result.`;
