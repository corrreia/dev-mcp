import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth, mcp } from "better-auth/plugins";
import { createDb } from "../db/client";
import * as schema from "../db/schema";
import type { Env } from "../types";

export type AppAuth = ReturnType<typeof createAuth>;

export function createAuth(env: Env, request: Request) {
  const requestOrigin = new URL(request.url).origin;
  const origin = env.APP_URL || requestOrigin;
  const plugins = [
    genericOAuth({
      config: [
        {
          providerId: "oidc",
          discoveryUrl: `${env.OIDC_ISSUER.replace(/\/+$/, "")}/.well-known/openid-configuration`,
          clientId: env.OIDC_CLIENT_ID,
          clientSecret: env.OIDC_CLIENT_SECRET ?? "",
          scopes: ["openid", "profile", "email"],
          pkce: true
        }
      ]
    }),
    mcp({
      loginPage: "/login"
    })
  ];

  return betterAuth({
    database: drizzleAdapter(createDb(env.DB), { provider: "sqlite", schema }),
    baseURL: origin,
    secret: authSecret(env, requestOrigin),
    emailAndPassword: { enabled: false },
    plugins
  });
}

function authSecret(env: Env, requestOrigin: string): string {
  const secret = env.BETTER_AUTH_SECRET ?? env.ENCRYPTION_KEY;
  if (secret) return secret;

  const hostname = new URL(requestOrigin).hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return "dev-mcp-local-secret-change-me-32-chars-minimum";
  }

  throw new Error("BETTER_AUTH_SECRET or ENCRYPTION_KEY is required");
}

export async function getUserId(request: Request, env: Env): Promise<string | null> {
  const auth = createAuth(env, request);
  const session = await auth.api.getSession({
    headers: request.headers,
    asResponse: false
  });
  return session?.user?.id ?? null;
}
