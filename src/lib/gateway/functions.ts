import { sanitizeToolName, type DynamicWorkerExecutor } from "@cloudflare/codemode";
import { createDb } from "../../db/client";
import type { Env, RequestOptions } from "../../types";
import type { McpBroker } from "../mcp-broker";
import { listSources } from "../sources";
import { executeMcpViaWrapper, executeOpenApiViaWrapper, searchOpenApiViaWrapper } from "./wrappers";

export async function executionFunctions(
  env: Env,
  ownerId: string | null,
  executor: DynamicWorkerExecutor
): Promise<Record<string, (args: unknown) => Promise<unknown>>> {
  const db = createDb(env.DB);
  const sources = (await listSources(db, ownerId)).filter((source) => source.enabled);
  const fns: Record<string, (args: unknown) => Promise<unknown>> = {};

  for (const source of sources) {
    if (source.type === "openapi") {
      const name = uniqueFnName(fns, sanitizeToolName(source.slug));
      fns[name] = async (args: unknown) => executeOpenApiViaWrapper(env, executor, source, args as RequestOptions);
      fns[uniqueFnName(fns, `${name}_search`)] = async (args: unknown) =>
        searchOpenApiViaWrapper(env, executor, source, typeof args === "string" ? args : String((args as { query?: unknown })?.query ?? args ?? ""));
      continue;
    }

    const broker = env.MCP_BROKER.getByName(ownerId ?? "default") as unknown as Pick<McpBroker, "listTools" | "callTool">;
    const tools = await broker.listTools(source);
    for (const tool of tools) {
      const name = uniqueFnName(fns, sanitizeToolName(`${source.slug}_${tool.operation}`));
      fns[name] = async (args: unknown) => executeMcpViaWrapper(env, ownerId, executor, source, tool.operation, args);
    }
  }

  return fns;
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
