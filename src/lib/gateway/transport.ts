import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export async function callWrappedTool(server: McpServer, toolName: "search" | "execute" | "code", code: string): Promise<unknown> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "dev-mcp-wrapper-client", version: "0.1.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const result = await client.callTool({ name: toolName, arguments: { code } });
    if (result.isError) throw new Error(mcpText(result as { content?: unknown }) || `${toolName} failed`);
    return parseMaybeJson(mcpText(result as { content?: unknown }));
  } finally {
    await client.close();
    await serverTransport.close();
  }
}

function mcpText(result: { content?: unknown }): string {
  const content = Array.isArray(result.content) ? result.content : [];
  return content
    .filter((part): part is { type: "text"; text: string } => {
      return Boolean(part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string");
    })
    .map((part) => part.text)
    .join("\n");
}

function parseMaybeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
