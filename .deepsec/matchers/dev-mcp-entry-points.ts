import type { CandidateMatch, MatcherPlugin } from "deepsec/config";

const ENTRY_FILES = new Set([
  "src/index.ts",
  "src/server/functions/sources.ts",
  "src/lib/gateway-mcp.ts",
  "src/lib/gateway/functions.ts",
  "src/lib/openapi.ts",
  "src/lib/mcp-broker.ts",
  "src/lib/mcp-oauth-provider.ts",
  "src/lib/sources.ts",
]);

const ENTRY_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  { regex: /\bapp\.(?:all|get|post|put|patch|delete)\s*\(/, label: "Hono route" },
  { regex: /\bcreateServerFn\s*\(/, label: "TanStack server function" },
  { regex: /\bserver\.registerTool\s*\(/, label: "MCP public tool" },
  { regex: /\bexecutor\.execute\s*\(/, label: "Code Mode execution" },
  { regex: /\bcloudflareEnv\b|\bruntimeEnv\s*\(/, label: "Cloudflare runtime env access" },
  { regex: /\bfetch\s*\(/, label: "upstream fetch" },
  { regex: /\bwithClient\s*\(|\bclient\.callTool\s*\(|\bclient\.listTools\s*\(/, label: "upstream MCP client call" },
  { regex: /\bgetSourceBySlug\s*\(|\blistSources\s*\(|\bsearchCatalog\s*\(|\blistEnabledCatalogEntries\s*\(/, label: "owner-scoped source/catalog lookup" },
  { regex: /\bencryptSecret\s*\(|\bdecryptSecret\s*\(|\bsaveTokens\s*\(|\bvalidateState\s*\(/, label: "source credential or OAuth state handling" },
];

export const devMcpEntryPoints: MatcherPlugin = {
  slug: "dev-mcp-entry-points",
  description: "dev-mcp security-critical Cloudflare, Hono, MCP, and source gateway entry points",
  noiseTier: "noisy",
  filePatterns: [
    "src/index.ts",
    "src/server/functions/sources.ts",
    "src/lib/gateway-mcp.ts",
    "src/lib/gateway/functions.ts",
    "src/lib/openapi.ts",
    "src/lib/mcp-broker.ts",
    "src/lib/mcp-oauth-provider.ts",
    "src/lib/sources.ts",
  ],
  match(content, filePath): CandidateMatch[] {
    if (/\.(test|spec)\.(ts|tsx)$/.test(filePath)) return [];
    if (!ENTRY_FILES.has(filePath)) return [];

    const lines = content.split("\n");
    const matches: CandidateMatch[] = [];

    for (let i = 0; i < lines.length; i += 1) {
      for (const pattern of ENTRY_PATTERNS) {
        if (!pattern.regex.test(lines[i])) continue;
        const start = Math.max(0, i - 2);
        const end = Math.min(lines.length, i + 5);
        matches.push({
          vulnSlug: "dev-mcp-entry-points",
          lineNumbers: [i + 1],
          snippet: lines.slice(start, end).join("\n"),
          matchedPattern: pattern.label,
        });
        break;
      }
    }

    if (matches.length > 0) return matches;

    return [
      {
        vulnSlug: "dev-mcp-entry-points",
        lineNumbers: [1],
        snippet: lines.slice(0, 8).join("\n"),
        matchedPattern: "security-critical file selected for review",
      },
    ];
  },
};
