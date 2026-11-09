import { currentPlayerId, handle } from "@/lib/api";
import { getState } from "@/lib/game/service";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const GET = handle(async () => getState(getStore(), await currentPlayerId()));
