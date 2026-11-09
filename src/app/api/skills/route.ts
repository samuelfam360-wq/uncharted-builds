import { currentPlayerId, handle } from "@/lib/api";
import { GameError } from "@/lib/game/character";
import { respondToOffer, setEquipped } from "@/lib/game/service";
import { getStore } from "@/lib/store";

export const POST = handle(async ({ skillId, action }) => {
  const store = getStore();
  const id = await currentPlayerId();
  if (typeof skillId !== "string") throw new GameError("Missing skill");
  switch (action) {
    case "accept":
      return respondToOffer(store, id, skillId, true);
    case "decline":
      return respondToOffer(store, id, skillId, false);
    case "equip":
      return setEquipped(store, id, skillId, true);
    case "unequip":
      return setEquipped(store, id, skillId, false);
  }
  throw new GameError("Unknown action");
});
