import { currentPlayerId, handle } from "@/lib/api";
import { GameError } from "@/lib/game/character";
import type { BattleAction } from "@/lib/game/combat";
import { battleAction } from "@/lib/game/service";
import { getStore } from "@/lib/store";

const TYPES = ["attack", "skill", "defend", "wait", "flee", "eat"];

// The client only says what it wants to do. Every number is decided here.
export const POST = handle(async ({ action }) => {
  if (!action || !TYPES.includes(action.type)) throw new GameError("Unknown action");
  const clean: BattleAction =
    action.type === "skill"
      ? { type: "skill", skillId: String(action.skillId) }
      : action.type === "eat"
        ? { type: "eat", itemId: String(action.itemId) }
        : { type: action.type };
  return battleAction(getStore(), await currentPlayerId(), clean);
});
