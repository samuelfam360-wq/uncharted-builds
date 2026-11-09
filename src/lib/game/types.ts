// Core shared types for Uncharted Builds.

export const STAT_KEYS = ["HP", "MP", "STR", "VIT", "AGI", "DEX", "INT"] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;

// Internal weapon keys. "large_shield" and "daggers" keep their Phase 1 keys so
// existing saves and kill counters (kills_<weapon>) keep working.
export const WEAPON_TYPES = [
  "sword",
  "staff",
  "daggers",
  "large_shield",
  "bow",
  "pistol",
  "tamer_wand",
  "lance",
  "healing_bracelet",
  "hammer",
  "strength_bracelet",
  "unarmed",
] as const;
export type WeaponType = (typeof WEAPON_TYPES)[number];

export const CLASS_IDS = [
  "swordsman",
  "mage",
  "assassin",
  "tanker",
  "ranger",
  "gunslinger",
  "tamer",
  "lancer",
  "saint",
  "blacksmith",
  "monk",
  "free",
] as const;
export type ClassId = (typeof CLASS_IDS)[number];

/** Self-customised look. Saved now, shown once the game is 3D. */
export interface Appearance {
  gender: string;
  skinTone: string;
  hairStyle: string;
  hairColor: string;
  eyeColor: string;
  build: string;
}

export const STATUS_TYPES = [
  "poison",
  "paralysis",
  "burn",
  "freeze",
  "silence",
  "slow",
  "stun",
] as const;
export type StatusType = (typeof STATUS_TYPES)[number];

export interface StatusEffect {
  type: StatusType;
  turns: number;
}

export interface Player {
  id: string;
  name: string;
  classId: ClassId;
  appearance: Appearance;
  level: number;
  exp: number;
  freePoints: number;
  gold: number;
  weapon: WeaponType;
  ownedWeapons: WeaponType[];
  currentHp: number;
  currentMp: number;
  stats: Stats; // points spent (allocated), not derived
  lockedStats: StatKey[];
  dungeonAttempts: Record<string, number>;
  createdAt: string;
}

export type Counters = Record<string, number>;

/** How a counter delta is applied when flushed to storage. */
export type CounterOp = "inc" | "set" | "max";
export type CounterDeltas = Record<string, { op: CounterOp; value: number }>;

// ---------- Skills (stored as data) ----------

export type CompareOp = ">=" | ">" | "<=" | "<" | "==" | "!=";

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { counter: string; op: CompareOp; value: number }
  | { stat: StatKey; op: CompareOp; value: number }
  | { player: "level"; op: CompareOp; value: number }
  | { battle: string; op: CompareOp; value: number | string | boolean }
  | { skill: string; owned?: boolean }
  | { zone: string };

export interface ActiveEffect {
  mp_cost?: number;
  hp_cost_pct?: number;
  multiplier?: number;
  element?: "physical" | "magic";
  hits?: number;
  scale_stat?: StatKey; // overrides STR/INT for this skill
  piercing_stat?: StatKey; // adds this stat as piercing damage
  piercing_flat?: number;
  area?: boolean; // cannot be dodged
  crit_bonus?: number;
  status?: { type: StatusType; chance: number; turns: number };
  heal_pct?: number;
  cleanse?: boolean;
}

export interface PassiveEffect {
  low_hp_damage?: { threshold: number; multiplier: number };
  unarmed_stat?: StatKey;
  heal_on_win_pct?: number;
  dodge_invisibility?: number;
  pacifist?: boolean;
  poison_aura?: { chance: number; turns: number };
  revive_once?: boolean;
  flee_always?: boolean;
  mp_regen?: number;
  damage_multiplier?: number;
  reflect_pct?: number;
  hazard_immunity?: string[];
}

export interface SkillEffect {
  stat_multiplier?: Partial<Record<StatKey, number>>;
  stat_bonus?: Partial<Record<StatKey, number>>;
  immunities?: StatusType[];
  status_resist?: Partial<Record<StatusType, number>>; // 0..1 chance to resist
  poison_damage_mult?: number;
  passive?: PassiveEffect;
  active?: ActiveEffect;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string; // what the player sees after unlocking
  kind: "active" | "passive";
  hidden: boolean;
  conditions: Condition;
  effect: SkillEffect;
  locks: StatKey[];
  limit: number | null; // max owners on the server; 1 = server-first
  evolvesFrom: string | null;
  excludes: string[]; // mutual exclusion
  usesPerBattle: number | null;
  rumor: string | null; // vague hint an NPC may say
  enabled: boolean;
}

export interface PlayerSkill {
  skillId: string;
  equipped: boolean;
  stage: number;
  status: "owned" | "offered" | "declined";
  evolvedInto: string | null;
  unlockedAt: string;
}

export interface UniqueItem {
  id: string;
  name: string;
  description: string;
  ownerId: string | null;
  ownerName: string | null;
  level: number;
  exp: number;
  statBonus: Partial<Record<StatKey, number>>;
  attachedSkills: string[];
  claimedAt: string | null;
  equipped: boolean;
}

export interface InventoryItem {
  itemId: string;
  qty: number;
}

export interface UnlockLogEntry {
  playerId: string;
  playerName: string;
  skillId: string;
  at: string;
}
