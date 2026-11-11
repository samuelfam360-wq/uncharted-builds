// Live (real-time) combat on the side-view maps.
//
// The browser runs the fight at 60 frames a second using the math below, then
// reports what happened after each kill, death or every few seconds. The server
// checks the report against the same math (no hit can be bigger than the best
// possible roll, no more swings than time allows, skills must be equipped and
// paid for), rolls the rewards itself, and updates counters and unlocks.

import { WEAPONS } from "./constants";
import { critChance, damageFormula, hitChance, type Rng } from "./combat";
import type { EnemyAttack } from "./data/world";
import type { ActiveEffect, StatKey, StatusType, WeaponType } from "./types";

/** One old "turn" in real time: status ticks, swamp damage and MP regen happen this often. */
export const TICK_MS = 2000;
/** Swings plus area skills that hit several monsters at once. Bounds how many hits a report may hold. */
export const MAX_HITS_PER_SEC = 12;

type CombatStats = Record<StatKey, number>;

export interface Attacker {
  stats: CombatStats;
  passive: { damage_multiplier: number; low_hp_damage?: { threshold: number; multiplier: number }; unarmed_stat?: StatKey };
}

export interface Defender {
  VIT: number;
  INT: number;
  AGI: number; // effective (already halved when slowed)
}

export interface AttackSpec {
  name: string;
  element: "physical" | "magic";
  multiplier: number;
  scaleStat?: StatKey;
  weaponAttack: number;
  critBonus: number;
  hitBonus: number;
  piercing: number;
  area: boolean;
  hits: number;
  status?: { type: StatusType; chance: number; turns: number };
}

/** The normal attack, or a skill, with the weapon in hand. */
export function attackSpec(weapon: WeaponType, attacker: Attacker, skill?: { name: string; active: ActiveEffect }): AttackSpec {
  const w = WEAPONS[weapon];
  if (!skill) {
    return {
      name: w.fists ? "Punch" : w.name,
      element: w.element,
      multiplier: 1,
      scaleStat: (w.fists ? attacker.passive.unarmed_stat : undefined) ?? w.scaleStat,
      weaponAttack: w.attack,
      critBonus: w.critBonus ?? 0,
      hitBonus: w.hitBonus ?? 0,
      piercing: 0,
      area: false,
      hits: 1,
    };
  }
  const a = skill.active;
  const piercing = (a.piercing_flat ?? 0) + (a.piercing_stat ? attacker.stats[a.piercing_stat] ?? 0 : 0);
  return {
    name: skill.name,
    element: a.element ?? w.element,
    multiplier: a.multiplier ?? 0,
    scaleStat: a.scale_stat,
    weaponAttack: w.attack,
    critBonus: (a.crit_bonus ?? 0) + (w.critBonus ?? 0),
    hitBonus: w.hitBonus ?? 0,
    piercing,
    area: !!a.area,
    hits: a.multiplier ? a.hits ?? 1 : 0,
    status: a.status,
  };
}

function attackPower(spec: AttackSpec, a: Attacker, hpPct: number) {
  const stat = spec.scaleStat ?? (spec.element === "magic" ? "INT" : "STR");
  let atk = (a.stats[stat] ?? 0) + spec.weaponAttack;
  atk *= a.passive.damage_multiplier;
  const low = a.passive.low_hp_damage;
  if (low && hpPct < low.threshold) atk *= low.multiplier;
  return atk;
}

export interface HitRoll {
  miss: boolean;
  crit: boolean;
  dmg: number;
}

/** Changes a skill can make to one hit (Blade Read, Hundred Cuts). */
export interface HitMods {
  sure?: boolean; // can't miss
  crit?: boolean; // always crits
  ignoreDef?: boolean;
  defMult?: number; // Armor Crusher: share of defense left
  mult?: number; // extra damage multiplier
}

/** One swing (or one hit of a multi-hit skill) against one monster. Same rules as the turn-based fights. */
export function rollHit(rng: Rng, spec: AttackSpec, a: Attacker, target: Defender, hpPct: number, mods: HitMods = {}): HitRoll {
  if (!spec.area && !mods.sure && rng() >= hitChance(a.stats.DEX, target.AGI, spec.hitBonus)) return { miss: true, crit: false, dmg: 0 };
  const crit = mods.crit || rng() < critChance(a.stats.DEX, spec.critBonus);
  const def = mods.ignoreDef ? 0 : (spec.element === "magic" ? target.INT : target.VIT) * (mods.defMult ?? 1);
  const dmg = damageFormula(attackPower(spec, a, hpPct), spec.multiplier * (crit ? 1.5 : 1) * (mods.mult ?? 1), def, spec.piercing);
  return { miss: false, crit, dmg };
}

