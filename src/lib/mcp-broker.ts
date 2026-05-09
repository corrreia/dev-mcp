import { DurableObject } from "cloudflare:workers";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createDb } from "@/db/client";
import type { Env, SearchResult, SourceConfig } from "@/types";
import { decryptSecret } from "@/lib/crypto";
import { SourceOAuthClientProvider } from "@/lib/mcp-oauth-provider";

type TextContent = { type: "text"; text: string };

export class McpBroker extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async connectSource(
    source: SourceConfig,
    options: { forceOAuth?: boolean } = {}
  ): Promise<{ status: "connected" | "auth_required"; authUrl?: string }> {
    try {
      await this.withClient(source, async (client) => {
        await client.listTools();
      }, options);
      return { status: "connected" };
    } catch (err) {
      if (source.authType === "oauth" && err instanceof OAuthRequiredError) {
        return { status: "auth_required", authUrl: err.authUrl };
      }
      throw err;
    }
  }

  async finishOAuth(source: SourceConfig, code: string, state: string | null): Promise<{ status: "connected" }> {
    if (!source.baseUrl) throw new Error(`MCP source ${source.slug} does not have a URL`);
    const provider = new SourceOAuthClientProvider(createDb(this.env.DB), this.env, source);
    if (!(await provider.validateState(state))) throw new Error("Invalid OAuth state");
    const transport = new StreamableHTTPClientTransport(new URL(source.baseUrl), {
      authProvider: provider
    });
    await transport.finishAuth(code);
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
        kind: "mcp_tool" as const,
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

  private async withClient<T>(
    source: SourceConfig,
    fn: (client: Client) => Promise<T>,
    options: { forceOAuth?: boolean } = {}
  ): Promise<T> {
    if (!source.baseUrl) throw new Error(`MCP source ${source.slug} does not have a URL`);
    const oauthProvider =
      source.authType === "oauth"
        ? new SourceOAuthClientProvider(createDb(this.env.DB), this.env, source, { forceConsent: options.forceOAuth })
        : null;
    if (oauthProvider && options.forceOAuth) {
      await oauthProvider.invalidateCredentials("all");
    }
    const transport =
      source.authType === "oauth"
        ? new StreamableHTTPClientTransport(new URL(source.baseUrl), {
            authProvider: oauthProvider ?? undefined
          })
        : new StreamableHTTPClientTransport(new URL(source.baseUrl), {
            requestInit: { headers: await this.authHeaders(source) }
          });
    const client = new Client({ name: "dev-mcp-broker", version: "0.1.0" });
    try {
      await client.connect(transport);
    } catch (err) {
      if (source.authType === "oauth") {
        const authUrl = oauthProvider?.pendingAuthorizationUrl;
        if (authUrl) throw new OAuthRequiredError(authUrl.toString());
      }
      throw err;
    }
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

class OAuthRequiredError extends Error {
  constructor(readonly authUrl: string) {
    super("OAuth authorization required");
  }
}
