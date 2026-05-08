import { describe, expect, it } from "vitest";
import { assignCallNames, baseCallName } from "./names";
import type { SearchResult } from "../../types";

function entry(source: string, operation: string): SearchResult {
  return {
    id: `${source}-${operation}`,
    source,
    type: "mcp",
    kind: "mcp_tool",
    operation,
    title: operation,
    executionRef: { source, kind: "mcp", tool: operation }
  };
}

describe("gateway function names", () => {
  it("sanitizes source and operation into a codemode-safe function name", () => {
    expect(baseCallName(entry("workos-api", "GET /users/{id}"))).toBe("workos_api_GET_users_id");
  });

  it("assigns deterministic suffixes for collisions", () => {
    expect(assignCallNames([entry("a-b", "tool"), entry("a_b", "tool")]).map((item) => item.callName)).toEqual([
      "a_b_tool",
      "a_b_tool_2"
    ]);
  });
});
