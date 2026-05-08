import type { SearchResult } from "../../types";

export function baseCallName(entry: Pick<SearchResult, "source" | "operation">): string {
  return sanitizeToolName(`${entry.source}_${entry.operation}`) || "source";
}

export function assignCallNames<T extends SearchResult>(entries: T[]): T[] {
  const used = new Set<string>();
  return entries.map((entry) => {
    const base = baseCallName(entry);
    let callName = base;
    let index = 2;
    while (used.has(callName)) {
      callName = `${base}_${index}`;
      index += 1;
    }
    used.add(callName);
    return { ...entry, callName };
  });
}

function sanitizeToolName(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[A-Za-z_]/.test(sanitized) ? sanitized : `_${sanitized}`;
}
