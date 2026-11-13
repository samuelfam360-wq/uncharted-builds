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
  /** The animated body in 3D. Players made before this existed don't have one. */
  body?: string;
  /** The colour of the neon glow on the hero in 3D. Without one, the class colour is used. */
  glow?: string;
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
  /** Your Horn Rabbit weapon, got once: the type you were holding when you earned it. */
  hornWeapon?: WeaponType | null;
  /** Whether the Horn Rabbit weapon is the one in your hand (then `weapon` is its type). */
  hornEquipped?: boolean;
  currentHp: number;
  currentMp: number;
  stats: Stats; // points spent (allocated), not derived
  lockedStats: StatKey[];
  dungeonAttempts: Record<string, number>;
  pets: Pet[];
  createdAt: string;
}

/** A tamed monster. Its stats are its species' numbers plus the points you placed. */
export interface Pet {
  id: string;
  species: string; // monster id
  level: number;
  exp: number;
  freePoints: number;
  stats: { HP: number; STR: number; VIT: number; AGI: number; DEX: number; INT: number }; // points placed
  petPoints: number; // from kills while out; will switch on pet skills
  kills: number; // killing blows the pet landed
  active: boolean; // out and fighting beside you (one at a time)
  tamedAt: string;
  /** A bred pet: its own level 1 numbers and caps (from its parents), instead of its species'. */
  base?: { HP: number; STR: number; VIT: number; AGI: number; DEX: number; INT: number };
  caps?: { HP: number; STR: number; VIT: number; AGI: number; DEX: number; INT: number };
  parents?: [string, string]; // the parents' species
  bond?: number; // how close it is to you (hearts come from this)
  outMs?: number; // time out with you not yet turned into bond
  learned?: string[]; // traits learned with pet points (or inherited when bred)
  traits?: string[]; // traits switched on, in order (only as many as it has slots count)
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
  | { zone: string }
  /** Gap between your highest and lowest allocated stat. */
  | { stat_spread: true; op: CompareOp; value: number };

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
  /** A boss-only ultimate: fires from a gauge instead of costing MP. */
  ultimate?: UltimateSpec;
  /** Long cooldown in seconds (instead of the usual 1.5). */
  cooldown_s?: number;
  /** Shadow Walk: turn invisible for this long and appear behind the nearest enemy. */
  shadow_walk?: { invisible_s: number };
}

/** What fills an ultimate's gauge during one boss fight. */
export type GaugeSource =
  | "boss_hits"
  | "boss_parries"
  | "boss_dodges"
  | "boss_weapon_hits"
  | "boss_mp_spent" // MP spent in the boss fight (Star Fall)
  | "boss_healed" // HP healed or drained in the boss fight (Judgment of Mercy)
  | "boss_charges" // lance charges that hit the boss (Dragonpiercer)
  | "boss_pet_hits"; // your pet's bites that landed on the boss (Primal Bond)

/**
 * Tiers: [half, kill, kill + EXP]. Firing at the first tier deals 50% of the
 * boss's HP (once per fight) and resets the gauge; the other two finish it.
 */
