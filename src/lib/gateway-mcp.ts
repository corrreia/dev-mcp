import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createDb } from "@/db/client";
import type { Env } from "@/types";
import { truncateResult } from "@/lib/json";
import { listSources, searchCatalog } from "@/lib/sources";
import { EXECUTE_DESCRIPTION, SEARCH_DESCRIPTION } from "@/lib/gateway/descriptions";
import { executionFunctions } from "@/lib/gateway/functions";
import { combinedSpec } from "@/lib/gateway/spec";

export async function buildGatewayMcpServer(env: Env, ownerId: string | null): Promise<McpServer> {
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
            catalog: async (args: unknown) =>
              searchCatalog(db, typeof args === "string" ? args : String(args), ownerId, { enabledOnly: true }),
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
      const fns = await executionFunctions(env, ownerId);
      const result = await executor.execute(code, [
        {
          name: "codemode",
          fns
        }
      ]);

      if (result.error) {
        return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
      }

      return { content: [{ type: "text" as const, text: truncateResult(result.result) }] };
    }
  );

  return server;
}
