import { describe, expect, it } from "vitest";
import type { Engine, Monster } from "../src/components/side/engine";
import { MONSTERS, type EnemyAttack } from "../src/lib/game/data/world";
import { attackSpec, maxHit, type LiveReport, type ReportHit } from "../src/lib/game/live";
import { FIRST_PET_CHOICES, TAMEABLE, addPetPoints, grantPetExp, newPet, petAttacker, petCap, petStats } from "../src/lib/game/pets";
import * as game from "../src/lib/game/service";
import type { MemoryStore } from "../src/lib/store/memory";
import { blank, engineSetup, faceOff, hit, newPlayer, seeded } from "./helpers";

const strike = (e: Engine, m: Monster, atk: EnemyAttack) => (e as unknown as { enemyStrikesPlayer(m: Monster, a: EnemyAttack): void }).enemyStrikesPlayer(m, atk);
const land = (e: Engine, m: Monster, h: ReportHit) => (e as unknown as { applyHit(m: Monster, h: ReportHit): void }).applyHit(m, h);
const attackNamed = (id: string, name: string) => MONSTERS[id].attacks.find((a) => a.name === name)!;

async function sendAll(store: MemoryStore, playerId: string, reports: LiveReport[], at: number) {
  const out = [];
  for (const r of reports) out.push(await game.liveReport(store, playerId, r, seeded(), at));
  return out;
}

async function giveWand(store: MemoryStore, playerId: string) {
  const p = (await store.getPlayer(playerId))!;
  p.weapon = "tamer_wand";
  p.ownedWeapons = [...new Set([...p.ownedWeapons, "tamer_wand" as const])];
  await store.savePlayer(p);
}

