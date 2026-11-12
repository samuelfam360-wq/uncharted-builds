import { currentPlayerId, handle } from "@/lib/api";
import { GameError } from "@/lib/game/character";
import { breedPets, chooseFirstPet, feedPet, petTraits, listBreeds, petAddPoints, setActivePet } from "@/lib/game/service";
import { getStore } from "@/lib/store";

export const POST = handle(async (body) => {
  const store = getStore();
  const id = await currentPlayerId();
  switch (body.action) {
    case "choose_first":
      return chooseFirstPet(store, id, String(body.species ?? ""));
    case "set_active":
      return setActivePet(store, id, typeof body.petId === "string" ? body.petId : null, body.out !== false);
    case "add_points":
      return petAddPoints(store, id, String(body.petId ?? ""), body.alloc && typeof body.alloc === "object" ? body.alloc : {});
    case "learn_trait":
      return petTraits(store, id, String(body.petId ?? ""), { learn: String(body.traitId ?? "") });
    case "set_traits":
      return petTraits(store, id, String(body.petId ?? ""), { set: Array.isArray(body.traits) ? body.traits.map(String) : [] });
    case "feed":
      return feedPet(store, id, String(body.petId ?? ""), String(body.itemId ?? ""));
    case "breed":
      return breedPets(store, id, String(body.a ?? ""), String(body.b ?? ""));
    case "breeds":
      return { breeds: await listBreeds(store) };
  }
  throw new GameError("Unknown action");
});
