import { describe, expect, it } from "vitest";
import { derive, freeStartingPoints, newCharacter } from "../src/lib/game/character";
import { resolveTurn, startBattle, type Rng } from "../src/lib/game/combat";
import { WEAPONS } from "../src/lib/game/constants";
import { APPEARANCE_KEYS, APPEARANCE_OPTIONS, CLASSES, DEFAULT_APPEARANCE } from "../src/lib/game/data/classes";
import { MONSTERS } from "../src/lib/game/data/world";
import { MemoryStore } from "../src/lib/store/memory";
import * as game from "../src/lib/game/service";
import { CLASS_IDS, WEAPON_TYPES, type ClassId, type WeaponType } from "../src/lib/game/types";

const total = (s: Record<string, number>) => Object.values(s).reduce((a, b) => a + b, 0);

describe("starting classes", () => {
  it("has exactly Samuel's 12 classes", () => {
    expect(CLASS_IDS.map((id) => CLASSES[id].name)).toEqual([
      "Swordsman",
      "Mage",
      "Assassin",
      "Tanker",
      "Ranger",
      "Gunslinger",
      "Tamer",
      "Lancer",
      "Saint",
      "Blacksmith",
      "Monk",
      "Free Class",
    ]);
  });

  const expected: Record<ClassId, { fixed: Record<string, number>; weapon: string }> = {
    swordsman: { fixed: { STR: 5 }, weapon: "Wood Sword" },
    mage: { fixed: { INT: 5 }, weapon: "Wood Staff" },
    assassin: { fixed: { AGI: 5 }, weapon: "Wood Dagger" },
    tanker: { fixed: { VIT: 5 }, weapon: "Wood Shield" },
    ranger: { fixed: { DEX: 5 }, weapon: "Wood Bow" },
    gunslinger: { fixed: { DEX: 5 }, weapon: "Wood Pistol" },
    tamer: { fixed: { MP: 5 }, weapon: "Wood Tamer Wand" },
    lancer: { fixed: { STR: 5 }, weapon: "Wood Lance" },
    saint: { fixed: { MP: 3, HP: 2 }, weapon: "Wood Healing Bracelet" },
    blacksmith: { fixed: { DEX: 5 }, weapon: "Wood Hammer" },
    monk: { fixed: { STR: 5 }, weapon: "Wood Strength Bracelet" },
    free: { fixed: {}, weapon: "Bare Fists" },
  };

  for (const id of CLASS_IDS) {
    it(`${CLASSES[id].name}: fixed points, starter weapon, 10 points in total`, () => {
      const p = newCharacter({ name: "Test", classId: id, stats: {} }, "p");
      const e = expected[id];
      for (const [k, v] of Object.entries(e.fixed)) expect(p.stats[k as keyof typeof p.stats]).toBe(v);
      expect(total(p.stats)).toBe(total(e.fixed));
      expect(WEAPONS[p.weapon].name).toBe(e.weapon);
      expect(p.freePoints).toBe(id === "free" ? 10 : 5);
      expect(p.freePoints + total(p.stats)).toBe(10);
      expect(p.ownedWeapons).toContain("unarmed");
      expect(p.classId).toBe(id);
      // Max HP/MP already include the class points.
      const d = derive(p, [], new Map(), null);
      expect(p.currentHp).toBe(d.maxHp);
      expect(p.currentMp).toBe(d.maxMp);
    });
  }

  it("free points go on top of class points", () => {
    const p = newCharacter({ name: "Saint", classId: "saint", stats: { HP: 3, INT: 2 } }, "p");
    expect(p.stats).toMatchObject({ MP: 3, HP: 5, INT: 2 });
    expect(p.freePoints).toBe(0);
    expect(freeStartingPoints("saint")).toBe(5);
    expect(freeStartingPoints("free")).toBe(10);
  });

  it("rejects an unknown class", () => {
    expect(() => newCharacter({ name: "Test", classId: "pirate" as ClassId, stats: {} }, "p")).toThrow(/class/);
  });

  it("every weapon is Common wood except bare fists", () => {
    for (const w of WEAPON_TYPES) {
      if (w === "unarmed") expect(WEAPONS[w].material).toBeNull();
      else expect([WEAPONS[w].material, WEAPONS[w].rarity, WEAPONS[w].name.startsWith("Wood ")]).toEqual(["Wood", "Common", true]);
    }
  });
});

