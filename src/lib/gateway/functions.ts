import { sanitizeToolName } from "@cloudflare/codemode";
import { createDb } from "../../db/client";
import type { Env, RequestOptions, SourceConfig } from "../../types";
import type { McpBroker } from "../mcp-broker";
import { catalogOpenApi, fetchOpenApiSpec, requestOpenApi } from "../openapi";
import { listSources } from "../sources";

export async function executionFunctions(env: Env, ownerId: string | null): Promise<Record<string, (args: unknown) => Promise<unknown>>> {
  const db = createDb(env.DB);
  const sources = (await listSources(db, ownerId)).filter((source) => source.enabled);
  const fns: Record<string, (args: unknown) => Promise<unknown>> = {};

  for (const source of sources) {
    if (source.type === "openapi") {
      const name = uniqueFnName(fns, sanitizeToolName(source.slug));
      fns[name] = async (args: unknown) => requestOpenApi(source, args as RequestOptions, env.ENCRYPTION_KEY);
      fns[uniqueFnName(fns, `${name}_search`)] = async (args: unknown) =>
        searchOpenApi(source, typeof args === "string" ? args : String((args as { query?: unknown })?.query ?? args ?? ""), env.ENCRYPTION_KEY);
      continue;
    }

    const broker = env.MCP_BROKER.getByName(ownerId ?? "default") as unknown as Pick<McpBroker, "listTools" | "callTool">;
    const tools = await broker.listTools(source);
    for (const tool of tools) {
      const name = uniqueFnName(fns, sanitizeToolName(`${source.slug}_${tool.operation}`));
      fns[name] = async (args: unknown) => broker.callTool(source, tool.operation, toRecord(args));
    }
  }

  return fns;
}

async function searchOpenApi(source: SourceConfig, query: string, encryptionKey?: string): Promise<unknown> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const entries = catalogOpenApi(source, await fetchOpenApiSpec(source, encryptionKey));
  return entries.filter((entry) => {
    const text = [entry.source, entry.operation, entry.title, entry.description].filter(Boolean).join(" ").toLowerCase();
    return text.includes(needle);
  });
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function uniqueFnName(fns: Record<string, unknown>, base: string): string {
  let name = base || "source";
  let index = 2;
  while (name in fns) {
    name = `${base}_${index}`;
    index += 1;
  }
  return name;
}
