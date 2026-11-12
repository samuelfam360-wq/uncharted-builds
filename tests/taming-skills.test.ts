import { describe, expect, it } from "vitest";
import { MASTERY_SKILLS } from "../src/lib/game/data/mastery-skills";
import { MONSTERS } from "../src/lib/game/data/world";
import { attackSpec, maxHit } from "../src/lib/game/live";
import { petAttacker } from "../src/lib/game/pets";
import { describeCondition } from "../src/lib/game/reveal";
import * as game from "../src/lib/game/service";
import type { BossTally } from "../src/lib/game/live";
import { blank, engineSetup, faceOff, give, hit, newPlayer, seeded } from "./helpers";

describe("Taming mastery skills", () => {
  it("use the design's names and unlocks; the ones waiting on missing systems are off", () => {
    const by = new Map(MASTERY_SKILLS.map((s) => [s.id, s]));
    expect(describeCondition(by.get("shared_glory")!.conditions)).toEqual(["Your pet lands 5,000 killing blows"]);
    expect(describeCondition(by.get("beast_tongue")!.conditions)).toEqual(["Tame 50 different species"]);
    expect(["Shared Glory", "Beast Tongue", "Pack Leader", "Kindred Spirit", "Primal Bond"].every((n) => MASTERY_SKILLS.some((s) => s.name === n))).toBe(true);
    expect(by.get("shared_glory")!.enabled && by.get("beast_tongue")!.enabled).toBe(true);
  });

  it("Shared Glory: the pet out borrows 20% of your stats (wand in hand) and earns 50% more EXP", async () => {
    const { store, p } = await newPlayer("tamer", { MP: 3, HP: 2 });
    await game.chooseFirstPet(store, p.id, "thorn_wolf");
    const plain = (await game.getState(store, p.id)).pets[0].stats;
    await give(store, p.id, "shared_glory");
    const st = await game.getState(store, p.id);
    expect(st.combat.passive.shared_glory).toEqual({ stat_share: 0.2, exp_mult: 1.5 });
    const glory = st.pets[0].stats;
    expect(glory.STR).toBe(plain.STR + Math.floor(st.derived.stats.STR * 0.2));
    expect(glory.HP).toBe(plain.HP + Math.floor(st.derived.stats.HP * 0.2));
    // the server allows the stronger bites
    const pl = (await store.getPlayer(p.id))!;
    const g = petAttacker(pl.pets[0], { stats: st.derived.stats, share: 0.2 });
    const cap = maxHit(attackSpec("unarmed", g), g);
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 60_000);
    const hp = MONSTERS.green_slime.stats.HP;
    const bites = Array.from({ length: Math.ceil(hp / cap) }, () => hit(cap, { pet: true }));
    await game.liveReport(
      store,
      p.id,
      blank("mirewood_fields", { type: "kill", monsterId: "green_slime", hits: bites, petToTarget: bites.length * cap, hitsOnTarget: bites.length, petKill: true }),
      seeded(),
      t,
    );
    const after = (await store.getPlayer(p.id))!.pets[0];
    const exp = Math.round(MONSTERS.green_slime.exp * 1.5);
    expect(after.exp + (after.level > 1 ? 1e9 : 0)).toBe(exp);
    // without the wand in hand it sleeps
    const pl2 = (await store.getPlayer(p.id))!;
    pl2.weapon = "sword";
    pl2.ownedWeapons = [...pl2.ownedWeapons, "sword"];
    await store.savePlayer(pl2);
    expect((await game.getState(store, p.id)).combat.passive.shared_glory).toBeUndefined();
  });

  it("Beast Tongue: the next attack is named a second early, and it's the one that comes", async () => {
    const { e, run, store, p } = await engineSetup("mirewood_fields", ["beast_tongue"], "tamer");
    void store;
    void p;
    expect(e.combat.passive.beast_tongue).toEqual({ early_ms: 1000 });
    e.monsters = e.monsters.filter((m) => m.id === "horned_rabbit").slice(0, 1);
    const m = faceOff(e, "horned_rabbit");
    m.nextAttackAt = e.now + 1500;
    e.player.hp = e.player.maxHp = 1e6;
    const texts = () => (e as unknown as { texts: { text: string }[] }).texts.map((t) => t.text);
    run(400);
    expect(m.foreseen).toBeUndefined();
    run(400); // now within a second of its attack
    const told = m.foreseen;
    expect(told).toBeDefined();
    expect(texts()).toContain(`${told!.name} next!`);
    for (let i = 0; i < 200 && m.state !== "windup"; i++) run(16);
    expect(m.state).toBe("windup");
    expect(m.attack).toBe(told);
    expect(m.foreseen).toBeUndefined();
  });
});

