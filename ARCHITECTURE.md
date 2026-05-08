# dev-mcp Architecture

dev-mcp is a Cloudflare-native gateway that turns user-registered OpenAPI APIs and MCP servers into one authenticated MCP endpoint. The public endpoint intentionally exposes only two tools:

- `search`
- `execute`

All source-specific operations are hidden behind Code Mode functions. A client first searches the available surface, then executes one of the returned callable names.

## System Shape

The app has two planes.

The dashboard is the control plane. It manages authentication, source registration, source enablement, catalog refreshes, source deletion, and endpoint discovery.

The `/mcp` endpoint is the data plane. It accepts authenticated MCP requests, routes them to a user-scoped `McpSession` Durable Object, and exposes a generated `McpServer` with the two gateway tools.

Main components:

- `src/index.ts`: HTTP routing, Better Auth MCP protection, OAuth callback routing.
- `src/lib/gateway-mcp.ts`: builds the public MCP server and registers `search` and `execute`.
- `src/lib/sources.ts`: source CRUD, catalog refresh, catalog search, callable-name hydration.
- `src/lib/openapi.ts`: OpenAPI spec fetch/catalog/merge/request execution.
- `src/lib/mcp-broker.ts`: user-scoped upstream MCP client broker.
- `src/lib/mcp-session.ts`: user-scoped MCP streamable HTTP session transport.
- `src/lib/gateway/functions.ts`: converts enabled catalog entries into Code Mode functions.
- `src/lib/gateway/names.ts`: deterministic `codemode.*` function name generation.

## Request Flow

Authenticated MCP request:

1. `/mcp` receives the request.
2. `withMcpAuth` validates the Better Auth MCP session.
3. The authenticated user id is copied into `x-dev-mcp-owner-id`.
4. The request is routed to `MCP_SESSION.getByName(ownerId)`.
5. `McpSession` creates or resumes a Streamable HTTP transport.
6. `buildGatewayMcpServer(env, ownerId)` registers `search` and `execute`.

Search request formula:

```ts
client -> /mcp search({ code })
  -> DynamicWorkerExecutor(globalOutbound: null)
  -> codemode.catalog | codemode.spec | codemode.sources
  -> D1 / source spec fetches
  -> JSON text result
```

Execute request formula:

```ts
client -> /mcp execute({ code })
  -> executionFunctions(env, ownerId)
  -> DynamicWorkerExecutor(globalOutbound: null, fns: codemode.*)
  -> codemode.<callName>(args)
  -> host-side OpenAPI fetch or MCP broker call
  -> JSON text result
```

## Public Tool Contract

### `search`

Description:

```text
Search the combined catalog and OpenAPI specs.
```

Input:

```ts
{
  code: string
}
```

The code must be a JavaScript async arrow function. It receives:

```ts
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
```

Common search prompts:

```ts
async () => {
  return codemode.sources();
}
```

```ts
async () => {
  return codemode.catalog({ query: "workers kv", source: "cloudflare-docs", match: "all", limit: 10 });
}
```

```ts
async () => {
  const spec = await codemode.spec();
  return Object.keys(spec.paths).slice(0, 50);
}
```

### `execute`

Description:

```text
Execute calls against user-added OpenAPI and MCP sources.
```

Input:

```ts
{
  code: string
}
```

The code must be a JavaScript async arrow function. It receives one function per enabled callable catalog entry:

```ts
declare const codemode: {
  [callName: string]: (args: unknown) => Promise<unknown>;
};
```

Use `CatalogEntry.callName` exactly. It is the final generated name after sanitization and collision suffixing.

OpenAPI execution args:

```ts
interface RequestOptions {
  params?: Record<string, string | number | boolean | undefined>;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  contentType?: string;
  rawBody?: boolean;
}
```

OpenAPI response formula:

```ts
interface OpenApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: T;
}
```

MCP execution args are the upstream tool input object. MCP results return structured content when available, parsed JSON text when possible, otherwise plain text or the raw MCP result.

Common execute prompt:

```ts
async () => {
  return codemode.workos_api_OrganizationsController_list({
    query: { limit: 10 }
  });
}
```

## Tool Response Formula

All public MCP tool handlers return MCP text content:

```ts
{
  content: [
    {
      type: "text",
      text: truncateResult(result)
    }
  ]
}
```

Errors return:

```ts
{
  content: [
    {
      type: "text",
      text: `Error: ${result.error}`
    }
  ],
  isError: true
}
```

`truncateResult` serializes non-string values as formatted JSON and caps output at `24_000` characters. Clients should return compact, relevant objects from Code Mode rather than whole large API responses when possible.

## Tool Call Formula

OpenAPI call formula:

```ts
codemode.<callName>({
  params,
  query,
  headers,
  body,
  contentType,
  rawBody
})
```

The gateway injects the HTTP method and OpenAPI path from the catalog entry. Client code must not pass `method` or `path`.

