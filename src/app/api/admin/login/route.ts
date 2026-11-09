import { cookies } from "next/headers";
import { ADMIN_COOKIE, adminPassword, adminToken, handle } from "@/lib/api";
import { GameError } from "@/lib/game/character";

export const POST = handle(async ({ password }) => {
  const pw = adminPassword();
  if (!pw) throw new GameError("Set ADMIN_PASSWORD to use the admin page", 403);
  if (password !== pw) throw new GameError("Wrong password", 401);
  (await cookies()).set(ADMIN_COOKIE, adminToken(pw), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return { ok: true };
});
