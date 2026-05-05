import { sanitizeToolName, type DynamicWorkerExecutor } from "@cloudflare/codemode";
import { codeMcpServer, openApiMcpServer } from "@cloudflare/codemode/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env, RequestOptions, SourceConfig } from "../../types";
import type { McpBroker } from "../mcp-broker";
import { fetchOpenApiSpec, requestOpenApi } from "../openapi";
import { truncateResult } from "../json";
import { callWrappedTool } from "./transport";

export async function executeOpenApiViaWrapper(
  env: Env,
  executor: DynamicWorkerExecutor,
  source: SourceConfig,
  options: RequestOptions
): Promise<unknown> {
  const server = await openApiWrapper(env, executor, source);
  return callWrappedTool(
    server,
    "execute",
    `async () => await codemode.request(${JSON.stringify(stripOpenApiSourcePrefix(options, source.slug))})`
  );
}

export async function searchOpenApiViaWrapper(
  env: Env,
  executor: DynamicWorkerExecutor,
  source: SourceConfig,
  query: string
): Promise<unknown> {
  const server = await openApiWrapper(env, executor, source);
  const needle = query.toLowerCase();
  return callWrappedTool(
    server,
    "search",
    `async () => {
  const spec = await codemode.spec();
  const results = [];
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      const text = [path, method, op.summary, op.description, ...(op.tags || [])].filter(Boolean).join(" ").toLowerCase();
      if (text.includes(${JSON.stringify(needle)})) results.push({ source: ${JSON.stringify(source.slug)}, method: method.toUpperCase(), path, summary: op.summary, description: op.description, tags: op.tags });
    }
  }
  return results;
}`
  );
}

export async function executeMcpViaWrapper(
  env: Env,
  ownerId: string | null,
  executor: DynamicWorkerExecutor,
  source: SourceConfig,
  toolName: string,
  args: unknown
): Promise<unknown> {
  const server = await mcpCodeWrapper(env, ownerId, executor, source);
  return callWrappedTool(
    server,
    "code",
    `async () => await codemode.${sanitizeToolName(toolName)}(${JSON.stringify(args ?? {})})`
  );
}

async function openApiWrapper(env: Env, executor: DynamicWorkerExecutor, source: SourceConfig): Promise<McpServer> {
  const spec = await fetchOpenApiSpec(source, env.ENCRYPTION_KEY);
  return openApiMcpServer({
    spec,
    executor,
    name: source.slug,
    version: "0.1.0",
    description: `Source slug: ${source.slug}. Host-side requests add configured authentication.`,
    request: (options) => requestOpenApi(source, options, env.ENCRYPTION_KEY)
  });
}

async function mcpCodeWrapper(
  env: Env,
  ownerId: string | null,
  executor: DynamicWorkerExecutor,
  source: SourceConfig
): Promise<McpServer> {
  const broker = env.MCP_BROKER.getByName(ownerId ?? "default") as unknown as Pick<McpBroker, "listTools" | "callTool">;
  const tools = await broker.listTools(source);
  const upstream = new McpServer({
    name: source.slug,
    version: "0.1.0"
  });

  for (const tool of tools) {
    upstream.registerTool(
      tool.operation,
      {
        description: tool.description,
        inputSchema: tool.inputSchema ?? { type: "object" }
      } as never,
      async (args: unknown) => {
        const result = await broker.callTool(source, tool.operation, args as Record<string, unknown>);
        return { content: [{ type: "text" as const, text: truncateResult(result) }] };
      }
    );
  }

  return codeMcpServer({ server: upstream, executor });
}

function stripOpenApiSourcePrefix(options: RequestOptions, slug: string): RequestOptions {
  const prefix = `/${slug}/`;
  const path = options.path === `/${slug}` ? "/" : options.path.startsWith(prefix) ? options.path.slice(slug.length + 1) : options.path;
  return { ...options, path };
}