describe("pet basics", () => {
  it("every monster but the boss can be tamed; a Tamer's first pet comes from Mirewood Fields", () => {
    expect(TAMEABLE).not.toContain("mirefang");
    expect(TAMEABLE).toEqual(expect.arrayContaining(["green_slime", "horned_rabbit", "bog_toad", "thorn_wolf", "mire_bat", "moss_golem"]));
    expect(FIRST_PET_CHOICES).toEqual(["green_slime", "horned_rabbit", "bog_toad", "thorn_wolf"]);
  });

  it("a pet's stats are its species' numbers plus placed points, up to a cap", () => {
    const pet = newPet("green_slime", "x");
    expect(petStats(pet)).toEqual({ HP: 40, STR: 9, VIT: 3, AGI: 2, DEX: 5, INT: 2 });
    expect(grantPetExp(pet, 1000)).toBeGreaterThan(0);
    expect(pet.freePoints).toBe((pet.level - 1) * 5);
    addPetPoints(pet, { STR: 2 });
    expect(petStats(pet).STR).toBe(11);
    expect(() => addPetPoints(pet, { STR: 1000 })).toThrow();
    expect(() => addPetPoints(pet, { MP: 1 })).toThrow(/Unknown stat/);
    expect(petCap("green_slime", "STR")).toBe(45);
    expect(() => addPetPoints({ ...pet, freePoints: 100 }, { STR: 40 })).toThrow(/can't go past 45/);
  });
});

describe("a Tamer's first pet and the Pets menu", () => {
  it("only a new Tamer picks a first pet, once; it's sent out at once", async () => {
    const { store, p } = await newPlayer("tamer", { MP: 3, HP: 2 });
    let st = await game.getState(store, p.id);
    expect(st.firstPetChoices.map((c) => c.name)).toEqual(["Green Slime", "Horned Rabbit", "Bog Toad", "Thorn Wolf"]);
    await expect(game.chooseFirstPet(store, p.id, "moss_golem")).rejects.toThrow(/Mirewood Fields/);
    await game.chooseFirstPet(store, p.id, "thorn_wolf");
    st = await game.getState(store, p.id);
    expect(st.pets).toHaveLength(1);
    expect(st.pets[0]).toMatchObject({ name: "Thorn Wolf", level: 1, active: true });
    expect(st.firstPetChoices).toEqual([]);
    await expect(game.chooseFirstPet(store, p.id, "green_slime")).rejects.toThrow(/new Tamer/);

    const sw = await newPlayer("swordsman");
    expect((await game.getState(sw.store, sw.p.id)).firstPetChoices).toEqual([]);
    await expect(game.chooseFirstPet(sw.store, sw.p.id, "green_slime")).rejects.toThrow(/new Tamer/);
  });

  it("send a pet out or call it back, and place its points", async () => {
    const { store, p } = await newPlayer("tamer", { MP: 3, HP: 2 });
    const { pet } = await game.chooseFirstPet(store, p.id, "green_slime");
    await game.setActivePet(store, p.id, null);
    expect((await game.getState(store, p.id)).pets[0].active).toBe(false);
    await expect(game.setActivePet(store, p.id, "nope")).rejects.toThrow(/isn't yours/);
    await game.setActivePet(store, p.id, pet.id);
    expect((await game.getState(store, p.id)).pets[0].active).toBe(true);
    await expect(game.petAddPoints(store, p.id, pet.id, { STR: 1 })).rejects.toThrow(/only has 0/);
  });
});

describe("pets in the server's checks", () => {
  it("pet bites need a pet out and can't hit harder than the pet can", async () => {
    const { store, p } = await newPlayer("tamer", { MP: 3, HP: 2 });
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 60_000);
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { hits: [hit(3, { pet: true })] }), seeded(), t - 50_000)).rejects.toThrow(/no pet out/);
    const { pet } = await game.chooseFirstPet(store, p.id, "thorn_wolf");
    const pl = (await store.getPlayer(p.id))!;
    const cap = maxHit(attackSpec("unarmed", petAttacker(pl.pets[0])), petAttacker(pl.pets[0]));
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { hits: [hit(cap + 2, { pet: true })] }), seeded(), t - 40_000)).rejects.toThrow(/bigger than possible/);
    // a kill shared between you and your pet: the pet gets EXP, a pet point and the kill
    const hp = MONSTERS.green_slime.stats.HP;
    const petHits = Array.from({ length: Math.ceil(hp / cap) }, () => hit(cap, { pet: true }));
    const r = await game.liveReport(
      store,
      p.id,
      blank("mirewood_fields", { type: "kill", monsterId: "green_slime", hits: petHits, petToTarget: petHits.length * cap, hitsOnTarget: petHits.length, petKill: true }),
      seeded(),
      t,
    );
    expect(r.rewards?.exp).toBe(MONSTERS.green_slime.exp);
    const after = (await game.getState(store, p.id)).pets.find((x) => x.id === pet.id)!;
    expect(after.petPoints).toBe(1);
    expect(after.kills).toBe(1);
    expect(after.exp + (after.level > 1 ? 1 : 0)).toBeGreaterThan(0);
    expect((await store.getCounters(p.id)).pet_kills).toBe(1);
    // more pet damage than its bites dealt is refused
    await expect(
      game.liveReport(store, p.id, blank("mirewood_fields", { type: "kill", monsterId: "green_slime", hits: [], petToTarget: hp, directToTarget: 0 }), seeded(), t + 1000),
    ).rejects.toThrow(/your pet dealt/);
  });

  it("a fight that spans a sync still counts its kill (damage carries over)", async () => {
    const { store, p } = await newPlayer("swordsman", { STR: 3, HP: 2 });
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 60_000);
    await game.liveReport(store, p.id, blank("mirewood_fields", { hits: [hit(10), hit(10)] }), seeded(), t - 30_000);
    const r = await game.liveReport(store, p.id, blank("mirewood_fields", { type: "kill", monsterId: "green_slime", hits: [hit(10), hit(10)], directToTarget: 40, hitsOnTarget: 4 }), seeded(), t);
    expect(r.rewards).not.toBeNull();
    // the damage was used up by that kill
    await expect(
      game.liveReport(store, p.id, blank("mirewood_fields", { type: "kill", monsterId: "green_slime", hits: [], directToTarget: 40, hitsOnTarget: 0 }), seeded(), t + 1000),
    ).rejects.toThrow(/more damage than you dealt/);
  });
});

