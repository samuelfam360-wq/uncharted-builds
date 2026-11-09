import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { GameError } from "./game/character";

export const PLAYER_COOKIE = "ub_player";
export const ADMIN_COOKIE = "ub_admin";

export async function currentPlayerId(): Promise<string> {
  const id = (await cookies()).get(PLAYER_COOKIE)?.value;
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) throw new GameError("No character yet", 401);
  return id;
}

/** Wrap a route handler: JSON in, JSON out, game errors become 4xx. */
export function handle<T>(fn: (body: any) => Promise<T>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  return async (req: Request) => {
    try {
      const body = req.method === "GET" ? {} : await req.json().catch(() => ({}));
      return NextResponse.json((await fn(body)) ?? { ok: true });
    } catch (e) {
      if (e instanceof GameError) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error(e);
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
  };
}

// ---------- Admin ----------

const hash = (s: string) => createHash("sha256").update(`ub-admin:${s}`).digest("hex");

export function adminPassword(): string | null {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  // Local play without config: allow a dev password so the page is usable.
  return process.env.NODE_ENV === "production" ? null : "admin";
}

export function adminToken(password: string) {
  return hash(password);
}

export async function requireAdmin() {
  const pw = adminPassword();
  if (!pw) throw new GameError("Set ADMIN_PASSWORD to use the admin page", 403);
  const got = (await cookies()).get(ADMIN_COOKIE)?.value ?? "";
  const want = adminToken(pw);
  if (got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) throw new GameError("Admin login required", 401);
}
