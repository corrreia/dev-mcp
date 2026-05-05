import { Hono } from "hono";
import startHandler from "@tanstack/react-start/server-entry";
import { oAuthDiscoveryMetadata, oAuthProtectedResourceMetadata, withMcpAuth } from "better-auth/plugins";
import { createDb } from "./db/client";
import { McpBroker } from "./lib/mcp-broker";
import { McpSession } from "./lib/mcp-session";
import { requireAuth } from "./lib/auth";
import { createAuth } from "./lib/better-auth";
import { jsonResponse } from "./lib/json";
import { getSourceBySlug, refreshSourceCatalog } from "./lib/sources";
import type { Env } from "./types";

export { McpBroker, McpSession };

type Bindings = Env;

const app = new Hono<{ Bindings: Bindings }>();

app.all("/api/auth/*", (c) => createAuth(c.env, c.req.raw).handler(c.req.raw));

app.get("/.well-known/oauth-authorization-server", (c) => oAuthDiscoveryMetadata(createAuth(c.env, c.req.raw))(c.req.raw));
app.get("/.well-known/oauth-protected-resource", (c) => oAuthProtectedResourceMetadata(createAuth(c.env, c.req.raw))(c.req.raw));

app.post("/api/sources/:slug/oauth/start", async (c) => {
  const auth = await requireAuth(c.req.raw, c.env);
  const db = createDb(c.env.DB);
  const source = await getSourceBySlug(db, c.req.param("slug"), auth.userId);
  if (!source) return jsonResponse({ error: "source not found" }, { status: 404 });
  const broker = c.env.MCP_BROKER.getByName(auth.userId ?? "default");
  return jsonResponse(await broker.connectSource(source));
});

app.get("/api/sources/:slug/oauth/callback", async (c) => {
  const auth = await requireAuth(c.req.raw, c.env);
  const db = createDb(c.env.DB);
  const source = await getSourceBySlug(db, c.req.param("slug"), auth.userId);
  if (!source) return jsonResponse({ error: "source not found" }, { status: 404 });
  const code = c.req.query("code");
  if (!code) return jsonResponse({ error: "missing OAuth code" }, { status: 400 });
  const broker = c.env.MCP_BROKER.getByName(auth.userId ?? "default");
  await broker.finishOAuth(source, code, c.req.query("state") ?? null);
  await refreshSourceCatalog(db, c.env, source);
  return new Response(
    `<!doctype html><html><body><script>if(window.opener){window.opener.postMessage({type:"dev-mcp:oauth-complete",slug:${JSON.stringify(source.slug)}},"*");window.close();}else{location.href="/";}</script><p>OAuth complete. You can close this window.</p></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } }
  );
});

app.all("/mcp", async (c) => {
  const auth = createAuth(c.env, c.req.raw);
  const handler = withMcpAuth(auth, async (request, session) => {
    const ownerId = session.userId ?? null;
    const headers = new Headers(request.headers);
    if (ownerId) headers.set("x-dev-mcp-owner-id", ownerId);
    const sessionObject = c.env.MCP_SESSION.getByName(ownerId ?? "anonymous");
    return sessionObject.fetch(new Request(request, { headers }));
  });
  return handler(c.req.raw);
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith("/api/") || pathname === "/mcp" || pathname.startsWith("/.well-known/")) {
      return app.fetch(request, env, ctx);
    }

    return startHandler.fetch(request);
  }
};
