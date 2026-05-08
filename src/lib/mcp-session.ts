import { DurableObject } from "cloudflare:workers";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Env } from "@/types";
import { jsonResponse } from "@/lib/json";
import { buildGatewayMcpServer } from "@/lib/gateway-mcp";

export class McpSession extends DurableObject<Env> {
  private readonly transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

  async fetch(request: Request): Promise<Response> {
    const ownerId = request.headers.get("x-dev-mcp-owner-id");
    const sessionId = request.headers.get("mcp-session-id");

    if (sessionId) {
      const existing = this.transports.get(sessionId);
      if (!existing) {
        return jsonResponse(
          {
            jsonrpc: "2.0",
            error: {
              code: -32001,
              message: "Session not found. Start a new MCP session; in-memory transports are not resumable after restart or close."
            },
            id: null
          },
          { status: 404 }
        );
      }
      return existing.handleRequest(request);
    }

    const server = await buildGatewayMcpServer(this.env, ownerId);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => {
        this.transports.set(id, transport);
      }
    });

    transport.onclose = () => {
      if (transport.sessionId) this.transports.delete(transport.sessionId);
    };

    await server.connect(transport);
    return transport.handleRequest(request);
  }
}
