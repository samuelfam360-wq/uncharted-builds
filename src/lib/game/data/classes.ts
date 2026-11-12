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
  body: { label: "3D body", options: ["Knight", "Barbarian", "Mage", "Rogue", "Hooded Rogue"] },
  glow: { label: "Glow colour", options: ["Cyan", "Blue", "Red", "Orange", "Yellow", "White Gold", "Purple", "Mint", "Pink", "Green", "Lime", "White"] },
};

/** The neon glow colours of the 3D heroes. */
export const GLOW: Record<string, string> = {
  Cyan: "#2de2ff",
  Blue: "#4d8dff",
  Red: "#ff4d5e",
  Orange: "#ff8a2b",
  Yellow: "#ffd23f",
  "White Gold": "#fff2b0",
  Purple: "#b36bff",
  Mint: "#3df5c8",
  Pink: "#ff2bd6",
  Green: "#4dff9a",
  Lime: "#c8ff2b",
  White: "#f4f6ff",
};

/** Each class starts with its own glow colour; the player can pick another. */
export const CLASS_GLOW: Record<ClassId, string> = {
  swordsman: "Cyan",
  tanker: "Blue",
  lancer: "Red",
  blacksmith: "Orange",
  monk: "Yellow",
  saint: "White Gold",
  mage: "Purple",
  tamer: "Mint",
  assassin: "Pink",
  ranger: "Green",
  gunslinger: "Lime",
  free: "White",
};

/** The animated bodies in 3D (from the free KayKit Adventurers pack). */
export const BODY_OPTIONS = ["Knight", "Barbarian", "Mage", "Rogue", "Hooded Rogue"] as const;

/** The 3D body for players who haven't picked one (made before bodies existed). */
export const CLASS_BODY: Record<ClassId, (typeof BODY_OPTIONS)[number]> = {
  swordsman: "Knight",
  tanker: "Knight",
  lancer: "Knight",
  blacksmith: "Barbarian",
  monk: "Barbarian",
  mage: "Mage",
  saint: "Mage",
  tamer: "Mage",
  assassin: "Hooded Rogue",
  ranger: "Rogue",
  gunslinger: "Rogue",
  free: "Rogue",
};

export const APPEARANCE_KEYS = Object.keys(APPEARANCE_OPTIONS) as (keyof Appearance)[];

export const DEFAULT_APPEARANCE: Appearance = {
  gender: "Male",
  skinTone: "Medium",
  hairStyle: "Short",
  hairColor: "Black",
  eyeColor: "Brown",
  build: "Average",
  body: "Knight",
  glow: "Cyan",
};

/** Accept only known options; anything missing or unknown falls back to the default. */
export function cleanAppearance(input: unknown): Appearance {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_APPEARANCE };
  for (const k of APPEARANCE_KEYS) {
    const v = src[k];
    if (typeof v === "string" && APPEARANCE_OPTIONS[k].options.includes(v)) out[k] = v;
  }
  // no body picked: the 3D view gives one that matches the class
  if (!(typeof src.body === "string" && APPEARANCE_OPTIONS.body.options.includes(src.body))) delete out.body;
  // no glow picked: the 3D view uses the class colour
  if (!(typeof src.glow === "string" && APPEARANCE_OPTIONS.glow.options.includes(src.glow))) delete out.glow;
  return out;
}

export function describeAppearance(a: Appearance): string {
  return `${a.gender}, ${a.build.toLowerCase()} build, ${a.hairColor.toLowerCase()} ${a.hairStyle.toLowerCase()} hair, ${a.eyeColor.toLowerCase()} eyes`;
}
