import { describe, expect, it } from "vitest";
import { MONSTERS } from "../src/lib/game/data/world";
import { BOND_GAIN, BOND_HEARTS, addBond, addOutTime, heartsOf, newPet, petBase, petStats } from "../src/lib/game/pets";
import * as game from "../src/lib/game/service";
import { blank, hit, newPlayer, seeded } from "./helpers";

describe("pet bond", () => {
  it("hearts come from bond; each heart lifts every stat 2%", () => {
    const p = newPet("moss_golem", "g");
    p.stats.HP = 100;
    const hp0 = petStats(p).HP;
    expect(heartsOf(p)).toBe(0);
    expect(addBond(p, BOND_HEARTS[0] - 1)).toBe(0);
    expect(addBond(p, 1)).toBe(1);
    expect(heartsOf(p)).toBe(1);
    expect(petStats(p).HP).toBe(Math.floor(hp0 * 1.02));
    addBond(p, 1e6);
    expect(heartsOf(p)).toBe(5);
    expect(petStats(p).HP).toBe(Math.floor(hp0 * 1.1));
    expect(petBase("moss_golem").HP).toBe(MONSTERS.moss_golem.stats.HP);
  });

  it("time out with you becomes bond, a point per 5 minutes, and the rest carries over", () => {
    const p = newPet("green_slime", "s");
    addOutTime(p, 4 * 60_000);
    expect(p.bond ?? 0).toBe(0);
    addOutTime(p, 2 * 60_000);
    expect(p.bond).toBe(1);
    expect(p.outMs).toBe(60_000);
  });

  it("wins with the pet out, meals and time out all grow bond; full bond counts for Kindred Spirit", async () => {
    const { store, p } = await newPlayer("tamer", { MP: 3, HP: 2 });
    await game.chooseFirstPet(store, p.id, "thorn_wolf");
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 60_000);
    const hp = MONSTERS.green_slime.stats.HP;
    const bites = Array.from({ length: Math.ceil(hp / 5) }, () => hit(5, { pet: true }));
    await game.liveReport(
      store,
      p.id,
      blank("mirewood_fields", { type: "kill", monsterId: "green_slime", hits: bites, petToTarget: bites.length * 5, hitsOnTarget: bites.length, petKill: true }),
      seeded(),
      t,
    );
    let pet = (await game.getState(store, p.id)).pets[0];
    expect(pet.bond).toBe(BOND_GAIN.kill);
    expect(pet.hearts).toBe(0);
    expect(pet.nextHeart).toBe(BOND_HEARTS[0]);
    // a meal: food only, from the bag
    await expect(game.feedPet(store, p.id, pet.id, "rabbit_meat")).rejects.toThrow("don't have");
    await store.changeItem(p.id, "rabbit_meat", 2);
    const r = await game.feedPet(store, p.id, pet.id, "rabbit_meat");
    expect(r.pet.bond).toBe(BOND_GAIN.kill + BOND_GAIN.feed);
    expect((await store.getInventory(p.id)).find((i) => i.itemId === "rabbit_meat")!.qty).toBe(1);
    // nearly full bond, then one more meal: five hearts, and the counter knows
    const pl = (await store.getPlayer(p.id))!;
    pl.pets[0].bond = BOND_HEARTS[4] - 1;
    await store.savePlayer(pl);
    const r2 = await game.feedPet(store, p.id, pet.id, "rabbit_meat");
    expect(r2.pet.hearts).toBe(5);
    expect(r2.log[0]).toContain("closer to you: 5 ♥");
    expect((await store.getCounters(p.id)).max_bond_pets).toBe(1);
    // ten minutes out with you in a fight report
    const b0 = (await game.getState(store, p.id)).pets[0].bond;
    await game.liveReport(store, p.id, blank("mirewood_fields"), seeded(), t + 10 * 60_000);
    pet = (await game.getState(store, p.id)).pets[0];
    expect(pet.bond).toBe(b0 + 2);
  });
});
