import {
  BASE_HP,
  BASE_MP,
  HP_PER_POINT,
  LEVEL_CAP,
  MP_PER_POINT,
  POINTS_PER_LEVEL,
  STARTING_GOLD,
  STARTING_POINTS,
  activeSlots,
  emptyStats,
  expToNext,
  passiveSlots,
} from "./constants";
import { CLASSES, cleanAppearance } from "./data/classes";
import {
  CLASS_IDS,
  STAT_KEYS,
  type PassiveEffect,
  type Player,
  type PlayerSkill,
  type SkillDefinition,
  type StatKey,
  type Stats,
  type StatusType,
  type UniqueItem,
  type ClassId,
  type WeaponType,
} from "./types";

export class GameError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export interface CreateCharacterInput {
  name: string;
  classId: ClassId;
  appearance?: unknown; // cleaned to known options
  stats: Partial<Stats>; // the free points only; class points are added on top
}

/** Points the player chooses at creation (class fixed points are on top). */
export const freeStartingPoints = (classId: ClassId) => {
  const fixed = Object.values(CLASSES[classId].fixed).reduce((n, v) => n + (v ?? 0), 0);
  return STARTING_POINTS - fixed;
};

export function validateAllocation(stats: Partial<Stats>, available: number, locked: StatKey[] = []): Stats {
  const out = emptyStats();
  let total = 0;
  for (const [k, v] of Object.entries(stats)) {
    if (!STAT_KEYS.includes(k as StatKey)) throw new GameError(`Unknown stat ${k}`);
    if (!Number.isInteger(v) || (v as number) < 0) throw new GameError(`${k} must be a whole number of points`);
    if ((v as number) > 0 && locked.includes(k as StatKey)) throw new GameError(`${k} is locked by one of your skills`);
    out[k as StatKey] = v as number;
    total += v as number;
  }
  if (total > available) throw new GameError(`You only have ${available} points to spend`);
  return out;
}

