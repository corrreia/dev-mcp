const MAX_RESPONSE_CHARS = 24_000;

export function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

export function safeJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "undefined";
}

export function truncateResult(value: unknown): string {
  const text = typeof value === "string" ? value : safeJson(value);
  if (text.length <= MAX_RESPONSE_CHARS) return text;
  return `${text.slice(0, MAX_RESPONSE_CHARS)}\n\n--- TRUNCATED ---\nUse a narrower search or smaller execute result.`;
}

export function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init?.headers
    }
  });
}
