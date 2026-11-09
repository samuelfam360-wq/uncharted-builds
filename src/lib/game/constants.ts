import type { StatKey, Stats, WeaponType } from "./types";

// Tunable numbers. The design doc leaves these open, so they live in one place.
// Approved 2026-11-09. Classes (5 fixed in the class main stat + 5 free) come later;
// until then every character is effectively a "Free Class" with all 10 points free.
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

export interface WeaponDef {
  type: WeaponType;
  name: string;
  attack: number;
  element: "physical" | "magic";
  defenseBonus?: number;
  critBonus?: number;
  hitBonus?: number;
  blurb: string;
}

export const WEAPONS: Record<WeaponType, WeaponDef> = {
  sword: { type: "sword", name: "Iron Sword", attack: 8, element: "physical", blurb: "Balanced blade." },
  large_shield: {
    type: "large_shield",
    name: "Tower Shield",
    attack: 3,
    element: "physical",
    defenseBonus: 10,
    blurb: "Barely a weapon. Very good at not dying.",
  },
  daggers: { type: "daggers", name: "Twin Daggers", attack: 5, element: "physical", critBonus: 0.1, blurb: "Quick, crit-friendly." },
  bow: { type: "bow", name: "Short Bow", attack: 6, element: "physical", hitBonus: 0.15, blurb: "Accurate at range." },
  staff: { type: "staff", name: "Oak Staff", attack: 6, element: "magic", blurb: "Hits with INT instead of STR." },
  hammer: { type: "hammer", name: "War Hammer", attack: 12, element: "physical", hitBonus: -0.1, blurb: "Heavy and a little clumsy." },
  unarmed: { type: "unarmed", name: "Bare Fists", attack: 0, element: "physical", blurb: "Nothing but you." },
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
