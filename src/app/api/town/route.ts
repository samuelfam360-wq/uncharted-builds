import { currentPlayerId, handle } from "@/lib/api";
import { GameError } from "@/lib/game/character";
import { eat, rest, rumors, weaponAction } from "@/lib/game/service";
import { getStore } from "@/lib/store";

export const POST = handle(async (body) => {
  const store = getStore();
  const id = await currentPlayerId();
  switch (body.action) {
    case "rest":
      await rest(store, id);
      return { log: ["You rest at the inn. HP and MP fully restored."] };
    case "weapon":
      await weaponAction(store, id, body.weapon);
      return { ok: true };
    case "eat":
      return eat(store, id, body.itemId);
    case "rumors":
      return { rumors: await rumors(store, id) };
  }
  throw new GameError("Unknown action");
});
