import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { env as cloudflareEnv } from "cloudflare:workers";
import { z } from "zod";
import { createDb } from "@/db/client";
import { requireAuth } from "@/lib/auth";
import { createAuth } from "@/lib/better-auth";
import { createSource, deleteSource, getSourceBySlug, listSources, refreshSourceCatalog, searchCatalog } from "@/lib/sources";
import type { Env } from "@/types";

const sourceInputSchema = z.object({
  slug: z.string(),
  type: z.enum(["openapi", "mcp"]),
  name: z.string().optional(),
  baseUrl: z.string().optional(),
  specUrl: z.string().optional(),
  authType: z.enum(["none", "bearer", "header", "oauth"]).default("none"),
  authHeaderName: z.string().optional(),
  secret: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional()
});

const slugInputSchema = z.object({ slug: z.string() });
const searchInputSchema = z.object({ query: z.string() });

function runtimeEnv() {
  return cloudflareEnv as unknown as Env;
}

async function currentAuth() {
  return requireAuth(getRequest(), runtimeEnv());
}

export const getSession = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const auth = createAuth(runtimeEnv(), request);
  const session = await auth.api.getSession({
    headers: request.headers,
    asResponse: false
  });

  return {
    authenticated: Boolean(session),
    user: session?.user
      ? {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          image: session.user.image ?? undefined
        }
      : null
  };
});

export const getDashboardData = createServerFn({ method: "GET", strict: false }).handler(async () => {
  const session = await getSession();
  if (!session.authenticated) {
    return {
      session,
      sources: []
    };
  }

  const auth = await currentAuth();
  const sources = await listSources(createDb(runtimeEnv().DB), auth.userId);

  return {
    session,
    sources
  };
});

export const createSourceConfig = createServerFn({ method: "POST", strict: false })
  .inputValidator(sourceInputSchema)
  .handler(async ({ data }) => {
    const auth = await currentAuth();
    return createSource(createDb(runtimeEnv().DB), runtimeEnv(), {
      ownerId: auth.userId,
      slug: data.slug,
      type: data.type,
      name: data.name,
      baseUrl: data.baseUrl,
      specUrl: data.specUrl,
      authType: data.authType,
      authHeaderName: data.authHeaderName,
      secret: data.secret,
      metadata: data.metadata
    });
  });

export const deleteSourceConfig = createServerFn({ method: "POST" })
  .inputValidator(slugInputSchema)
  .handler(async ({ data }) => {
    const auth = await currentAuth();
    return {
      deleted: await deleteSource(createDb(runtimeEnv().DB), data.slug, auth.userId)
    };
  });

export const refreshSourceConfig = createServerFn({ method: "POST", strict: false })
  .inputValidator(slugInputSchema)
  .handler(async ({ data }) => {
    const auth = await currentAuth();
    const db = createDb(runtimeEnv().DB);
    const source = await getSourceBySlug(db, data.slug, auth.userId);
    if (!source) throw new Error("source not found");
    const entries = await refreshSourceCatalog(db, runtimeEnv(), source);
    return {
      count: entries.length,
      entries
    };
  });

export const searchCombinedCatalog = createServerFn({ method: "GET", strict: false })
  .inputValidator(searchInputSchema)
  .handler(async ({ data }) => {
    const auth = await currentAuth();
    return searchCatalog(createDb(runtimeEnv().DB), data.query, auth.userId);
  });
