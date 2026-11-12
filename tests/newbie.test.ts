import { describe, expect, it } from "vitest";
import type { Engine, Monster } from "../src/components/side/engine";
import { MASTERY_SKILLS } from "../src/lib/game/data/mastery-skills";
import { MONSTERS, type EnemyAttack } from "../src/lib/game/data/world";
import { attackSpec, maxHit } from "../src/lib/game/live";
import { describeCondition } from "../src/lib/game/reveal";
import * as game from "../src/lib/game/service";
import { blank, engineSetup, faceOff, give, hit, newPlayer, seeded } from "./helpers";

const strike = (e: Engine, m: Monster, atk: EnemyAttack) => (e as unknown as { enemyStrikesPlayer(m: Monster, a: EnemyAttack): void }).enemyStrikesPlayer(m, atk);
const owned = async (store: Awaited<ReturnType<typeof newPlayer>>["store"], id: string, skill: string) =>
  (await store.getPlayerSkills(id)).some((s) => s.skillId === skill && s.status === "owned");

describe("skills for those who keep falling", () => {
  it("use Samuel's names and unlocks", () => {
    const by = new Map(MASTERY_SKILLS.map((s) => [s.id, s]));
    const txt = (id: string) => describeCondition(by.get(id)!.conditions).join(" | ");
    expect(by.get("green_slimes_mercy")?.name).toBe("Green Slime's Mercy");
    expect(txt("green_slimes_mercy")).toBe("Fall to a Green Slime 20 times");
    expect(by.get("horn_rabbit_weapons")?.name).toBe("Horn Rabbit Weapons");
    expect(txt("horn_rabbit_weapons")).toBe("Fall to a Horned Rabbit 20 times | Defeat 50 Horned Rabbits");
    expect(by.get("poison_toad_armour")?.name).toBe("Poison Toad Armour");
    expect(txt("poison_toad_armour")).toBe("Fall to a Bog Toad's poison 20 times");
    expect(by.get("wolfs_scars")?.name).toBe("Wolf's Scars");
    expect(txt("wolfs_scars")).toBe("Fall to a Thorn Wolf 20 times");
  });

  it("falling 20 times to a Green Slime unlocks Green Slime's Mercy; poison deaths count for the toad", async () => {
    const { store, p } = await newPlayer();
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 3_000_000);
    for (let i = 0; i < 19; i++) await game.liveReport(store, p.id, blank("mirewood_fields", { type: "death", monsterId: "green_slime", hp: 0 }), seeded(), t - 2_000_000 + i * 1000);
    expect(await owned(store, p.id, "green_slimes_mercy")).toBe(false);
    await game.liveReport(store, p.id, blank("mirewood_fields", { type: "death", monsterId: "green_slime", hp: 0 }), seeded(), t - 1_900_000);
    expect(await owned(store, p.id, "green_slimes_mercy")).toBe(true);
    // the toad's poison: only a death by poison, with poison damage taken, counts
    await game.liveReport(store, p.id, blank("mirewood_fields", { type: "death", monsterId: "bog_toad", hp: 0 }), seeded(), t - 1_800_000);
    await game.liveReport(store, p.id, blank("mirewood_fields", { type: "death", monsterId: "bog_toad", deathBy: "poison", hp: 0 }), seeded(), t - 1_700_000);
    await game.liveReport(
      store,
      p.id,
      blank("mirewood_fields", { type: "death", monsterId: "bog_toad", deathBy: "poison", taken: { enemy: 0, hazard: 0, poison: 6, burn: 0 }, statuses: ["poison"], hp: 0 }),
      seeded(),
      t - 1_600_000,
    );
    const c = await store.getCounters(p.id);
    expect(c.killed_by_bog_toad).toBe(3);
    expect(c.poison_deaths_bog_toad).toBe(1);
  });

  it("Green Slime's Mercy: slimes' blows bounce off, other monsters still hurt", async () => {
    const { e } = await engineSetup("mirewood_fields", ["green_slimes_mercy"]);
    expect(e.combat.passive.slime_mercy).toEqual({ monsters: ["green_slime"] });
    const hp = e.player.hp;
    const slime = faceOff(e, "green_slime");
    strike(e, slime, MONSTERS.green_slime.attacks[0]);
    expect(e.player.hp).toBe(hp);
    e.player.invulnUntil = 0;
    e.combat.stats.AGI = 0;
    const rabbit = e.monsters.find((m) => m.id === "horned_rabbit")!;
    for (let i = 0; i < 20 && e.player.hp === hp; i++) {
      e.player.invulnUntil = 0;
      strike(e, rabbit, MONSTERS.horned_rabbit.attacks[0]);
    }
    expect(e.player.hp).toBeLessThan(hp);
  });

  it("Horn Rabbit Weapons: 50% more on Horned Rabbits, and the server accepts it", async () => {
    const plain = await engineSetup("mirewood_fields", []);
    const bane = await engineSetup("mirewood_fields", ["horn_rabbit_weapons"]);
    const avg = (s: typeof plain) => {
      const m = faceOff(s.e, "horned_rabbit");
      m.hp = m.maxHp = 1e6;
      m.nextAttackAt = 1e12;
      s.e.held.attack = true;
      s.run(4000);
      s.e.held.attack = false;
      s.e.flush();
      const hs = s.reports.flatMap((r) => r.hits).filter((h) => !h.miss && !h.crit && !h.pet);
      return { avg: hs.reduce((n, h) => n + h.dmg, 0) / hs.length, hs };
    };
    const a = avg(plain);
    const b = avg(bane);
    expect(b.hs.every((h) => h.foe === "horned_rabbit")).toBe(true);
    expect(b.avg / a.avg).toBeGreaterThan(1.3);
    for (const r of bane.reports) await game.liveReport(bane.store, bane.p.id, r, seeded(), bane.clock() + 60_000);
    // without the skill, a hit that big (or a claim of it) is refused
    const { store, p } = await newPlayer();
    const st = await game.getState(store, p.id);
    const cap = maxHit(attackSpec("sword", st.combat), st.combat);
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 10_000);
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { hits: [hit(Math.floor(cap * 1.5), { foe: "horned_rabbit" })] }), seeded(), t)).rejects.toThrow();
    await give(store, p.id, "horn_rabbit_weapons");
    await game.liveReport(store, p.id, blank("mirewood_fields", { hits: [hit(Math.floor(cap * 1.5), { foe: "horned_rabbit" })] }), seeded(), t);
    // the bonus is only for the monsters it names
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { hits: [hit(Math.floor(cap * 1.5), { foe: "thorn_wolf" })] }), seeded(), t + 1000)).rejects.toThrow();
  });

  it("Poison Toad Armour: +10% poison resistance", async () => {
    const { store, p } = await newPlayer();
    const before = (await game.getState(store, p.id)).combat.statusResist.poison ?? 0;
    await give(store, p.id, "poison_toad_armour");
    const after = (await game.getState(store, p.id)).combat.statusResist.poison ?? 0;
    expect(after - before).toBeCloseTo(0.1);
  });

  it("Wolf's Scars: monsters inside the aura move slower", async () => {
    const dist = async (skills: string[]) => {
      const { e, run } = await engineSetup("mirewood_fields", skills);
      const m = faceOff(e, "thorn_wolf");
      e.monsters = [m];
      m.nextAttackAt = 1e12;
      m.span = [0, 1e5];
      m.x = e.player.x + 190;
      const x0 = m.x;
      run(300);
      return x0 - m.x;
    };
    const plain = await dist([]);
    const scarred = await dist(["wolfs_scars"]);
    expect(plain).toBeGreaterThan(0);
    expect(scarred / plain).toBeCloseTo(0.7, 1);
  });

  it("poison that finishes you is blamed on whoever poisoned you", async () => {
    const { e, reports } = await engineSetup("mirewood_fields", []);
    const toad = faceOff(e, "bog_toad");
    toad.nextAttackAt = 1e12;
    e.combat.stats.AGI = 0;
    const spit = MONSTERS.bog_toad.attacks.find((a) => a.name === "Venom Spit")!;
    e.combat.statusResist = {};
    for (let i = 0; i < 30 && !e.player.statuses.poison; i++) {
      e.player.invulnUntil = 0;
      strike(e, toad, { ...spit, multiplier: 0, status: { type: "poison", chance: 1, turns: 50 } });
    }
    expect(e.player.statuses.poison).toBeDefined();
    e.player.hp = 1;
    // move the toad away so only the poison is left
    toad.x += 5000;
    let now = 0;
    for (let i = 0; i < 400 && !e.player.dead; i++) e.update(16, (now += 16) + 1e6);
    expect(e.player.dead).toBe(true);
    const death = reports.find((r) => r.type === "death")!;
    expect(death).toMatchObject({ monsterId: "bog_toad", deathBy: "poison" });
  });
});
