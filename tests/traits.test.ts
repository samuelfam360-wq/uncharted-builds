import { describe, expect, it } from "vitest";
import { MASTERY_SKILLS } from "../src/lib/game/data/mastery-skills";
import { MONSTERS } from "../src/lib/game/data/world";
import { BOND_HEARTS, TRAIT_COST, activeTraits, breed, knownTraits, learnTrait, newPet, petStats, setTraits, traitSlots } from "../src/lib/game/pets";
import { describeCondition } from "../src/lib/game/reveal";
import * as game from "../src/lib/game/service";
import { blank, give, hit, newPlayer, seeded } from "./helpers";

describe("pet traits", () => {
  it("each species has its own trait, on from the start; it lifts the stat 10%", () => {
    const w = newPet("thorn_wolf", "w");
    expect(knownTraits(w)).toEqual(["str_up"]);
    expect(activeTraits(w)).toEqual(["str_up"]);
    expect(petStats(w).STR).toBe(Math.floor(MONSTERS.thorn_wolf.stats.STR * 1.1));
    setTraits(w, []);
    expect(petStats(w).STR).toBe(MONSTERS.thorn_wolf.stats.STR);
  });

  it("slots: 1, a 2nd at 3 hearts, a 3rd at 5; learning costs pet points", () => {
    const p = newPet("green_slime", "s");
    expect(traitSlots(p)).toBe(1);
    expect(() => learnTrait(p, "str_up")).toThrow(`${TRAIT_COST} pet points`);
    p.petPoints = TRAIT_COST * 2;
    learnTrait(p, "str_up");
    expect(p.petPoints).toBe(TRAIT_COST);
    expect(() => learnTrait(p, "str_up")).toThrow("already knows");
    expect(() => learnTrait(p, "all_up")).toThrow("can't be learned");
    expect(() => setTraits(p, ["hp_up", "str_up"])).toThrow("1 trait slot");
    p.bond = BOND_HEARTS[2];
    expect(traitSlots(p)).toBe(2);
    setTraits(p, ["hp_up", "str_up"]);
    p.bond = BOND_HEARTS[4];
    expect(traitSlots(p)).toBe(3);
    expect(traitSlots(p, 1)).toBe(4); // Kindred Spirit
    expect(() => setTraits(p, ["dex_up"])).toThrow("doesn't know");
  });

  it("a bred baby knows both parent species' traits and what they learned", () => {
    const a = Object.assign(newPet("thorn_wolf", "a"), { level: 50, learned: ["dex_up"] });
    const b = Object.assign(newPet("green_slime", "b"), { level: 50 });
    const baby = breed(a, b, "c");
    expect(knownTraits(baby).sort()).toEqual(["dex_up", "hp_up", "str_up"]);
  });
});

describe("Kindred Spirit", () => {
  it("is on; 5 pets at full bond unlock it; with the wand in hand every pet gets +1 slot", async () => {
    const ks = MASTERY_SKILLS.find((s) => s.id === "kindred_spirit")!;
    expect(ks.enabled).toBe(true);
    expect(ks.effect).toEqual({ weapons: ["tamer_wand"], passive: { kindred_spirit: { extra_slots: 1 } } });
    expect(describeCondition(ks.conditions)[0]).toContain("5 pets at full bond");

    const { store, p } = await newPlayer("tamer", { MP: 3, HP: 2 });
    await game.chooseFirstPet(store, p.id, "thorn_wolf");
    const pl = (await store.getPlayer(p.id))!;
    for (const [i, s] of ["green_slime", "bog_toad", "mire_bat", "moss_golem"].entries()) pl.pets.push(newPet(s, `p${i}`));
    for (const x of pl.pets) x.bond = BOND_HEARTS[4];
    await store.savePlayer(pl);
    // any fight report with a pet out counts them
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 60_000);
    const hp = MONSTERS.green_slime.stats.HP;
    const bites = Array.from({ length: Math.ceil(hp / 5) }, () => hit(5, { pet: true }));
    const r = await game.liveReport(
      store,
      p.id,
      blank("mirewood_fields", { type: "kill", monsterId: "green_slime", hits: bites, petToTarget: bites.length * 5, hitsOnTarget: bites.length, petKill: true }),
      seeded(),
      t,
    );
    expect((await store.getCounters(p.id)).max_bond_pets).toBe(5);
    expect(r.unlocks.map((u) => u.id)).toContain("kindred_spirit");
    await give(store, p.id, "kindred_spirit");
    const st = await game.getState(store, p.id);
    expect(st.pets.every((x) => x.slots === 4)).toBe(true);
    // a 4th trait can go on
    const wolf = st.pets.find((x) => x.species === "thorn_wolf")!;
    const pl2 = (await store.getPlayer(p.id))!;
    pl2.pets.find((x) => x.id === wolf.id)!.petPoints = TRAIT_COST * 3;
    await store.savePlayer(pl2);
    for (const tr of ["hp_up", "vit_up", "agi_up"]) await game.petTraits(store, p.id, wolf.id, { learn: tr });
    const res = await game.petTraits(store, p.id, wolf.id, { set: ["str_up", "hp_up", "vit_up", "agi_up"] });
    expect(res.pet.traits.filter((x) => x.on)).toHaveLength(4);
    // wand put away: back to 3 slots, so only the first 3 count
    const pl3 = (await store.getPlayer(p.id))!;
    pl3.weapon = "sword";
    pl3.ownedWeapons = [...pl3.ownedWeapons, "sword"];
    await store.savePlayer(pl3);
    const st2 = await game.getState(store, p.id);
    const w2 = st2.pets.find((x) => x.id === wolf.id)!;
    expect(w2.slots).toBe(3);
    expect(w2.traits.filter((x) => x.on).map((x) => x.id)).toEqual(["str_up", "hp_up", "vit_up"]);
  });
});
