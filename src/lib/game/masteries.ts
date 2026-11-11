// Masteries: every weapon or playstyle grows as you use it. Your class's own
// mastery grows 20% faster (the Blacksmith gets it on both Hammer and Crafting).
// Mastery EXP lives in the player's counters as mxp_<mastery>.

import type { ClassId, Counters, WeaponType } from "./types";

export const MASTERIES = [
  { id: "sword", name: "Sword" },
  { id: "staff", name: "Staff" },
  { id: "dagger", name: "Dagger" },
  { id: "shield", name: "Shield" },
  { id: "bow", name: "Bow" },
  { id: "gun", name: "Gun" },
  { id: "taming", name: "Taming" },
  { id: "lance", name: "Lance" },
  { id: "holy", name: "Holy" },
  { id: "hammer", name: "Hammer" },
  { id: "crafting", name: "Crafting" },
  { id: "fists", name: "Fists" },
] as const;
export type MasteryId = (typeof MASTERIES)[number]["id"];

/** Which mastery a weapon trains. Crafting has no weapon: it grows by making things. */
export const WEAPON_MASTERY: Record<WeaponType, MasteryId> = {
  sword: "sword",
  staff: "staff",
  daggers: "dagger",
  large_shield: "shield",
  bow: "bow",
  pistol: "gun",
  tamer_wand: "taming",
  lance: "lance",
  healing_bracelet: "holy",
  hammer: "hammer",
  strength_bracelet: "fists",
  unarmed: "fists",
};

export const CLASS_MASTERIES: Record<ClassId, MasteryId[]> = {
  swordsman: ["sword"],
  mage: ["staff"],
  assassin: ["dagger"],
  tanker: ["shield"],
  ranger: ["bow"],
  gunslinger: ["gun"],
  tamer: ["taming"],
  lancer: ["lance"],
  saint: ["holy"],
  blacksmith: ["hammer", "crafting"],
  monk: ["fists"],
  free: [],
};

export const CLASS_MASTERY_BONUS = 1.2;
export const MASTERY_LEVEL_CAP = 100;

/** Mastery EXP for each thing you do with the weapon in hand (before bonuses). */
export const MASTERY_XP = { hit: 5, kill: 50, block: 5, skill: 5 } as const;

/** EXP from level L to L+1 is 100 x L, so level L needs 50 x L x (L-1) in total. */
export const masteryXpForLevel = (level: number) => 50 * level * (level - 1);

export function masteryLevel(xp: number): number {
  // Solve 50 L (L - 1) <= xp for the largest whole L.
  let l = Math.floor((1 + Math.sqrt(1 + (4 * Math.max(0, xp)) / 50)) / 2);
  while (l > 1 && masteryXpForLevel(l) > xp) l--;
  while (masteryXpForLevel(l + 1) <= xp) l++;
  return Math.max(1, Math.min(MASTERY_LEVEL_CAP, l));
}

export const masteryKey = (m: MasteryId) => `mxp_${m}`;

/** How fast a mastery grows for this player (class bonus and skills like Wanderer's Path). */
export function masteryRate(classId: ClassId, m: MasteryId, growth = 1): number {
  return (CLASS_MASTERIES[classId]?.includes(m) ? CLASS_MASTERY_BONUS : 1) * growth;
}

export interface MasteryView {
  id: MasteryId;
  name: string;
  level: number;
  xp: number; // into this level
  next: number; // needed for the next level (0 at the cap)
  classBonus: boolean;
  usedBy: WeaponType[];
}

export function masteryViews(classId: ClassId, counters: Counters): MasteryView[] {
  return MASTERIES.map((m) => {
    const total = counters[masteryKey(m.id)] ?? 0;
    const level = masteryLevel(total);
    const base = masteryXpForLevel(level);
    return {
      id: m.id,
      name: m.name,
      level,
      xp: total - base,
      next: level >= MASTERY_LEVEL_CAP ? 0 : masteryXpForLevel(level + 1) - base,
      classBonus: CLASS_MASTERIES[classId]?.includes(m.id) ?? false,
      usedBy: (Object.keys(WEAPON_MASTERY) as WeaponType[]).filter((w) => WEAPON_MASTERY[w] === m.id),
    };
  });
}