describe("Pack Leader: two pets out at once", () => {
  it("one pet out swaps; with Pack Leader (wand in hand) two go out, a third is refused", async () => {
    const { store, p } = await newPlayer("tamer", { MP: 3, HP: 2 });
    await game.chooseFirstPet(store, p.id, "thorn_wolf");
    const pl = (await store.getPlayer(p.id))!;
    const { newPet } = await import("../src/lib/game/pets");
    pl.pets.push(newPet("green_slime", "s"), newPet("bog_toad", "t"));
    await store.savePlayer(pl);
    let st = await game.getState(store, p.id);
    expect(st.summonLimit).toBe(1);
    await game.setActivePet(store, p.id, "s");
    st = await game.getState(store, p.id);
    expect(st.pets.filter((x) => x.active).map((x) => x.id)).toEqual(["s"]);
    await give(store, p.id, "pack_leader");
    st = await game.getState(store, p.id);
    expect(st.summonLimit).toBe(2);
    await game.setActivePet(store, p.id, "t");
    st = await game.getState(store, p.id);
    expect(st.pets.filter((x) => x.active).map((x) => x.id).sort()).toEqual(["s", "t"]);
    const wolf = st.pets.find((x) => x.species === "thorn_wolf")!.id;
    await expect(game.setActivePet(store, p.id, wolf)).rejects.toThrow(/Only 2 pets/);
    await game.setActivePet(store, p.id, "t", false);
    await game.setActivePet(store, p.id, wolf);
    st = await game.getState(store, p.id);
    expect(st.pets.filter((x) => x.active).map((x) => x.species).sort()).toEqual(["green_slime", "thorn_wolf"]);

    // a win with both out: both share it, the biter gets the kill, and it counts for Pack Leader
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 60_000);
    const hp = MONSTERS.green_slime.stats.HP;
    const bites = Array.from({ length: Math.ceil(hp / 5) }, () => hit(5, { pet: true }));
    await game.liveReport(
      store,
      p.id,
      blank("mirewood_fields", { type: "kill", monsterId: "green_slime", hits: bites, petToTarget: bites.length * 5, hitsOnTarget: bites.length, petKill: true, petKillId: wolf }),
      seeded(),
      t,
    );
    st = await game.getState(store, p.id);
    const out = st.pets.filter((x) => x.active);
    expect(out.map((x) => x.petPoints)).toEqual([1, 1]);
    expect(st.pets.find((x) => x.id === wolf)!.kills).toBe(1);
    expect(st.pets.find((x) => x.id === "s")!.kills).toBe(0);
    expect((await store.getCounters(p.id)).max_pack_fights).toBe(1);
  });

  it("in the game, both pets follow you and bite", async () => {
    const { e, run, reports } = await engineSetup("mirewood_fields", [], "tamer");
    const atk = { stats: { HP: 40, MP: 0, STR: 9, VIT: 3, AGI: 2, DEX: 5, INT: 2 }, passive: { damage_multiplier: 1 } };
    e.setPets([
      { id: "a", species: "thorn_wolf", attacker: atk },
      { id: "b", species: "green_slime+thorn_wolf", attacker: atk },
    ]);
    expect(e.pets).toHaveLength(2);
    e.monsters = e.monsters.filter((m) => m.id === "moss_golem" || m.id === "bog_toad").slice(0, 1);
    const m = faceOff(e, e.monsters[0].id);
    m.hp = m.maxHp = 1e6;
    m.nextAttackAt = 1e12;
    run(6000);
    e.flush();
    const bites = reports.flatMap((r) => r.hits).filter((h) => h.pet);
    expect(bites.length).toBeGreaterThanOrEqual(8); // two pets, about one bite a second each
    // updating keeps the pets where they are
    const x = e.pets[1].x;
    e.setPets([
      { id: "a", species: "thorn_wolf", attacker: atk },
      { id: "b", species: "green_slime+thorn_wolf", attacker: atk },
    ]);
    expect(e.pets[1].x).toBe(x);
  });
});

