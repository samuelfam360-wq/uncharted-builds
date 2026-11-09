import { describe, expect, it } from "vitest";
import { damageFormula, hitChance, resolveTurn, startBattle, type BattleState, type Rng } from "../src/lib/game/combat";
import { derive, newCharacter } from "../src/lib/game/character";
import { MONSTERS } from "../src/lib/game/data/world";
import { STARTER_SKILLS } from "../src/lib/game/data/skills";
import { emptyStats } from "../src/lib/game/constants";
import type { PlayerSkill, Stats, WeaponType } from "../src/lib/game/types";

const defs = new Map(STARTER_SKILLS.map((d) => [d.id, d]));
const seq = (...vals: number[]): Rng => {
  let i = 0;
  return () => vals[i++ % vals.length];
};

function setup(stats: Partial<Stats>, monster = "green_slime", skills: PlayerSkill[] = [], weapon: WeaponType = "sword") {
  // Build stats directly so tests can use values beyond the starting points.
  const p = newCharacter({ name: "Tester", classId: "free", stats: {} }, "p1");
  p.weapon = weapon;
  p.stats = { ...emptyStats(), ...stats };
  const d = derive(p, skills, defs, null);
  p.currentHp = d.maxHp;
  p.currentMp = d.maxMp;
  const b = startBattle({
    id: "b1",
    playerId: "p1",
    playerName: p.name,
    zoneId: "mirewood_fields",
    kind: "field",
    monster: MONSTERS[monster],
    derived: d,
    currentHp: p.currentHp,
    currentMp: p.currentMp,
    weapon,
    dodgeStreak: 0,
    hazard: null,
    run: null,
  });
  return { p, d, b };
}

describe("damage formula", () => {
  it("matches max(0, ATK x mult - DEF) + piercing", () => {
    expect(damageFormula(30, 1, 10)).toBe(20);
    expect(damageFormula(10, 1, 50)).toBe(0); // high defense means 0, as designed
    expect(damageFormula(10, 1, 50, 7)).toBe(7); // piercing ignores defense
    expect(damageFormula(20, 1.5, 10)).toBe(20); // crit multiplies before defense
  });

  it("hit chance compares DEX with AGI and stays in range", () => {
    expect(hitChance(10, 10)).toBeCloseTo(0.9);
    expect(hitChance(0, 500)).toBe(0.05);
    expect(hitChance(500, 0)).toBe(0.98);
  });
});

describe("turn resolution", () => {
  it("a pure STR build one-shots a rabbit and records kill counters", () => {
    const { d, b } = setup({ STR: 30 }, "horned_rabbit");
    // rng: hit roll, crit roll (no crit), drop roll
    const { state } = resolveTurn(b, { type: "attack" }, { derived: d, defs, inventory: [], rng: seq(0.1, 0.99, 0.1) });
    expect(state.over).toBe(true);
    expect(state.result).toBe("win");
    expect(state.deltas.kills_sword.value).toBe(1);
    expect(state.deltas.one_hit_kills.value).toBe(1);
    expect(state.rewards?.exp).toBe(MONSTERS.horned_rabbit.exp);
  });

  it("a pure VIT tank takes 0 damage and logs blocked damage", () => {
    const { d, b } = setup({ VIT: 30 }, "green_slime");
    // player waits; enemy: attack choice, hit roll (hit)
    const { state } = resolveTurn(b, { type: "wait" }, { derived: d, defs, inventory: [], rng: seq(0.1, 0.1) });
    expect(state.player.hp).toBe(state.player.maxHp);
    expect(state.deltas.zero_damage_hits.value).toBe(1);
    expect(state.deltas.damage_blocked.value).toBeGreaterThan(0);
    expect(state.deltas.turns_without_attacking.value).toBe(1);
  });

  it("status effects ignore defense (poison hurts the tank)", () => {
    const { d, b } = setup({ VIT: 30 }, "bog_toad");
    const s: BattleState = { ...b, player: { ...b.player, statuses: [{ type: "poison", turns: 2 }] } };
    // enemy picks basic attack, which misses
    const { state } = resolveTurn(s, { type: "wait" }, { derived: d, defs, inventory: [], rng: seq(0.01, 0.99) });
    expect(state.player.hp).toBe(state.player.maxHp - Math.round(state.player.maxHp * 0.05));
  });

  it("area attacks can't be dodged", () => {
    const { d, b } = setup({ AGI: 30 }, "mirefang");
    // Force Toxic Breath: weights 3/2/1, roll 0.6*6 = 3.6 lands in the breath
    const { state } = resolveTurn(b, { type: "wait" }, { derived: d, defs, inventory: [], rng: seq(0.6, 0.99) });
    expect(state.player.hp).toBeLessThan(state.player.maxHp);
    expect(state.deltas.hits_dodged).toBeUndefined();
  });

  it("Iron Endurance doubles VIT", () => {
    const p = newCharacter({ name: "Tank", classId: "tanker", stats: { VIT: 5 } }, "p");
    p.stats.VIT = 20;
    const owned: PlayerSkill[] = [{ skillId: "iron_endurance", status: "owned", equipped: true, stage: 1, evolvedInto: null, unlockedAt: "" }];
    expect(derive(p, owned, defs, null).stats.VIT).toBe(40);
    expect(derive(p, [{ ...owned[0], equipped: false }], defs, null).stats.VIT).toBe(20);
  });

  it("rejects skills that aren't equipped, and eating items you don't have", () => {
    const { d, b } = setup({ STR: 10 });
    expect(() => resolveTurn(b, { type: "skill", skillId: "twin_cut" }, { derived: d, defs, inventory: [], rng: Math.random })).toThrow();
    expect(() => resolveTurn(b, { type: "eat", itemId: "slime_jelly" }, { derived: d, defs, inventory: [], rng: Math.random })).toThrow();
  });

  it("eating inedible drops counts toward Glutton", () => {
    const { d, b } = setup({ VIT: 30 });
    const { state, consumed } = resolveTurn(
      b,
      { type: "eat", itemId: "slime_jelly" },
      { derived: d, defs, inventory: [{ itemId: "slime_jelly", qty: 2 }], rng: seq(0.1, 0.1) },
    );
    expect(consumed).toEqual(["slime_jelly"]);
    expect(state.deltas.inedible_eaten.value).toBe(1);
  });
});

describe("progression numbers", () => {
  it("characters start with 10 points and can level to 100", async () => {
    const { STARTING_POINTS, LEVEL_CAP, POINTS_PER_LEVEL } = await import("../src/lib/game/constants");
    const { grantExp } = await import("../src/lib/game/character");
    expect(STARTING_POINTS).toBe(10);
    expect(POINTS_PER_LEVEL).toBe(5);
    expect(() => newCharacter({ name: "Greedy", classId: "free", stats: { STR: 11 } }, "x")).toThrow(/10 points/);
    expect(() => newCharacter({ name: "Greedy", classId: "swordsman", stats: { STR: 6 } }, "x")).toThrow(/5 points/);
    const p = newCharacter({ name: "Ok", classId: "swordsman", stats: { STR: 5 } }, "y");
    expect(p.stats.STR).toBe(10);
    expect(p.freePoints).toBe(0);
    const maxed = grantExp(p, 1e12).player;
    expect(maxed.level).toBe(LEVEL_CAP);
    expect(maxed.level).toBe(100);
    expect(maxed.freePoints).toBe(99 * POINTS_PER_LEVEL);
  });
});
