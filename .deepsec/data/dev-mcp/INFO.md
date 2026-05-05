# dev-mcp

## What this codebase does

Cloudflare-native MCP gateway for one authenticated user workspace. A TanStack Start dashboard lets users register OpenAPI and MCP sources, stores source metadata in D1, refreshes a per-user catalog, and exposes `/mcp` with only `search` and `execute`. Execution runs JavaScript in Cloudflare Code Mode with `globalOutbound: null`; upstream access is intentionally mediated through generated `codemode.*` functions backed by user-enabled source entries.

Representative paths: `src/index.ts`, `src/server/functions/sources.ts`, `src/lib/gateway-mcp.ts`, `src/lib/sources.ts`, `src/lib/openapi.ts`.

## Auth shape

- `createAuth` configures Better Auth with OIDC login and the Better Auth MCP plugin.
- `getUserId` reads the Better Auth session from request headers.
- `requireAuth` gates dashboard server functions and source OAuth routes; it also accepts a bearer token equal to `BETTER_AUTH_SECRET` and maps it to owner id `api-token`.
- `/mcp` is wrapped in `withMcpAuth`; the session user id is copied into `x-dev-mcp-owner-id` and used to name the per-user `MCP_SESSION` Durable Object.
- User data isolation normally depends on passing `auth.userId`/`ownerId` into `listSources`, `getSourceBySlug`, `searchCatalog`, and catalog execution helpers.

## Threat model

The highest-impact attacker goal is cross-tenant access: reading or executing another user's registered sources, catalog entries, upstream tokens, or execution logs. Next is turning the gateway into an arbitrary network proxy despite the Code Mode outbound restriction. Source registration is intentionally powerful, so source URL validation, auth scoping, OAuth callback state, and owner-aware database queries matter more than generic route hygiene.

## Project-specific patterns to flag

- Any call to `listSources`, `getSourceBySlug`, `searchCatalog`, `listEnabledCatalogEntries`, `setSourceEnabled`, or `deleteSource` that omits the current `ownerId` in request-scoped code.
- Any path that creates or refreshes sources without `validateSource`, HTTPS-only URL checks, or same-origin restrictions for sending spec credentials.
- Any expansion of `execute` helpers that exposes raw `fetch`, raw `env`, unbounded outbound access, or per-source functions without checking `source.enabled`.
- Any OAuth MCP flow that skips `SourceOAuthClientProvider.validateState`, writes tokens outside `encryptedSecret`, or builds callback URLs from attacker-controlled input instead of `APP_URL`.
- Any new public Hono/TanStack server function under `/api`, `/mcp`, or `src/server/functions` that performs source/catalog mutation without `requireAuth` or `withMcpAuth`.

## Known false-positives

- `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`, `/api/auth/*`, `/login`, and the dashboard shell are intended public entry points.
- The `/mcp` endpoint intentionally accepts arbitrary JavaScript strings, but only for Code Mode and only with the gateway-provided helper functions.
- `requestOpenApi` intentionally forwards user-provided `method`, `path`, `query`, and `body` to registered upstream APIs after source lookup and auth header construction.
- `fetchOpenApiSpec` intentionally fetches user-registered OpenAPI spec URLs; specs are capped and credentials are sent only when the spec origin matches the source base origin.
- `safeJson`, `parseJsonObject`, and `truncateResult` serialize untrusted upstream data for storage or MCP output; they are not template rendering sinks by themselves.