/** The stats an attacker fights with right now (Duelist's Oath when only one enemy is fighting). */
export function withDuelist<T extends Attacker & { passive: { duelist?: { stat: StatKey; mult: number } } }>(a: T, oneOnOne: boolean): T {
  const d = a.passive.duelist;
  if (!d || !oneOnOne) return a;
  return { ...a, stats: { ...a.stats, [d.stat]: Math.floor((a.stats[d.stat] ?? 0) * d.mult) } };
}

/** Hundred Cuts: damage multiplier for a hit that comes after `streak` hits in a row. */
export const streakMult = (streak: number, perHit: number) => 1 + perHit * Math.max(0, streak);

/** The biggest single hit this attack can ever do (a crit at low HP against no defense). */
export function maxHit(spec: AttackSpec, a: Attacker): number {
  return damageFormula(attackPower(spec, a, 0), spec.multiplier * 1.5, 0, spec.piercing);
}

export interface EnemyHitRoll {
  miss: boolean;
  dmg: number;
  blocked: number; // damage the player's defense soaked up
}

/** A monster's attack landing on the player. Blocking doubles defense, like Defend did. */
export function rollEnemyHit(
  rng: Rng,
  atk: EnemyAttack,
  enemy: { STR: number; INT: number; DEX: number },
  player: { VIT: number; INT: number; AGI: number },
  weapon: WeaponType,
  blocking: boolean,
): EnemyHitRoll {
  if (!atk.area && rng() >= hitChance(enemy.DEX, player.AGI)) return { miss: true, dmg: 0, blocked: 0 };
  const atkStat = atk.element === "magic" ? enemy.INT : enemy.STR;
  let def = atk.element === "magic" ? player.INT : player.VIT + (WEAPONS[weapon].defenseBonus ?? 0);
  if (blocking) def *= 2;
  const raw = Math.round(atkStat * atk.multiplier);
  const dmg = damageFormula(atkStat, atk.multiplier, def, atk.piercing);
  return { miss: false, dmg, blocked: Math.max(0, Math.min(raw, Math.round(def))) };
}

/** A parry lands when block is pressed this close before the hit (milliseconds). */
export const PARRY_WINDOW_MS = 220;
/** A parried monster is stunned this long and takes a stronger counter. */
export const PARRY_STUN_MS = 1400;
export const PARRY_COUNTER_MULT = 1.5;
/** A boss finished by an ultimate's top tier gives this much EXP (solo; parties come later). */
export const ULT_EXP_BONUS = 1.2;

// ---------- What the browser sends ----------

export interface ReportHit {
  skillId?: string; // missing = normal attack
  dmg: number;
  crit: boolean;
  miss: boolean;
  counter?: boolean; // the counter-attack after a parry (x1.5)
  streak?: number; // landed hits in a row before this one, without being hit
  execute?: boolean; // Blade Read's one-shot on a monster that isn't a boss
  wave?: number; // Vengeance Vault: hits of one shockwave share a number
  ult?: 1 | 2 | 3; // ultimate fired at this tier
  stealth?: number; // Silent Finish multiplier on a first hit from hiding
  combo7?: boolean; // Seven Strikes: the 7th hit of a combo
}

/** Counts for the boss fight in progress, since the last report. */
export interface BossTally {
  hits: number; // boss attacks survived
  parries: number; // boss attacks parried
  parryDmg: number; // damage those parries stopped
  dodges: number; // boss attacks dodged
  weaponHits: number; // your hits that landed on the boss
  dmg: number; // damage your hits did to the boss
}

export interface LiveReport {
  type: "kill" | "death" | "sync";
  zoneId: string;
  monsterId?: string; // kill: the monster that died; death: what killed you (optional)
  /** Every swing since the last report, on any monster. */
  hits: ReportHit[];
  /** Kill only: damage the dead monster took from your hits / from poison, burn and thorns. */
  directToTarget?: number;
  indirectToTarget?: number;
  hitsOnTarget?: number;
  fightMs?: number; // kill: how long that monster's fight lasted
  /** Skills cast (including ones that don't hit, like heals). */
  skillUses: Record<string, number>;
  itemsUsed: string[];
  taken: { enemy: number; hazard: number; poison: number; burn: number };
  dodged: number;
  dodgeStreak: number; // current streak at report time
  dodgeStreakBest: number;
  blocks: number; // attacks you blocked or parried
  parries: number;
  blockedDamage: number;
  zeroHits: number;
  statuses: StatusType[]; // statuses you received
  swampTicks: number;
  inSwamp: boolean; // kill: the fight happened in the swamp
  minHpPct: number;
  hp: number;
  mp: number;
  hitsTaken: number; // enemy attacks that landed on you
  hitStreak: number; // landed hits in a row right now
  guardStored: number; // damage blocked while guarding (Vengeance Vault)
  boss: BossTally;
  bossEnd: boolean; // the boss fight ended (boss beaten, you fell, or you got away)
  duel?: boolean; // kill: the whole fight was one-on-one with no items
  stormFights: number; // fights survived with 10+ enemies on you at once
  phantomFights: number; // fights with 50 dodges in a row and no hit taken
  escapes: number; // fights you got away from
  stunsDealt: number; // monsters you stunned
  combos7: number; // 7-hit combos landed
  cleanFights: number; // fights won without eating anything
  quickDraws: number; // fights won where you shot first within 1 second
  farHits: number; // hits from near the end of your range
  markedRuns: number; // 100 hits in a row on one target without a miss
  killSkill?: string; // kill: the skill that landed the killing blow
}