describe("taming on the server", () => {
  // a tame report dealing `dmg`, split into hits no bigger than `cap`
  const hitsOf = (dmg: number, cap = 1e9) => Array.from({ length: Math.ceil(dmg / cap) }, (_, i) => hit(Math.min(cap, dmg - i * cap)));
  const tameReport = (monsterId: string, dmg: number, extra: Partial<LiveReport> = {}, cap?: number, mapId = "mirewood_fields") => {
    const hits = hitsOf(dmg, cap);
    return blank(mapId, { type: "tame", monsterId, hits, directToTarget: dmg, hitsOnTarget: hits.length, ...extra });
  };
  const wandCap = async (store: MemoryStore, id: string) => {
    const st = await game.getState(store, id);
    return maxHit(attackSpec("tamer_wand", st.combat), st.combat);
  };

  const tameReport0 = tameReport;
  it("needs a tamer wand, a weak enough monster and its hidden condition", async () => {
    const { store, p } = await newPlayer("swordsman", { STR: 3, HP: 2 });
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 120_000);
    const hp = MONSTERS.horned_rabbit.stats.HP;
    await expect(game.liveReport(store, p.id, tameReport0("horned_rabbit", 24, { dodged: 3 }, 6), seeded(), t - 100_000)).rejects.toThrow(/tamer wand/);
    await giveWand(store, p.id);
    const cap = await wandCap(store, p.id);
    const tameReport = (id: string, dmg: number, extra: Partial<LiveReport> = {}) => tameReport0(id, dmg, extra, cap);
    await expect(game.liveReport(store, p.id, tameReport("mirefang", 10), seeded(), t - 90_000)).rejects.toThrow(/can't be tamed/);
    await expect(game.liveReport(store, p.id, tameReport("horned_rabbit", 10, { dodged: 3 }), seeded(), t - 80_000)).rejects.toThrow(/too strong/);
    await expect(game.liveReport(store, p.id, tameReport("horned_rabbit", hp, { dodged: 3 }), seeded(), t - 70_000)).rejects.toThrow(/already defeated/);
    await expect(game.liveReport(store, p.id, tameReport("horned_rabbit", 24, { dodged: 2 }), seeded(), t - 60_000)).rejects.toThrow(/won't come/);
    const r = await game.liveReport(store, p.id, tameReport("horned_rabbit", 24, { dodged: 3 }), seeded(), t);
    expect(r.tamed).toMatchObject({ name: "Horned Rabbit", level: 1, active: true });
    expect(r.log.join(" ")).toContain("Horned Rabbit joined you!");
    const c = await store.getCounters(p.id);
    expect([c.tames, c.tamed_horned_rabbit, c.species_tamed]).toEqual([1, 1, 1]);
    // taming grows Taming mastery
    expect(c.mxp_taming).toBeGreaterThan(0);
    // a second rabbit: one more tame, still one species
    await game.liveReport(store, p.id, tameReport("horned_rabbit", 24, { dodged: 3 }), seeded(), t + 30_000);
    const st = await game.getState(store, p.id);
    expect(st.pets).toHaveLength(2);
    expect(st.pets.filter((x) => x.active)).toHaveLength(1);
    expect((await store.getCounters(p.id)).species_tamed).toBe(1);
  });

  it("each species checks its own condition", async () => {
    const { store, p } = await newPlayer("tamer", { MP: 3, HP: 2 });
    await game.chooseFirstPet(store, p.id, "thorn_wolf");
    const cap = await wandCap(store, p.id);
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 600_000);
    const at = (k: number) => t - 500_000 + k * 20_000;
    const tameReport = (id: string, dmg: number, extra: Partial<LiveReport> = {}) => tameReport0(id, dmg, extra, cap);
    // Green Slime: you ate something
    await expect(game.liveReport(store, p.id, tameReport("green_slime", 30), seeded(), at(1))).rejects.toThrow(/won't come/);
    await store.changeItem(p.id, "rabbit_meat", 1);
    await game.liveReport(store, p.id, tameReport("green_slime", 30, { itemsUsed: ["rabbit_meat"] }), seeded(), at(2));
    // Bog Toad: poisoned in the swamp
    await expect(game.liveReport(store, p.id, tameReport("bog_toad", 40, { statuses: ["poison"] }), seeded(), at(3))).rejects.toThrow(/won't come/);
    await game.liveReport(store, p.id, tameReport("bog_toad", 40, { statuses: ["poison"], inSwamp: true }), seeded(), at(4));
    // Thorn Wolf: one-on-one, no food
    await expect(game.liveReport(store, p.id, tameReport("thorn_wolf", 55), seeded(), at(5))).rejects.toThrow(/won't come/);
    await game.liveReport(store, p.id, tameReport("thorn_wolf", 55, { duel: true }), seeded(), at(6));
    expect((await game.getState(store, p.id)).pets.map((x) => x.name)).toEqual(["Thorn Wolf", "Green Slime", "Bog Toad", "Thorn Wolf"]);
  });

  it("in the Hollow, taming the room's monster clears the room like a kill", async () => {
    const { store, p } = await newPlayer("tamer", { MP: 3, HP: 2 });
    const cap = await wandCap(store, p.id);
    const t = Date.now();
    await game.liveEnter(store, p.id, "hollow_of_the_mire", t - 300_000);
    const batHp = MONSTERS.mire_bat.stats.HP;
    const bat = (extra: Partial<LiveReport>) => tameReport("mire_bat", Math.ceil(batHp * 0.75), extra, cap, "hollow_of_the_mire");
    await expect(game.liveReport(store, p.id, bat({}), seeded(), t - 200_000)).rejects.toThrow(/won't come/);
    const r = await game.liveReport(store, p.id, bat({ statuses: ["silence"] }), seeded(), t - 100_000);
    expect(r.run).toMatchObject({ room: 1, cleared: false });
    // Moss Golem: 10 Crushing Fists blocked
    const golemHp = MONSTERS.moss_golem.stats.HP;
    const golem = (blocks: number) => tameReport("moss_golem", Math.ceil(golemHp * 0.75), { blocks }, cap, "hollow_of_the_mire");
    await expect(game.liveReport(store, p.id, golem(9), seeded(), t - 50_000)).rejects.toThrow(/won't come/);
    // the 9 blocks above were refused with the report, so 10 more are needed
    expect((await game.liveReport(store, p.id, golem(10), seeded(), t)).run).toMatchObject({ room: 2 });
  });
});

describe("pets and taming in the live game", () => {
  it("your pet follows you, bites what you fight, and the server accepts it", async () => {
    const { e, run, reports, store, p, clock } = await engineSetup("mirewood_fields", [], "tamer");
    await game.chooseFirstPet(store, p.id, "thorn_wolf");
    const st = await game.getState(store, p.id);
    const out = st.pets[0];
    e.setPet({ species: out.species, attacker: petAttacker((await store.getPlayer(p.id))!.pets[0]) });
    e.monsters = e.monsters.filter((m) => m.id === "green_slime").slice(0, 1);
    const m = faceOff(e, "green_slime");
    m.nextAttackAt = 1e12;
    run(8000);
    expect(m.state).toBe("dead");
    e.flush();
    const petBites = reports.flatMap((r) => r.hits).filter((h) => h.pet);
    expect(petBites.length).toBeGreaterThan(0);
    const kill = reports.find((r) => r.type === "kill")!;
    expect(kill.petToTarget).toBeGreaterThan(0);
    expect((kill.petToTarget ?? 0) + (kill.directToTarget ?? 0)).toBeGreaterThanOrEqual(MONSTERS.green_slime.stats.HP);
    expect(kill.petKill).toBe(true);
    await sendAll(store, p.id, reports, clock() + 60_000);
    const after = (await game.getState(store, p.id)).pets[0];
    expect(after.kills).toBe(1);
    expect(after.petPoints).toBe(1);
  });

  it("taming a Horned Rabbit: weaken it, dodge 3 Horn Charges in a row, press Tame", async () => {
    const { e, run, reports, store, p, clock } = await engineSetup("mirewood_fields", [], "tamer");
    expect(e.weapon).toBe("tamer_wand");
    e.monsters = e.monsters.filter((m) => m.id === "horned_rabbit").slice(0, 1);
    const m = faceOff(e, "horned_rabbit");
    m.nextAttackAt = 1e12;
    const cap = maxHit(attackSpec("tamer_wand", e.combat), e.combat);
    // weaken it to below 30% with hits the server will believe
    let dealt = 0;
    while ((m.maxHp - dealt) / m.maxHp >= 0.3) {
      const d = Math.min(cap, Math.ceil(m.maxHp * 0.71) - dealt);
      land(e, m, { dmg: d, crit: false, miss: false });
      dealt += d;
    }
    expect(m.state).not.toBe("dead");
    expect(e.tameTarget()).toBeNull(); // the condition isn't met yet
    run(50);
    // dodge its Horn Charge three times in a row (very quick feet)
    e.combat.stats.AGI = 500;
    const horn = attackNamed("horned_rabbit", "Horn Charge");
    for (let i = 0; i < 40 && (m.tame?.hornRun ?? 0) < 3; i++) strike(e, m, horn);
    expect(m.tame!.hornRun).toBe(3);
    const near = e.nearby();
    expect(near?.kind).toBe("tame");
    expect(e.tame(m)).toBe(true);
    expect(m.state).toBe("dead");
    e.flush();
    const results = await sendAll(store, p.id, reports, clock() + 60_000);
    expect(results.some((r) => r.tamed?.name === "Horned Rabbit")).toBe(true);
    expect((await game.getState(store, p.id)).pets).toHaveLength(1);
  });

  it("a hit Horn Charge breaks the run; a Moss Golem needs 10 blocked Crushing Fists", async () => {
    const { e, run } = await engineSetup("hollow_of_the_mire", [], "tamer");
    run(16);
    // build a golem by hand next to the player
    const mk = (e as unknown as { makeMonster(id: string, x: number, y: number, span: [number, number], i: number): Monster }).makeMonster.bind(e);
    const g = mk("moss_golem", e.player.x + 70, e.player.y, [e.player.x + 70, e.player.x + 70], -99);
    g.hp = Math.floor(g.maxHp * 0.2);
    e.monsters = [g];
    faceOff(e, "moss_golem");
    g.nextAttackAt = 1e12;
    (e as unknown as { engage(m: Monster): void }).engage(g);
    e.held.block = true;
    run(400); // block held well before the blow: a plain block, not a parry
    const fist = attackNamed("moss_golem", "Crushing Fist");
    // a blow that lands gives a moment of safety, so space the blows out
    for (let i = 0; i < 60 && g.tame!.fistBlocks < 9; i++) {
      strike(e, g, fist);
      e.player.hp = e.player.maxHp;
      run(1200);
    }
    expect(e.tameProgress(g)).toBeCloseTo(0.9);
    expect(e.tameTarget()).toBeNull();
    for (let i = 0; i < 20 && g.tame!.fistBlocks < 10; i++) {
      strike(e, g, fist);
      e.player.hp = e.player.maxHp;
      run(1200);
    }
    expect(e.tameTarget()).toBe(g);
  });
});

describe("breeding: a new mixed monster", () => {
  const grownPet = (species: string, id: string, extra: Partial<ReturnType<typeof newPet>> = {}) => {
    const p = newPet(species, id);
    p.level = 50;
    return { ...p, ...extra };
  };

  it("the baby is a new breed of both parents, starting at their average, capped at the higher parent", async () => {
    const { breed, breedSpecies, speciesName, petStats: ps, capOf } = await import("../src/lib/game/pets");
    const slime = grownPet("green_slime", "a", { stats: { HP: 100, STR: 10, VIT: 0, AGI: 0, DEX: 0, INT: 0 } });
    const wolf = grownPet("thorn_wolf", "b");
    const baby = breed(slime, wolf, "c");
    expect(baby.species).toBe("green_slime+thorn_wolf");
    expect(breedSpecies("thorn_wolf", "green_slime")).toBe(baby.species); // the same pair makes the same breed
    expect(speciesName(baby.species)).toBe("Green Slime × Thorn Wolf");
    expect(baby.level).toBe(1);
    expect(baby.freePoints).toBe(10);
    expect(baby.parents).toEqual(["green_slime", "thorn_wolf"]);
    const a = ps(slime);
    const b = ps(wolf);
    expect(ps(baby).STR).toBe(Math.floor((a.STR + b.STR) / 2));
    expect(capOf(baby, "HP")).toBe(Math.max(capOf(slime, "HP"), capOf(wolf, "HP")));
    // a breed of a breed carries every species once
    const toad = grownPet("bog_toad", "d");
    const grownBaby = { ...baby, level: 50 };
    expect(breed(grownBaby, toad, "e").species).toBe("bog_toad+green_slime+thorn_wolf");
    // the same species twice is just that species
    expect(breed(slime, grownPet("green_slime", "f"), "g").species).toBe("green_slime");
    expect(() => breed(slime, { ...wolf, level: 49 }, "h")).toThrow(/level 50/);
  });

  it("the server breeds, needs Taming mastery, and keeps track of every new breed", async () => {
    const { store, p } = await newPlayer("tamer", { MP: 3, HP: 2 });
    const pl = (await store.getPlayer(p.id))!;
    pl.pets = [grownPet("green_slime", "s1"), grownPet("thorn_wolf", "w1"), grownPet("thorn_wolf", "w2")];
    await store.savePlayer(pl);
    await expect(game.breedPets(store, p.id, "s1", "w1")).rejects.toThrow(/Taming mastery level 2/);
    expect((await game.getState(store, p.id)).breeding).toEqual({ level: 50, tamingLevel: 2, tamingOk: false });
    await store.applyCounters(p.id, { mxp_taming: { op: "set", value: 100 } });
    await expect(game.breedPets(store, p.id, "s1", "nope")).rejects.toThrow(/isn't yours/);
    const r = await game.breedPets(store, p.id, "s1", "w1");
    expect(r.pet).toMatchObject({ name: "Green Slime × Thorn Wolf", level: 1, bred: true, parents: ["Green Slime", "Thorn Wolf"] });
    expect(r.log.join(" ")).toContain("A new breed!");
    const again = await game.breedPets(store, p.id, "s1", "w2");
    expect(again.log.join(" ")).toContain("born 2 times");
    const list = await game.listBreeds(store);
    expect(list).toEqual([expect.objectContaining({ id: "green_slime+thorn_wolf", name: "Green Slime × Thorn Wolf", firstBredBy: "Rin", timesBred: 2 })]);
    // parents stay, babies join
    expect((await game.getState(store, p.id)).pets).toHaveLength(5);
  });
});
