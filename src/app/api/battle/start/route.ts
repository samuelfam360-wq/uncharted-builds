import { currentPlayerId, handle } from "@/lib/api";
import { beginBattle } from "@/lib/game/service";
import { getStore } from "@/lib/store";

export const POST = handle(async ({ zoneId, terrain }) =>
  beginBattle(getStore(), await currentPlayerId(), String(zoneId), Math.random, terrain === "swamp" || terrain === "grass" ? terrain : undefined),
);
