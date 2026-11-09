import { cookies } from "next/headers";
import { PLAYER_COOKIE, handle } from "@/lib/api";
import { createCharacter } from "@/lib/game/service";
import { getStore } from "@/lib/store";

export const POST = handle(async (body) => {
  const p = await createCharacter(getStore(), body);
  (await cookies()).set(PLAYER_COOKIE, p.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return { id: p.id };
});

// Start over with a new character (Phase 1 has no accounts).
export const DELETE = handle(async () => {
  (await cookies()).delete(PLAYER_COOKIE);
  return { ok: true };
});
