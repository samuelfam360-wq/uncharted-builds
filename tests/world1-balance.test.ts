import { describe, expect, it } from "vitest";
import { MONSTERS } from "../src/lib/game/data/world";
import { attackSpec, rollEnemyHit, rollHit } from "../src/lib/game/live";
import { WEAPONS } from "../src/lib/game/constants";
import type { WeaponType } from "../src/lib/game/types";

// A level 1 character who put the class's fixed 5 and their 5 free points into the stat their weapon hits with.
const fresh = (stat: "STR" | "DEX") => ({
  stats: { HP: 100, MP: 20, STR: stat === "STR" ? 10 : 0, VIT: 0, AGI: 0, DEX: stat === "DEX" ? 10 : 0, INT: 0 },
  passive: { damage_multiplier: 1 },
});

describe("World 1: the Moss Golem can be hurt", () => {
  const golem = MONSTERS.moss_golem.stats;
  const physical: [WeaponType, "STR" | "DEX"][] = [
    ["sword", "STR"],
    ["daggers", "STR"],
    ["lance", "STR"],
    ["hammer", "STR"],
    ["strength_bracelet", "STR"],
    ["bow", "DEX"],
    ["pistol", "DEX"],
  ];
  for (const [weapon, stat] of physical) {
    it(`a fresh ${weapon} user hits it for more than 0`, () => {
      const a = fresh(stat);
      const r = rollHit(() => 0.99, attackSpec(weapon, a), a, golem, 1, { sure: true });
      expect(r.miss).toBe(false);
      expect(r.dmg).toBeGreaterThan(0);
    });
  }

  it("is still tougher than the field monsters but softer than the boss", () => {
    const field = ["green_slime", "horned_rabbit", "bog_toad", "thorn_wolf", "mire_bat"].map((id) => MONSTERS[id].stats.VIT);
    expect(golem.VIT).toBeGreaterThan(Math.max(...field));
    expect(golem.VIT).toBeLessThan(MONSTERS.mirefang.stats.VIT);
  });
});

describe("every weapon can hurt every monster", () => {
  // the weakest possible start: 0 in every stat, so only the weapon (and the damage floor) counts
  const zero = { stats: { HP: 100, MP: 20, STR: 0, VIT: 0, AGI: 0, DEX: 0, INT: 0 }, passive: { damage_multiplier: 1 } };
  for (const weapon of Object.keys(WEAPONS) as WeaponType[]) {
    it(`${weapon} lands real damage on every monster, even with 0 stats`, () => {
      for (const m of Object.values(MONSTERS)) {
        const r = rollHit(() => 0.99, attackSpec(weapon, zero), zero, m.stats, 1, { sure: true });
        expect(r.dmg, `${weapon} vs ${m.id}`).toBeGreaterThan(0);
      }
    });
  }

  it("a 3 STR Free Class with bare fists hurts the slime and the rabbit properly", () => {
    const a = { stats: { HP: 100, MP: 20, STR: 3, VIT: 0, AGI: 1, DEX: 0, INT: 0 }, passive: { damage_multiplier: 1 } };
    const hit = (id: string) => rollHit(() => 0.99, attackSpec("unarmed", a), a, MONSTERS[id].stats, 1, { sure: true }).dmg;
    expect(hit("green_slime")).toBe(5);
    expect(hit("horned_rabbit")).toBe(6);
  });

  it("monster hits on players still have no floor: high VIT blocks them completely", () => {
    const r = rollEnemyHit(() => 0, MONSTERS.green_slime.attacks[0], MONSTERS.green_slime.stats, { VIT: 500, INT: 0, AGI: 0 }, "unarmed", false);
    expect(r.dmg).toBe(0);
  });
});