export function newCharacter(input: CreateCharacterInput, id: string, now = new Date()): Player {
  const name = input.name?.trim();
  if (!name || name.length < 2 || name.length > 20) throw new GameError("Name must be 2 to 20 characters");
  if (!/^[\p{L}\p{N} _'-]+$/u.test(name)) throw new GameError("Name can only use letters, numbers, spaces, - _ and '");
  if (!CLASS_IDS.includes(input.classId)) throw new GameError("Pick a class");
  const cls = CLASSES[input.classId];
  const free = freeStartingPoints(cls.id);
  const chosen = validateAllocation(input.stats ?? {}, free);
  const spent = STAT_KEYS.reduce((n, k) => n + chosen[k], 0);
  const stats = { ...chosen };
  for (const [k, v] of Object.entries(cls.fixed)) stats[k as StatKey] += v ?? 0;
  const weapon: WeaponType = cls.weapon;
  const p: Player = {
    id,
    name,
    classId: cls.id,
    appearance: cleanAppearance(input.appearance),
    level: 1,
    exp: 0,
    freePoints: free - spent,
    gold: STARTING_GOLD,
    weapon,
    ownedWeapons: weapon === "unarmed" ? ["unarmed"] : [weapon, "unarmed"],
    currentHp: 0,
    currentMp: 0,
    stats,
    lockedStats: [],
    dungeonAttempts: {},
    pets: [],
    createdAt: now.toISOString(),
  };
  const d = derive(p, [], new Map(), null);
  p.currentHp = d.maxHp;
  p.currentMp = d.maxMp;
  return p;
}

/** Spend free points after creation or level-up. Points can't be refunded. */
export function allocatePoints(p: Player, add: Partial<Stats>): Player {
  const add2 = validateAllocation(add, p.freePoints, p.lockedStats);
  const stats = { ...p.stats };
  let spent = 0;
  for (const k of STAT_KEYS) {
    stats[k] += add2[k];
    spent += add2[k];
  }
  return { ...p, stats, freePoints: p.freePoints - spent };
}

export function grantExp(p: Player, exp: number): { player: Player; levelsGained: number } {
  let { level, exp: cur, freePoints } = p;
  cur += exp;
  let gained = 0;
  while (level < LEVEL_CAP && cur >= expToNext(level)) {
    cur -= expToNext(level);
    level++;
    freePoints += POINTS_PER_LEVEL;
    gained++;
  }
  return { player: { ...p, level, exp: cur, freePoints }, levelsGained: gained };
}

// ---------- Derived stats ----------

export interface Derived {
  stats: Stats; // effective stats after skills and gear
  maxHp: number;
  maxMp: number;
  immunities: Set<StatusType>;
  statusResist: Partial<Record<StatusType, number>>;
  poisonMult: number;
  passive: Required<Pick<PassiveEffect, "damage_multiplier" | "reflect_pct" | "mp_regen" | "heal_on_win_pct" | "mastery_growth">> &
    Omit<PassiveEffect, "damage_multiplier" | "reflect_pct" | "mp_regen" | "heal_on_win_pct" | "mastery_growth"> & { hazard_immunity: string[] };
  activeSkills: SkillDefinition[];
}

export function equippedSkills(skills: PlayerSkill[], defs: Map<string, SkillDefinition>) {
  return skills
    .filter((s) => s.status === "owned" && s.equipped && !s.evolvedInto)
    .map((s) => defs.get(s.skillId))
    .filter((d): d is SkillDefinition => !!d);
}

/** Weapon techniques only work with their weapon in hand. */
export const worksWith = (d: SkillDefinition, weapon: WeaponType) => !d.effect.weapons?.length || d.effect.weapons.includes(weapon);

export function derive(
  p: Player,
  skills: PlayerSkill[],
  defs: Map<string, SkillDefinition>,
  unique: UniqueItem | null,
): Derived {
  const equipped = equippedSkills(skills, defs).filter((d) => worksWith(d, p.weapon));
  // Item-attached skills are active while the item is worn.
  if (unique?.equipped) {
    for (const id of unique.attachedSkills) {
      const d = defs.get(id);
      if (d && !equipped.includes(d)) equipped.push(d);
    }
  }
  const bonus = emptyStats();
  const mult: Stats = { HP: 1, MP: 1, STR: 1, VIT: 1, AGI: 1, DEX: 1, INT: 1 };
  const immunities = new Set<StatusType>();
  const statusResist: Partial<Record<StatusType, number>> = {};
  let poisonMult = 1;
  const passive: Derived["passive"] = { damage_multiplier: 1, reflect_pct: 0, mp_regen: 0, heal_on_win_pct: 0, mastery_growth: 1, hazard_immunity: [] };

  if (unique?.equipped) {
    for (const [k, v] of Object.entries(unique.statBonus)) bonus[k as StatKey] += Math.round((v ?? 0) * (1 + 0.1 * (unique.level - 1)));
  }

  for (const d of equipped) {
    const e = d.effect;
    for (const [k, v] of Object.entries(e.stat_bonus ?? {})) bonus[k as StatKey] += v ?? 0;
    for (const [k, v] of Object.entries(e.stat_multiplier ?? {})) mult[k as StatKey] *= v ?? 1;
    e.immunities?.forEach((s) => immunities.add(s));
    for (const [k, v] of Object.entries(e.status_resist ?? {})) {
      const cur = statusResist[k as StatusType] ?? 0;
      statusResist[k as StatusType] = 1 - (1 - cur) * (1 - (v ?? 0));
    }
    if (e.poison_damage_mult !== undefined) poisonMult *= e.poison_damage_mult;
    const ps = e.passive;
    if (ps) {
      if (ps.damage_multiplier) passive.damage_multiplier *= ps.damage_multiplier;
      if (ps.reflect_pct) passive.reflect_pct += ps.reflect_pct * (d.id === "thorn_retort" && unique ? 1 + 0.1 * (unique.level - 1) : 1);
      if (ps.mp_regen) passive.mp_regen += ps.mp_regen;
      if (ps.heal_on_win_pct) passive.heal_on_win_pct += ps.heal_on_win_pct;
      if (ps.hazard_immunity) passive.hazard_immunity.push(...ps.hazard_immunity);
      if (ps.mastery_growth) passive.mastery_growth *= ps.mastery_growth;
      for (const key of [
        "low_hp_damage",
        "unarmed_stat",
        "dodge_invisibility",
        "pacifist",
        "poison_aura",
        "revive_once",
        "flee_always",
        "blade_read",
        "hundred_cuts",
        "duelist",
        "riposte",
        "vault",
        "storm",
        "silent_finish",
        "phantom_legion",
        "thousand_needles",
        "armor_crusher",
        "quake_slam",
        "ringing_blow",
        "seven_strikes",
        "breath_control",
        "quick_draw",
        "dead_mans_hand",
        "hawk_line",
        "marked_prey",
        "spell_thief",
        "chain_catastrophe",
        "blood_sorcery",
        "grace_rebound",
        "soul_drain",
        "comet_charge",
        "iron_momentum",
        "sky_lance",
        "spellblade",
        "iron_sanctuary",
        "life_palm",
        "shared_glory",
        "beast_tongue",
        "slime_mercy",
        "foe_bane",
        "scar_aura",
        "pack_leader",
        "kindred_spirit",
      ] as const) {
        if (ps[key] !== undefined) (passive as Record<string, unknown>)[key] = ps[key];
      }
    }
  }

  const stats = emptyStats();
  for (const k of STAT_KEYS) stats[k] = Math.floor((p.stats[k] + bonus[k]) * mult[k]);
  return {
    stats,
    maxHp: BASE_HP + stats.HP * HP_PER_POINT,
    maxMp: BASE_MP + stats.MP * MP_PER_POINT,
    immunities,
    statusResist,
    poisonMult,
    passive,
    activeSkills: equipped.filter((d) => d.kind === "active"),
  };
}

// ---------- Skill slots ----------

export function slotUsage(p: Player, skills: PlayerSkill[], defs: Map<string, SkillDefinition>) {
  const eq = equippedSkills(skills, defs);
  return {
    active: { used: eq.filter((d) => d.kind === "active").length, max: activeSlots(p.level) },
    passive: { used: eq.filter((d) => d.kind === "passive").length, max: passiveSlots(p.level) },
  };
}

export function canEquip(p: Player, skills: PlayerSkill[], defs: Map<string, SkillDefinition>, skillId: string): boolean {
  const d = defs.get(skillId);
  if (!d) return false;
  const u = slotUsage(p, skills, defs);
  return d.kind === "active" ? u.active.used < u.active.max : u.passive.used < u.passive.max;
}
