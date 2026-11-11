import { currentPlayerId, handle } from "@/lib/api";
import { cleanReport } from "@/lib/game/live";
import { liveEnter, liveReport } from "@/lib/game/service";
import { getStore } from "@/lib/store";

/** Live fights on the side-view maps: { type: "enter", zoneId } or a report (kill / death / sync). */
export const POST = handle(async (body) => {
  const store = getStore();
  const playerId = await currentPlayerId();
  if (body?.type === "enter") return liveEnter(store, playerId, String(body.zoneId ?? ""));
  return liveReport(store, playerId, cleanReport(body));
});
