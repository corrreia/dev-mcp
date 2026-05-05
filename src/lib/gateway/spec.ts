import { createDb } from "../../db/client";
import type { Env, SourceConfig } from "../../types";
import { fetchOpenApiSpec, mergeOpenApiSpecs } from "../openapi";
import { listSources } from "../sources";

export async function combinedSpec(env: Env, ownerId: string | null): Promise<Record<string, unknown>> {
  const db = createDb(env.DB);
  const sources = (await listSources(db, ownerId)).filter((source) => source.enabled && source.type === "openapi");
  const specs: Array<{ source: SourceConfig; spec: Record<string, unknown> }> = [];

  for (const source of sources) {
    try {
      specs.push({ source, spec: await fetchOpenApiSpec(source, env.ENCRYPTION_KEY) });
    } catch {
      // Search should still work for other sources if one spec is unavailable.
    }
  }

  return mergeOpenApiSpecs(specs);
}