describe("Primal Bond: the pet's ultimate", () => {
  const HOLLOW = "hollow_of_the_mire";
  const tally = (t: Partial<BossTally>): BossTally => ({ hits: 0, parries: 0, parryDmg: 0, dodges: 0, weaponHits: 0, dmg: 0, mp: 0, healed: 0, charges: 0, ...t });

  /** A tamer with a wolf out, in the Hollow at Mirefang's room. */
  async function tamerAtBoss(t: number) {
    const { store, p } = await newPlayer("tamer", { MP: 3, HP: 2 });
    await game.chooseFirstPet(store, p.id, "thorn_wolf");
    await game.liveEnter(store, p.id, HOLLOW, t - 600_000);
    await store.applyCounters(p.id, { [`run_${HOLLOW}_room`]: { op: "set", value: 3 } });
    const st = await game.getState(store, p.id);
    const pl = (await store.getPlayer(p.id))!;
    const g = petAttacker(pl.pets[0], { stats: st.derived.stats, share: 0 });
    const cap = maxHit(attackSpec("unarmed", g), g);
    return { store, p, cap };
  }

  it("is on, for a tamer wand, and its unlock reads plainly", () => {
    const pb = MASTERY_SKILLS.find((s) => s.id === "primal_bond")!;
    expect(pb.enabled).toBe(true);
    expect(pb.effect).toEqual({ weapons: ["tamer_wand"], active: { ultimate: { gauge: "boss_pet_hits", tiers: [50, 100, 200] } } });
    expect(describeCondition(pb.conditions)).toEqual(["Win 1 boss fight where your pet does all the damage"]);
  });

  it("a boss your pet beats all on its own unlocks it; a boss you hit too doesn't count", async () => {
    const t = Date.now();
    const { store, p, cap } = await tamerAtBoss(t);
    const hp = MONSTERS.mirefang.stats.HP;
    const n = Math.ceil(hp / cap);
    const bites = Array.from({ length: n }, () => hit(cap, { pet: true }));
    // you landed a hit on it too: no unlock
    const shared = blank(HOLLOW, { type: "kill", monsterId: "mirefang", hits: [...bites, hit(1)], petToTarget: n * cap, directToTarget: 1, hitsOnTarget: n + 1, bossEnd: true, boss: tally({ weaponHits: 1, dmg: 1, petHits: n }) });
    await game.liveReport(store, p.id, shared, seeded(), t - 300_000);
    expect((await store.getCounters(p.id)).pet_solo_boss_wins ?? 0).toBe(0);
    // again, the pet alone
    await game.liveEnter(store, p.id, HOLLOW, t - 200_000);
    await store.applyCounters(p.id, { [`run_${HOLLOW}_room`]: { op: "set", value: 3 } });
    const solo = blank(HOLLOW, { type: "kill", monsterId: "mirefang", hits: bites, petToTarget: n * cap, hitsOnTarget: n, petKill: true, bossEnd: true, boss: tally({ petHits: n }) });
    const r = await game.liveReport(store, p.id, solo, seeded(), t);
    expect((await store.getCounters(p.id)).pet_solo_boss_wins).toBe(1);
    expect(r.unlocks.map((u) => u.id)).toContain("primal_bond");
  });

  it("pet bites on the boss charge the gauge; more than landed is refused, and it needs a pet out", async () => {
    const t = Date.now();
    const { store, p } = await tamerAtBoss(t);
    await give(store, p.id, "primal_bond");
    const ult = blank(HOLLOW, { hits: [hit(210, { skillId: "primal_bond", ult: 1 })] });
    await expect(game.liveReport(store, p.id, ult, seeded(), t - 500_000)).rejects.toThrow("isn't charged");
    await expect(game.liveReport(store, p.id, blank(HOLLOW, { boss: tally({ petHits: 1 }) }), seeded(), t - 500_000)).rejects.toThrow("don't add up");
    const bites = Array.from({ length: 50 }, () => hit(1, { pet: true }));
    await game.liveReport(store, p.id, blank(HOLLOW, { hits: bites, boss: tally({ petHits: 50 }) }), seeded(), t - 400_000);
    expect((await store.getCounters(p.id)).bf_pet_hits).toBe(50);
    // put the pet away: no giant to strike
    const pl = (await store.getPlayer(p.id))!;
    await game.setActivePet(store, p.id, pl.pets[0].id, false);
    await expect(game.liveReport(store, p.id, ult, seeded(), t - 300_000)).rejects.toThrow("no pet out");
    await game.setActivePet(store, p.id, pl.pets[0].id);
    await expect(game.liveReport(store, p.id, ult, seeded(), t - 200_000)).resolves.toBeTruthy();
    // the boss fight ends: the gauge empties
    await game.liveReport(store, p.id, blank(HOLLOW, { bossEnd: true }), seeded(), t);
    expect((await store.getCounters(p.id)).bf_pet_hits).toBe(0);
  });

  it("in the game, pet bites fill the gauge and firing turns the pet giant beside the boss", async () => {
    const { e, run, reports, toasts } = await engineSetup(HOLLOW, ["primal_bond"], "tamer");
    e.setRun({ room: 3, totalRooms: 4, cleared: false });
    e.player.x = e.map.rooms[3].x0 * 64 + 40;
    run(50);
    const boss = e.monsters.find((m) => m.id === "mirefang")!;
    boss.aggro = true;
    e.player.x = boss.x - 90;
    e.player.y = boss.y;
    e.player.facing = 1;
    boss.nextAttackAt = 1e12;
    e.player.hp = e.player.maxHp = 1e6;
    (e as unknown as { engage(m: unknown): void }).engage(boss);
    // no pet out: it won't fire
    e.bossFight!.petHits = 50;
    e.press("skill0");
    run(16);
    expect(toasts.at(-1)).toContain("needs your pet out");
    expect(boss.hp).toBe(boss.maxHp);
    e.bossFight!.petHits = 0;
    const atk = { stats: { HP: 40, MP: 0, STR: 9, VIT: 3, AGI: 2, DEX: 5, INT: 2 }, passive: { damage_multiplier: 1 } };
    e.setPets([{ id: "a", species: "thorn_wolf", attacker: atk }]);
    boss.hp = boss.maxHp = 1e6;
    run(5000);
    const n = e.bossFight!.petHits;
    expect(n).toBeGreaterThan(2);
    expect(e.skillState(0)!.gauge).toMatchObject({ value: n });
    e.flush();
    const sent = reports.reduce((k, r) => k + (r.boss.petHits ?? 0), 0);
    expect(sent).toBe(n);
    expect(sent).toBe(reports.flatMap((r) => r.hits).filter((h) => h.pet && !h.miss).length);
    // charge it and fire
    e.bossFight!.petHits = 50;
    run(700);
    e.press("skill0");
    run(16);
    expect(boss.hp).toBe(boss.maxHp - Math.ceil(boss.maxHp / 2));
    const pet = e.pets[0];
    expect(pet.giantUntil).toBeGreaterThan(e.now);
    expect(Math.abs(pet.x - boss.x)).toBeLessThan(200);
    e.flush();
    expect(reports.flatMap((r) => r.hits).find((h) => h.ult)).toMatchObject({ skillId: "primal_bond", ult: 1 });
  });
});
