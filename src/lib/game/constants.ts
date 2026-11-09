import type { StatKey, Stats, WeaponType } from "./types";

// Tunable numbers. The design doc leaves these open, so they live in one place.
// Approved 2026-11-09. Classes put 5 of these points into fixed stats and leave 5
// free; the Free Class keeps all 10 free (see data/classes.ts).
export const STARTING_POINTS = 10;
export const POINTS_PER_LEVEL = 5;
export const LEVEL_CAP = 100;
export const BASE_HP = 100;
export const HP_PER_POINT = 10;
export const BASE_MP = 20;
export const MP_PER_POINT = 5;
export const STARTING_GOLD = 20;
export const WEAPON_PRICE = 30;

export const expToNext = (level: number) => Math.round(40 * Math.pow(level, 1.4));

export const activeSlots = (level: number) => 4 + Math.floor(level / 5);
export const passiveSlots = (level: number) => 4 + Math.floor(level / 10);

export const emptyStats = (): Stats => ({ HP: 0, MP: 0, STR: 0, VIT: 0, AGI: 0, DEX: 0, INT: 0 });

// Materials go Wood -> Copper -> Iron -> Steel -> Silver -> Mithril -> Adamantine.
// Rarity is a separate rank, based on the weapon's stats; any material can be
// enhanced up to Mythic. Phase 1 only has Common wood weapons.
export const MATERIALS = ["Wood", "Copper", "Iron", "Steel", "Silver", "Mithril", "Adamantine"] as const;
export type Material = (typeof MATERIALS)[number];
export const RARITIES = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"] as const;
export type Rarity = (typeof RARITIES)[number];

export interface WeaponDef {
  type: WeaponType;
  name: string;
  material: Material | null; // null for bare fists
  rarity: Rarity | null;
  attack: number;
  element: "physical" | "magic";
  scaleStat?: StatKey; // stat the normal attack uses instead of STR (physical) / INT (magic)
  fists?: boolean; // fights with the fists: counts as unarmed for skills and kill counters
  defenseBonus?: number;
  critBonus?: number;
  hitBonus?: number;
  blurb: string;
}

const wood = { material: "Wood" as const, rarity: "Common" as const };

export const WEAPONS: Record<WeaponType, WeaponDef> = {
  sword: { type: "sword", name: "Wood Sword", ...wood, attack: 8, element: "physical", blurb: "Balanced blade. Hits with STR." },
  staff: { type: "staff", name: "Wood Staff", ...wood, attack: 6, element: "magic", blurb: "Magic. Hits with INT." },
  daggers: { type: "daggers", name: "Wood Dagger", ...wood, attack: 5, element: "physical", critBonus: 0.1, blurb: "Quick, crit-friendly. Hits with STR." },
  large_shield: {
    type: "large_shield",
    name: "Wood Shield",
    ...wood,
    attack: 3,
    element: "physical",
    defenseBonus: 10,
    blurb: "+10 defense. Barely a weapon.",
  },
  bow: { type: "bow", name: "Wood Bow", ...wood, attack: 6, element: "physical", scaleStat: "DEX", hitBonus: 0.15, blurb: "Accurate. Hits with DEX." },
  pistol: { type: "pistol", name: "Wood Pistol", ...wood, attack: 7, element: "physical", scaleStat: "DEX", hitBonus: 0.1, blurb: "Hits with DEX. No bullets needed yet." },
  tamer_wand: { type: "tamer_wand", name: "Wood Tamer Wand", ...wood, attack: 5, element: "magic", blurb: "Magic. Hits with INT. Taming comes later." },
  lance: { type: "lance", name: "Wood Lance", ...wood, attack: 10, element: "physical", hitBonus: -0.05, blurb: "Long reach, heavy hits. Hits with STR." },
  healing_bracelet: { type: "healing_bracelet", name: "Wood Healing Bracelet", ...wood, attack: 4, element: "magic", blurb: "Magic. Hits with INT. Holy skills come later." },
  hammer: { type: "hammer", name: "Wood Hammer", ...wood, attack: 12, element: "physical", hitBonus: -0.1, blurb: "Heavy and a little clumsy. Hits with STR." },
  strength_bracelet: {
    type: "strength_bracelet",
    name: "Wood Strength Bracelet",
    ...wood,
    attack: 3,
    element: "physical",
    fists: true,
    blurb: "Worn on the wrist. You still fight with your fists.",
  },
  unarmed: { type: "unarmed", name: "Bare Fists", material: null, rarity: null, attack: 0, element: "physical", fists: true, blurb: "Nothing but you." },
};

export const STAT_INFO: Record<StatKey, string> = {
  HP: "Health pool (+10 max HP per point)",
  MP: "Mana for skills (+5 max MP per point)",
  STR: "Physical attack",
  VIT: "Physical defense",
  AGI: "Speed, evasion, turn order",
  DEX: "Accuracy and critical hits",
  INT: "Magic attack and magic defense",
};
