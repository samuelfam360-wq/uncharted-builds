import { describe, expect, it } from "vitest";
import type { Engine, Monster } from "../src/components/side/engine";
import { MASTERY_SKILLS } from "../src/lib/game/data/mastery-skills";
import { MONSTERS, type EnemyAttack } from "../src/lib/game/data/world";
import { attackSpec, maxHit } from "../src/lib/game/live";
import { describeCondition } from "../src/lib/game/reveal";
import * as game from "../src/lib/game/service";
import { blank, engineSetup, faceOff, give, newPlayer, seeded } from "./helpers";

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

  it("Horn Rabbit weapon: a real weapon of the type in your hand, +20 STR only while equipped", async () => {
    const { store, p } = await newPlayer();
    const before = await game.getState(store, p.id);
    expect(before.hornWeapon).toBeNull();
    // earning it the real way: the 20th fall, with 50 rabbits already beaten
    await store.applyCounters(p.id, { defeated_horned_rabbit: { op: "set", value: 50 }, killed_by_horned_rabbit: { op: "set", value: 19 } });
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 10_000);
    const res = await game.liveReport(store, p.id, blank("mirewood_fields", { type: "death", monsterId: "horned_rabbit", hp: 0 }), seeded(), t);
    const note = res.unlocks.find((u) => u.id === "horn_rabbit_weapons")!;
    expect(note.name).toBe("Horn Rabbit Sword");
    expect(note.weapon).toBe(true);
    const got = await game.getState(store, p.id);
    expect(got.hornWeapon).toMatchObject({ type: "sword", name: "Horn Rabbit Sword", grade: "Special", equipped: true, attack: before.weapons.find((w) => w.type === "sword")!.attack });
    expect(got.combat.stats.STR - before.combat.stats.STR).toBe(20);
    // it is not a skill: not in the list, not in a slot, can't be equipped as one
    expect(got.skills.some((s) => s.id === "horn_rabbit_weapons")).toBe(false);
    expect(got.slots.passive.used).toBe(before.slots.passive.used);
    await expect(game.setEquipped(store, p.id, "horn_rabbit_weapons", true)).rejects.toThrow();
    // the stronger hits are accepted by the server
    const cap = maxHit(attackSpec("sword", got.combat), got.combat);
    expect(cap).toBeGreaterThan(maxHit(attackSpec("sword", before.combat), before.combat));
    // unequip: the ordinary sword, no bonus
    await game.weaponAction(store, p.id, "sword", "unequip");
    const off = await game.getState(store, p.id);
    expect(off.player.weapon).toBe("sword");
    expect(off.hornWeapon?.equipped).toBe(false);
    expect(off.combat.stats.STR).toBe(before.combat.stats.STR);
    // equip again, then switch to another weapon: the bonus leaves with it, and it is never handed out twice
    await game.weaponAction(store, p.id, "sword", "equip");
    expect((await game.getState(store, p.id)).combat.stats.STR - before.combat.stats.STR).toBe(20);
    const pl = (await store.getPlayer(p.id))!;
    pl.ownedWeapons = [...pl.ownedWeapons, "hammer"];
    await store.savePlayer(pl);
    await game.weaponAction(store, p.id, "hammer");
    const ham = await game.getState(store, p.id);
    expect(ham.hornWeapon).toMatchObject({ type: "sword", equipped: false });
    expect(ham.combat.stats.STR).toBe(before.combat.stats.STR);
  });

  it("Horn Rabbit weapon: an old owner of the skill gets the weapon; bare fists wait for a weapon", async () => {
    const def = MASTERY_SKILLS.find((s) => s.id === "horn_rabbit_weapons")!;
    expect(def.effect).toEqual({});
    // someone who had it as a skill, holding a hammer
    const a = await newPlayer("blacksmith");
    await give(a.store, a.p.id, "horn_rabbit_weapons");
    const sa = await game.getState(a.store, a.p.id);
    expect(sa.hornWeapon).toMatchObject({ type: "hammer", name: "Horn Rabbit Hammer", equipped: true });
    expect(sa.skills.some((s) => s.id === "horn_rabbit_weapons")).toBe(false);
    // with bare fists there is nothing to make it from yet
    const b = await newPlayer("free");
    await give(b.store, b.p.id, "horn_rabbit_weapons");
    expect((await game.getState(b.store, b.p.id)).hornWeapon).toBeNull();
    await expect(game.weaponAction(b.store, b.p.id, "sword", "equip")).rejects.toThrow();
    const pl = (await b.store.getPlayer(b.p.id))!;
    pl.ownedWeapons = [...pl.ownedWeapons, "bow"];
    pl.weapon = "bow";
    await b.store.savePlayer(pl);
    expect((await game.getState(b.store, b.p.id)).hornWeapon).toMatchObject({ type: "bow", name: "Horn Rabbit Bow", equipped: true });
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

  it("Wolf's Scars: monsters inside the aura also wind up and recover slower", async () => {
    const windup = async (skills: string[]) => {
      const { e, run } = await engineSetup("mirewood_fields", skills);
      const m = faceOff(e, "thorn_wolf");
      e.monsters = [m];
      m.aggro = true;
      m.nextAttackAt = 0;
      e.player.invulnUntil = 1e12;
      let start = -1;
      let end = -1;
      for (let t = 0; t < 4000 && end < 0; t += 16) {
        run(16);
        if (start < 0 && m.state === "windup") start = t;
        if (start >= 0 && m.state === "recover") end = t;
      }
      return { len: end - start, gap: m.nextAttackAt - e.now };
    };
    const plain = await windup([]);
    const scarred = await windup(["wolfs_scars"]);
    expect(plain.len).toBeGreaterThan(0);
    expect(scarred.len / plain.len).toBeGreaterThan(1.3);
    expect(scarred.len / plain.len).toBeLessThan(1.55);
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
