import { DurableObject } from "cloudflare:workers";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Env, SearchResult, SourceConfig } from "../types";
import { decryptSecret } from "./crypto";

type TextContent = { type: "text"; text: string };

export class McpBroker extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  async connectSource(source: SourceConfig): Promise<{ status: "connected" | "auth_required"; authUrl?: string }> {
    if (source.authType === "oauth") {
      return { status: "auth_required", authUrl: `${this.env.APP_URL}/api/sources/${source.slug}/oauth/start` };
    }
    await this.withClient(source, async (client) => {
      await client.listTools();
    });
    return { status: "connected" };
  }

  async listTools(source: SourceConfig): Promise<SearchResult[]> {
    return this.withClient(source, async (client) => {
      const { tools } = await client.listTools();
      return tools.map((tool) => ({
        source: source.slug,
        type: "mcp" as const,
        operation: tool.name,
        title: `${source.slug}.${tool.name}`,
        description: tool.description,
        inputSchema: tool.inputSchema,
        executionRef: { source: source.slug, kind: "mcp", tool: tool.name }
      }));
    });
  }

  async callTool(source: SourceConfig, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    return this.withClient(source, async (client) => {
      const result = await client.callTool({ name: toolName, arguments: args });
      const content = (Array.isArray(result.content) ? result.content : []) as Array<TextContent | Record<string, unknown>>;
      if (result.isError) {
        const text = content
          .filter((part) => part.type === "text")
          .map((part) => ("text" in part ? part.text : ""))
          .join("\n");
        throw new Error(text || `MCP tool ${toolName} failed`);
      }
      if (result.structuredContent !== undefined) return result.structuredContent;
      if (content.every((part) => part.type === "text")) {
        const text = content.map((part) => ("text" in part ? part.text : "")).join("\n");
        try {
          return JSON.parse(text) as unknown;
        } catch {
          return text;
        }
      }
      return result;
    });
  }

  private async migrate(): Promise<void> {
    const version = this.ctx.storage.sql.exec<{ user_version: number }>("PRAGMA user_version").one().user_version;
    if (version < 1) {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS oauth_state (
          source_slug TEXT PRIMARY KEY,
          state_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        PRAGMA user_version = 1;
      `);
    }
  }

  private async withClient<T>(source: SourceConfig, fn: (client: Client) => Promise<T>): Promise<T> {
    if (!source.baseUrl) throw new Error(`MCP source ${source.slug} does not have a URL`);
    const headers = await this.authHeaders(source);
    const transport = new StreamableHTTPClientTransport(new URL(source.baseUrl), {
      requestInit: { headers }
    });
    const client = new Client({ name: "dev-mcp-broker", version: "0.1.0" });
    await client.connect(transport);
    try {
      return await fn(client);
    } finally {
      await client.close();
    }
  }

  private async authHeaders(source: SourceConfig): Promise<HeadersInit> {
    const headers = new Headers();
    const secret = await decryptSecret(source.encryptedSecret, this.env.ENCRYPTION_KEY);
    if (source.authType === "bearer" && secret) headers.set("authorization", `Bearer ${secret}`);
    if (source.authType === "header" && source.authHeaderName && secret) headers.set(source.authHeaderName, secret);
    return headers;
  }
}