MCP call formula:

```ts
codemode.<callName>({
  ...upstreamToolArgs
})
```

The gateway calls the upstream MCP server through the user-scoped `McpBroker` Durable Object.

## Catalog Formula

OpenAPI catalog entry formula:

```ts
{
  source: source.slug,
  type: "openapi",
  kind: "openapi_operation",
  operation: operation.operationId ?? `${METHOD} ${path}`,
  callName: deterministicSanitizedName,
  title: `${METHOD} ${path} ${summary}`,
  description: `${description}\ntags: ${tags}`,
  inputSchema: {
    type: "object",
    properties: {
      params,
      query,
      headers,
      body,
      contentType
    },
    required
  },
  executionRef: { source: source.slug, kind: "openapi", method, path }
}
```

MCP catalog entry formula:

```ts
{
  source: source.slug,
  type: "mcp",
  kind: "mcp_tool",
  operation: tool.name,
  callName: deterministicSanitizedName,
  title: `${source.slug}.${tool.name}`,
  description: tool.description,
  inputSchema: tool.inputSchema,
  executionRef: { source: source.slug, kind: "mcp", tool: tool.name }
}
```

Callable name formula:

```ts
base = sanitize(`${source}_${operation}`)
callName = base | `${base}_2` | `${base}_3` ...
```

Names are assigned in stable catalog order by `sourceSlug`, `operationKey`, and entry id.

## OpenAPI Handling

Supported executable methods:

- `GET`
- `POST`
- `PUT`
- `PATCH`
- `DELETE`

The catalog intentionally excludes `HEAD`, `OPTIONS`, and `TRACE` until execution supports them.

OpenAPI specs are merged into one synthetic spec by prefixing each path with the source slug:

```text
/workos-api/organizations
/stripe/v1/customers
```

Component schemas are prefixed:

```text
User -> workos-api_User
```

Internal schema refs are rewritten recursively:

```text
#/components/schemas/User -> #/components/schemas/workos-api_User
```

Spec fetch auth is only sent when `specUrl` has the same origin as `baseUrl`.

## Catalog Refresh Resilience

Catalog refresh no longer deletes old entries first. The flow is:

1. Read current entry ids for the source.
2. Fetch/list fresh entries.
3. Insert all fresh entries.
4. Delete the previously captured old entry ids.

If a refresh fails before insertion completes, the previous catalog remains available. If deletion fails after insertion, the source may temporarily have duplicate entries, but it does not go empty.

## Search Behavior

`codemode.catalog()` accepts either a string or a structured query.

String search:

```ts
codemode.catalog("workers kv")
```

Structured search:

```ts
codemode.catalog({
  query: "workers kv",
  source: "cloudflare-docs",
  type: "mcp",
  kind: "mcp_tool",
  limit: 20,
  match: "all"
})
```

Search filters are applied in D1. Returned results are ranked in memory:

- exact source/call/operation matches score highest
- all-term matches score above partial matches
- title and operation hits score above description hits
- original stable order breaks ties

## Security Model

Code Mode runs with:

```ts
globalOutbound: null
timeout: 30_000
```

User code cannot use arbitrary outbound network access. It can only call host-provided `codemode.*` functions.

Secrets are decrypted host-side only. They are used to build OpenAPI request headers or MCP transport headers and are never passed into the sandbox.

Source data is scoped by authenticated `ownerId`. The gateway lists, searches, and executes only the current user's enabled catalog entries.

## Session Model

`McpSession` stores active Streamable HTTP transports in memory inside the user-scoped Durable Object instance. These transports are not fully resumable after instance restart or close. When a session id is unknown, the gateway returns a clear reconnect message:

```text
Session not found. Start a new MCP session; in-memory transports are not resumable after restart or close.
```

## Prompting Guidance

Good assistant flow:

1. Call `search` with `codemode.sources()` to inspect configured sources.
2. Call `search` with `codemode.catalog({ query, match: "all", limit })`.
3. Read `callName` and `inputSchema`.
4. Call `execute` with `codemode.<callName>(args)`.
5. Return compact data, not whole raw responses, unless the user asks for raw output.

Recommended search prompt:

```ts
async () => {
  const entries = await codemode.catalog({ query: "customer list", match: "all", limit: 10 });
  return entries.map(({ source, type, kind, operation, callName, title, inputSchema }) => ({
    source,
    type,
    kind,
    operation,
    callName,
    title,
    inputSchema
  }));
}
```

Recommended execute prompt:

```ts
async () => {
  const response = await codemode.some_source_some_operation({
    params: { id: "resource_id" },
    query: { limit: 10 }
  });
  return response;
}
```

Avoid:

- Calling guessed function names when `callName` is available.
- Returning `String(arrayOfObjects)`, which collapses to `[object Object]`.
- Passing `method` or `path` into OpenAPI functions.
- Including credentials, tokens, or secrets in Code Mode code.
