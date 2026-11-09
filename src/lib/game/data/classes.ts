import type { Appearance, ClassId, StatKey, WeaponType } from "../types";

// Classes only shape the start: fixed stat points plus a Common wood weapon.
// They restrict nothing after creation.
export interface ClassDef {
  id: ClassId;
  name: string;
  fixed: Partial<Record<StatKey, number>>; // points placed automatically
  weapon: WeaponType; // starting weapon ("unarmed" = none)
}

export const CLASSES: Record<ClassId, ClassDef> = {
  swordsman: { id: "swordsman", name: "Swordsman", fixed: { STR: 5 }, weapon: "sword" },
  mage: { id: "mage", name: "Mage", fixed: { INT: 5 }, weapon: "staff" },
  assassin: { id: "assassin", name: "Assassin", fixed: { AGI: 5 }, weapon: "daggers" },
  tanker: { id: "tanker", name: "Tanker", fixed: { VIT: 5 }, weapon: "large_shield" },
  ranger: { id: "ranger", name: "Ranger", fixed: { DEX: 5 }, weapon: "bow" },
  gunslinger: { id: "gunslinger", name: "Gunslinger", fixed: { DEX: 5 }, weapon: "pistol" },
  tamer: { id: "tamer", name: "Tamer", fixed: { MP: 5 }, weapon: "tamer_wand" },
  lancer: { id: "lancer", name: "Lancer", fixed: { STR: 5 }, weapon: "lance" },
  saint: { id: "saint", name: "Saint", fixed: { MP: 3, HP: 2 }, weapon: "healing_bracelet" },
  blacksmith: { id: "blacksmith", name: "Blacksmith", fixed: { DEX: 5 }, weapon: "hammer" },
  monk: { id: "monk", name: "Monk", fixed: { STR: 5 }, weapon: "strength_bracelet" },
  free: { id: "free", name: "Free Class", fixed: {}, weapon: "unarmed" },
};

// Options for the self-customised look. Placeholder lists: Samuel can change them.
export const APPEARANCE_OPTIONS: Record<keyof Appearance, { label: string; options: string[] }> = {
  gender: { label: "Gender", options: ["Male", "Female"] },
  skinTone: { label: "Skin tone", options: ["Light", "Fair", "Medium", "Tan", "Brown", "Dark"] },
  hairStyle: { label: "Hair style", options: ["Short", "Medium", "Long", "Ponytail", "Braided", "Spiky", "Shaved"] },
  hairColor: { label: "Hair color", options: ["Black", "Brown", "Blonde", "Red", "White", "Silver", "Blue", "Green", "Pink"] },
  eyeColor: { label: "Eye color", options: ["Brown", "Black", "Blue", "Green", "Gray", "Amber", "Red", "Violet"] },
  build: { label: "Body build", options: ["Slim", "Average", "Strong"] },
};

export const APPEARANCE_KEYS = Object.keys(APPEARANCE_OPTIONS) as (keyof Appearance)[];

export const DEFAULT_APPEARANCE: Appearance = {
  gender: "Male",
  skinTone: "Medium",
  hairStyle: "Short",
  hairColor: "Black",
  eyeColor: "Brown",
  build: "Average",
};

/** Accept only known options; anything missing or unknown falls back to the default. */
export function cleanAppearance(input: unknown): Appearance {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_APPEARANCE };
  for (const k of APPEARANCE_KEYS) {
    const v = src[k];
    if (typeof v === "string" && APPEARANCE_OPTIONS[k].options.includes(v)) out[k] = v;
  }
  return out;
}

export function describeAppearance(a: Appearance): string {
  return `${a.gender}, ${a.build.toLowerCase()} build, ${a.hairColor.toLowerCase()} ${a.hairStyle.toLowerCase()} hair, ${a.eyeColor.toLowerCase()} eyes`;
}
