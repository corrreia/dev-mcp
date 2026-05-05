import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth, mcp } from "better-auth/plugins";
import { createDb } from "../db/client";
import type { Env } from "../types";

export type AppAuth = ReturnType<typeof createAuth>;

export function createAuth(env: Env, request: Request) {
  const origin = env.APP_URL || new URL(request.url).origin;
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
    database: drizzleAdapter(createDb(env.DB), { provider: "sqlite" }),
    baseURL: origin,
    secret: env.BETTER_AUTH_SECRET ?? env.ENCRYPTION_KEY ?? "dev-mcp-local-secret-change-me-32-chars-minimum",
    emailAndPassword: { enabled: false },
    plugins
  });
}

export async function getUserId(request: Request, env: Env): Promise<string | null> {
  const auth = createAuth(env, request);
  const session = await auth.api.getSession({
    headers: request.headers,
    asResponse: false
  });
  return session?.user?.id ?? null;
}
