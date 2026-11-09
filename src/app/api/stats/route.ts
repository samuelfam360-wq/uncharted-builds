import { currentPlayerId, handle } from "@/lib/api";
import { spendPoints } from "@/lib/game/service";
import { getStore } from "@/lib/store";

export const POST = handle(async (body) => spendPoints(getStore(), await currentPlayerId(), body.add ?? {}));
