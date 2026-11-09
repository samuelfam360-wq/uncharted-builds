import "server-only";
import { MemoryStore } from "./memory";
import { SupabaseStore } from "./supabase";
import type { GameStore } from "./types";

const g = globalThis as unknown as { __ubStore?: GameStore };

/**
 * Supabase when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set, otherwise an
 * in-memory store so the game is playable locally with zero setup (data resets
 * when the dev server restarts).
 */
export function getStore(): GameStore {
  if (!g.__ubStore) {
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    g.__ubStore = url && key ? new SupabaseStore(url, key) : new MemoryStore();
  }
  return g.__ubStore;
}
