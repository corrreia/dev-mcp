import { sanitizeToolName } from "@cloudflare/codemode";
import { createDb } from "../../db/client";
import type { Env, RequestOptions, SearchResult } from "../../types";
import type { McpBroker } from "../mcp-broker";
import { requestOpenApi } from "../openapi";
import { getSourceBySlug, listEnabledCatalogEntries } from "../sources";

export async function executionFunctions(env: Env, ownerId: string | null): Promise<Record<string, (args: unknown) => Promise<unknown>>> {
  const db = createDb(env.DB);
  const entries = await listEnabledCatalogEntries(db, ownerId, ["openapi_operation", "mcp_tool"]);
  const fns: Record<string, (args: unknown) => Promise<unknown>> = {};

  for (const entry of entries) {
    const source = await getSourceBySlug(db, entry.source, ownerId);
    if (!source?.enabled) continue;

    if (entry.kind === "openapi_operation") {
      const ref = openApiRef(entry);
      if (!ref) continue;
      const name = uniqueFnName(fns, sanitizeToolName(`${entry.source}_${entry.operation}`));
      fns[name] = async (args: unknown) =>
        requestOpenApi(source, { ...toRecord(args), method: ref.method, path: ref.path } as RequestOptions, env.ENCRYPTION_KEY);
      continue;
    }

    const broker = env.MCP_BROKER.getByName(ownerId ?? "default") as unknown as Pick<McpBroker, "listTools" | "callTool">;
    const name = uniqueFnName(fns, sanitizeToolName(`${entry.source}_${entry.operation}`));
    fns[name] = async (args: unknown) => broker.callTool(source, entry.operation, toRecord(args));
  }

  return fns;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function openApiRef(entry: SearchResult): { method: RequestOptions["method"]; path: string } | null {
  const ref = entry.executionRef;
  if (!ref || typeof ref !== "object") return null;
  const method = (ref as { method?: unknown }).method;
  const path = (ref as { path?: unknown }).path;
  if (typeof method !== "string" || typeof path !== "string") return null;
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) return null;
  return { method: method as RequestOptions["method"], path };
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