const STATUS_SET = new Set<string>(["poison", "paralysis", "burn", "freeze", "silence", "slow", "stun"]);
const num = (v: unknown, max = 1e9) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : 0);

/** Turn whatever came over the wire into a well-formed report (unknown fields dropped, numbers clamped). */
export function cleanReport(body: unknown): LiveReport {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const type = b.type === "kill" || b.type === "death" ? b.type : "sync";
  const hits = Array.isArray(b.hits) ? b.hits.slice(0, 5000) : [];
  const taken = (b.taken && typeof b.taken === "object" ? b.taken : {}) as Record<string, unknown>;
  const boss = (b.boss && typeof b.boss === "object" ? b.boss : {}) as Record<string, unknown>;
  const skillUses: Record<string, number> = {};
  if (b.skillUses && typeof b.skillUses === "object") {
    for (const [k, v] of Object.entries(b.skillUses as Record<string, unknown>).slice(0, 50)) {
      const n = num(v, 10000);
      if (n > 0) skillUses[String(k)] = n;
    }
  }
  return {
    type,
    zoneId: String(b.zoneId ?? ""),
    monsterId: typeof b.monsterId === "string" ? b.monsterId : undefined,
    hits: hits.map((h) => {
      const o = (h && typeof h === "object" ? h : {}) as Record<string, unknown>;
      return {
        skillId: typeof o.skillId === "string" ? o.skillId : undefined,
        dmg: num(o.dmg),
        crit: o.crit === true,
        miss: o.miss === true,
        counter: o.counter === true,
        streak: o.streak === undefined ? undefined : num(o.streak, 1e6),
        execute: o.execute === true,
        wave: o.wave === undefined ? undefined : num(o.wave, 1e9),
        ult: o.ult === 1 || o.ult === 2 || o.ult === 3 ? o.ult : undefined,
        stealth: o.stealth === undefined ? undefined : num(o.stealth, 100),
        combo7: o.combo7 === true,
      };
    }),
    directToTarget: num(b.directToTarget),
    indirectToTarget: num(b.indirectToTarget),
    hitsOnTarget: num(b.hitsOnTarget, 5000),
    fightMs: num(b.fightMs, 3_600_000),
    skillUses,
    itemsUsed: Array.isArray(b.itemsUsed) ? b.itemsUsed.slice(0, 200).map(String) : [],
    taken: { enemy: num(taken.enemy), hazard: num(taken.hazard), poison: num(taken.poison), burn: num(taken.burn) },
    dodged: num(b.dodged, 100000),
    dodgeStreak: num(b.dodgeStreak, 1e6),
    dodgeStreakBest: num(b.dodgeStreakBest, 1e6),
    blocks: num(b.blocks, 100000),
    parries: num(b.parries, 100000),
    blockedDamage: num(b.blockedDamage),
    zeroHits: num(b.zeroHits, 100000),
    statuses: Array.isArray(b.statuses) ? b.statuses.filter((s): s is StatusType => typeof s === "string" && STATUS_SET.has(s)).slice(0, 2000) : [],
    swampTicks: num(b.swampTicks, 100000),
    inSwamp: b.inSwamp === true,
    minHpPct: typeof b.minHpPct === "number" && Number.isFinite(b.minHpPct) ? Math.max(0, Math.min(1, b.minHpPct)) : 1,
    hp: num(b.hp),
    mp: num(b.mp),
    hitsTaken: num(b.hitsTaken, 100000),
    hitStreak: num(b.hitStreak, 1e6),
    guardStored: num(b.guardStored),
    boss: {
      hits: num(boss.hits, 100000),
      parries: num(boss.parries, 100000),
      parryDmg: num(boss.parryDmg),
      dodges: num(boss.dodges, 100000),
      weaponHits: num(boss.weaponHits, 100000),
      dmg: num(boss.dmg),
    },
    bossEnd: b.bossEnd === true,
    duel: b.duel === true,
    stormFights: num(b.stormFights, 1000),
    phantomFights: num(b.phantomFights, 1000),
    escapes: num(b.escapes, 1000),
    stunsDealt: num(b.stunsDealt, 100000),
    combos7: num(b.combos7, 100000),
    cleanFights: num(b.cleanFights, 1000),
    quickDraws: num(b.quickDraws, 1000),
    farHits: num(b.farHits, 100000),
    markedRuns: num(b.markedRuns, 1000),
    killSkill: typeof b.killSkill === "string" ? b.killSkill.slice(0, 64) : undefined,
  };
}