export interface UltimateSpec {
  gauge: GaugeSource;
  tiers: [number, number, number];
  /** The top tier also finishes every other monster on screen (Star Fall's meteor shower). */
  field?: boolean;
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
  /** Blade Read: after a parry the next hit can't miss and crits; 3 in a row ignore defense; 20 in a row one-shot a non-boss. */
  blade_read?: { pierce_at: number; execute_at: number };
  /** Hundred Cuts: each hit in a row adds damage; long runs also hit nearby enemies, then everything on screen. */
  hundred_cuts?: { per_hit: number; adjacent_at: number; screen_at: number };
  /** Duelist's Oath: a stat multiplier while only one enemy is fighting you. */
  duelist?: { stat: StatKey; mult: number };
  /** Iron Riposte: every perfect block (a parry with a shield) strikes back. */
  riposte?: ActiveEffect;
  /** Vengeance Vault: damage blocked while guarding is stored and released as one piercing shockwave. */
  vault?: boolean;
  /** Eye of the Storm: every enemy hit you take strikes back at all enemies around you. */
  storm?: ActiveEffect;
  /** All masteries grow this much faster (1.1 = +10%). */
  mastery_growth?: number;
  /** Silent Finish: a first hit on an unaware enemy deals `mult`x; a kill keeps you hidden and each one in a row adds +1x (up to chain_max). */
  silent_finish?: { mult: number; chain_max: number; hide_s: number };
  /** Phantom Legion: each dodge leaves a shadow clone that fights for a while at a share of your damage. */
  phantom_legion?: { pct: number; life_s: number; max: number };
  /** Thousand Needles: crits stack bleeding; at `stacks` a normal monster dies and a boss loses boss_pct of its HP. */
  thousand_needles?: { stacks: number; boss_pct: number; tick_pct: number };
  /** Armor Crusher: each hit lowers the target's defense, stacking. */
  armor_crusher?: { per_hit: number; max: number };
  /** Quake Slam: Ground Slam knocks down everything nearby. */
  quake_slam?: { stun_ms: number; reach: number };
  /** Ringing Blow: your stuns last longer and stunned enemies take more damage. */
  ringing_blow?: { extra_ms: number; dmg_mult: number };
  /** Seven Strikes: the 7th hit of every combo deals 7x. */
  seven_strikes?: { every: number; mult: number; gap_ms: number };
  /** Breath Control: regain HP and MP every few seconds while fighting. */
  breath_control?: { hp_pct: number; mp: number };
  /** Quick Draw: the first shot of every fight crits. */
  quick_draw?: boolean;
  /** Dead Man's Hand: faster attacks while low on HP. */
  dead_mans_hand?: { below: number; rate: number };
  /** Hawk Line: more range, and damage grows with distance. */
  hawk_line?: { range: number; max_mult: number };
  /** Marked Prey: your last target is marked and your shots never miss it. */
  marked_prey?: boolean;
  /** Spell Thief: absorb each enemy's first spell in a fight and cast it back, stronger. */
  spell_thief?: { mult: number };
  /** Chain Catastrophe: enemies your spells kill explode into the same spell. */
  chain_catastrophe?: { radius: number };
  /** Blood Sorcery: at 0 MP, skills cost HP (this share of max HP per MP) and hit harder. */
  blood_sorcery?: { hp_per_mp: number; mult: number };
  /** Grace Rebound: your first heal below this share of HP each fight is multiplied. */
  grace_rebound?: { below: number; mult: number };
  /** Soul Drain: hits heal you for a share of their damage; extra HP becomes a shield (up to max_shield x max HP). */
  soul_drain?: { pct: number; max_shield: number };
  /** Comet Charge: lance charges hit harder the farther you ran, up to max_mult. */
  comet_charge?: { max_mult: number };
  /** Iron Momentum: while charging you can't be stunned or knocked back. */
  iron_momentum?: boolean;
  /** Sky Lance: a lance attack in the air dives down and hits everything where you land. */
  sky_lance?: { reach: number };
  /** Spellblade: sword hits add magic damage equal to this share of your INT. */
  spellblade?: { int_mult: number };
  /** Iron Sanctuary: blocking heals you for this share of the damage your guard soaked. */
  iron_sanctuary?: { pct: number };
  /** Life Palm: unarmed hits heal you for this share of their damage. */
  life_palm?: { pct: number };
  /** Shared Glory: your pet out adds this share of your stats to its own, and earns more EXP. */
  shared_glory?: { stat_share: number; exp_mult: number };
  /** Beast Tongue: every enemy's next attack is shown this long before it starts. */
  beast_tongue?: { early_ms: number };
  /** Green Slime's Mercy: these monsters' blows bounce off you. */
  slime_mercy?: { monsters: string[] };
  /** Horn Rabbit Weapons: your hits on these monsters deal this much more. */
  foe_bane?: { monsters: string[]; mult: number };
  /** Wolf's Scars: monsters within this distance of you move slower. */
  scar_aura?: { radius: number; slow: number };
  /** Pack Leader: this many more pets can be out at once. */
  pack_leader?: { extra: number };
  /** Kindred Spirit: every pet gets this many more trait slots. */
  kindred_spirit?: { extra_slots: number };
}

export interface SkillEffect {
  /** Weapon techniques only work with one of these in hand. */
  weapons?: WeaponType[];
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