describe("appearance", () => {
  it("keeps valid choices and replaces anything unknown with the default", () => {
    const p = newCharacter(
      { name: "Look", classId: "mage", appearance: { gender: "Female", hairColor: "Red", eyeColor: "<script>", build: 5 }, stats: {} },
      "p",
    );
    expect(p.appearance).toEqual({ ...DEFAULT_APPEARANCE, gender: "Female", hairColor: "Red" });
    for (const k of APPEARANCE_KEYS) expect(APPEARANCE_OPTIONS[k].options).toContain(DEFAULT_APPEARANCE[k]);
  });

  it("is shown in the player's state", async () => {
    const store = new MemoryStore();
    const p = await game.createCharacter(store, { name: "Lia", classId: "ranger", appearance: { gender: "Female", build: "Slim" }, stats: {} });
    const st = await game.getState(store, p.id);
    expect(st.className).toBe("Ranger");
    expect(st.look).toContain("Female");
    expect(st.look).toContain("slim build");
  });
});

describe("new weapons in combat", () => {
  const always = (v: number): Rng => () => v;

  function fight(weapon: WeaponType, stats: Partial<Record<"STR" | "DEX" | "INT", number>>) {
    const p = newCharacter({ name: "Test", classId: "free", stats: {} }, "p");
    p.weapon = weapon;
    p.stats = { ...p.stats, ...stats };
    const d = derive(p, [], new Map(), null);
    const b = startBattle({
      id: "b",
      playerId: "p",
      playerName: "Test",
      zoneId: "mirewood_fields",
      kind: "field",
      monster: MONSTERS.green_slime,
      derived: d,
      currentHp: d.maxHp,
      currentMp: d.maxMp,
      weapon,
      dodgeStreak: 0,
      run: null,
      hazard: null,
    });
    // rng 0.01: always hits, always crits; same for both weapons so only the scaling differs
    return resolveTurn(b, { type: "attack" }, { derived: d, defs: new Map(), inventory: [], rng: always(0.01) }).state;
  }

  it("bow and pistol hit with DEX, not STR", () => {
    const dexOnly = fight("pistol", { DEX: 30 });
    const strOnly = fight("pistol", { STR: 30 });
    expect(MONSTERS.green_slime.stats.HP - dexOnly.enemy.hp).toBeGreaterThan(MONSTERS.green_slime.stats.HP - strOnly.enemy.hp);
    const bowDex = fight("bow", { DEX: 30 });
    expect(MONSTERS.green_slime.stats.HP - bowDex.enemy.hp).toBeGreaterThan(0);
  });

  it("the strength bracelet fights with fists and counts as unarmed", () => {
    const s = fight("strength_bracelet", { STR: 200 });
    expect(s.log.join("\n")).toContain("Punch");
    expect(s.over).toBe(true);
    expect(s.deltas.kills_unarmed?.value).toBe(1);
    expect(s.deltas.kills_strength_bracelet).toBeUndefined();
  });

  it("each new weapon can win a fight and counts its own kills", () => {
    for (const w of ["pistol", "tamer_wand", "lance", "healing_bracelet"] as WeaponType[]) {
      const s = fight(w, { STR: 200, DEX: 200, INT: 200 });
      expect(s.over).toBe(true);
      expect(s.deltas[`kills_${w}`]?.value).toBe(1);
    }
  });

  it("the armory refuses weapon names that aren't real weapons", async () => {
    const store = new MemoryStore();
    const p = await game.createCharacter(store, { name: "Shop", classId: "free", stats: {} });
    await expect(game.weaponAction(store, p.id, "constructor" as WeaponType)).rejects.toThrow(/Unknown weapon/);
  });
});
