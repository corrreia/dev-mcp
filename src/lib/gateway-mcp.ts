import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createDb } from "../db/client";
import type { Env } from "../types";
import { truncateResult } from "./json";
import { listSources, logExecution, searchCatalog } from "./sources";
import { EXECUTE_DESCRIPTION, SEARCH_DESCRIPTION } from "./gateway/descriptions";
import { executionFunctions } from "./gateway/functions";
import { combinedSpec } from "./gateway/spec";

export function buildGatewayMcpServer(env: Env, ownerId: string | null): McpServer {
  const db = createDb(env.DB);
  const executor = new DynamicWorkerExecutor({
    loader: env.LOADER,
    globalOutbound: null,
    timeout: 30_000
  });

  const server = new McpServer({
    name: "dev-mcp",
    version: "0.1.0"
  });

  server.registerTool(
    "search",
    {
      description: SEARCH_DESCRIPTION,
      inputSchema: {
        code: z.string().describe("JavaScript async arrow function to search the catalog/spec")
      }
    },
    async ({ code }) => {
      const result = await executor.execute(code, [
        {
          name: "codemode",
          fns: {
            catalog: async (args: unknown) => searchCatalog(db, typeof args === "string" ? args : String(args), ownerId),
            spec: async () => combinedSpec(env, ownerId),
            sources: async () =>
              (await listSources(db, ownerId)).map((source) => ({
                slug: source.slug,
                type: source.type,
                name: source.name
              }))
          },
          positionalArgs: true
        }
      ]);

      if (result.error) {
        return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
      }

      return { content: [{ type: "text" as const, text: truncateResult(result.result) }] };
    }
  );

  server.registerTool(
    "execute",
    {
      description: EXECUTE_DESCRIPTION,
      inputSchema: {
        code: z.string().describe("JavaScript async arrow function to execute")
      }
    },
    async ({ code }) => {
      const started = Date.now();
      const fns = await executionFunctions(env, ownerId, executor);
      const result = await executor.execute(code, [
        {
          name: "codemode",
          fns
        }
      ]);

      await logExecution(db, {
        ownerId,
        code,
        status: result.error ? "error" : "ok",
        result: result.error ? undefined : result.result,
        error: result.error,
        durationMs: Date.now() - started
      });

      if (result.error) {
        return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
      }

      return { content: [{ type: "text" as const, text: truncateResult(result.result) }] };
    }
  );

  return server;
}
