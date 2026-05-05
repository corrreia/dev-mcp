import type { Env } from "../types";
import { getUserId } from "./better-auth";

export interface AuthContext {
  userId: string | null;
}

export async function requireAuth(request: Request, env: Env): Promise<AuthContext> {
  const userId = await getUserId(request, env);
  if (userId) return { userId };

  const auth = request.headers.get("authorization");
  const expected = env.BETTER_AUTH_SECRET;
  if (!expected) {
    throw new Response("Unauthorized", { status: 401 });
  }
  if (!auth?.startsWith("Bearer ")) {
    throw new Response("Unauthorized", { status: 401 });
  }
  const token = auth.slice("Bearer ".length);
  if (!(await timingSafeEqual(token, expected))) {
    throw new Response("Unauthorized", { status: 401 });
  }
  return { userId: "api-token" };
}

export async function optionalAuth(request: Request, env: Env): Promise<AuthContext> {
  const userId = await getUserId(request, env);
  return { userId };
}

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  const digestA = await crypto.subtle.digest("SHA-256", left);
  const digestB = await crypto.subtle.digest("SHA-256", right);
  const aBytes = new Uint8Array(digestA);
  const bBytes = new Uint8Array(digestB);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < aBytes.length && i < bBytes.length; i += 1) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}
