import { describe, expect, it } from "vitest";
import { MONSTERS } from "../src/lib/game/data/world";
import { attackSpec, rollHit } from "../src/lib/game/live";
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
