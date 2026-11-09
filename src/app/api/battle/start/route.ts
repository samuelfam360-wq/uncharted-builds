import { currentPlayerId, handle } from "@/lib/api";
import { beginBattle } from "@/lib/game/service";
import { getStore } from "@/lib/store";

export const POST = handle(async ({ zoneId }) => beginBattle(getStore(), await currentPlayerId(), zoneId));
