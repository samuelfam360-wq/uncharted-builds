// The 80% reveal: once a player is 80% of the way to a hidden skill, the game
// tells them what's left. The skill's name stays hidden until it unlocks.

import { COUNTER_KEYS } from "./counters";
import { MONSTERS } from "./data/world";
import { compare, statSpread, type RuleContext } from "./rules";
import type { Condition, PlayerSkill, SkillDefinition, WeaponType } from "./types";

export const REVEAL_AT = 0.8;

export interface Hint {
  pct: number; // 0.8 .. 1
  left: string[]; // what's still missing, in plain words
}

const WEAPON_WORDS: Partial<Record<WeaponType, string>> = {
  sword: "a sword",
  staff: "a staff",
  daggers: "a dagger",
  large_shield: "a shield",
  bow: "a bow",
  pistol: "a pistol",
  tamer_wand: "a tamer wand",
  lance: "a lance",
  healing_bracelet: "a healing bracelet",
  hammer: "a hammer",
  unarmed: "your fists",
};

const n = (v: number) => Math.max(0, Math.ceil(v)).toLocaleString("en-US");

/** What's missing for one counter, in the player's words. "Best" counters are about one fight, so they show the target. */
function counterText(key: string, cur: number, target: number): string {
  const left = target - cur;
  if (key.startsWith("kills_")) {
    const w = key.slice(6) as WeaponType;
    return `Defeat ${n(left)} more enemies with ${WEAPON_WORDS[w] ?? w}`;
  }
  if (key.startsWith("hits_")) {
    const w = key.slice(5) as WeaponType;
    if (WEAPON_WORDS[w]) return `Land ${n(left)} more hits with ${WEAPON_WORDS[w]}`;
  }
  // falling to a monster (the newbie skills)
  const monsterName = (id: string) => MONSTERS[id]?.name ?? id.replace(/_/g, " ");
  if (key.startsWith("killed_by_")) return `Fall to a ${monsterName(key.slice(10))} ${n(left)} more times`;
  if (key.startsWith("defeated_") && MONSTERS[key.slice(9)]) return `Defeat ${n(left)} more ${monsterName(key.slice(9))}s`;
  if (key.startsWith("poison_deaths_")) return `Fall to a ${monsterName(key.slice(14))}'s poison ${n(left)} more times`;
  switch (key) {
    case "parries":
      return `Parry ${n(left)} more attacks`;
    case "perfect_blocks":
      return `Land ${n(left)} more perfect blocks (parries with a shield)`;
    case "hit_streak_best":
      return `Land ${n(target)} hits in a row in one fight without being hit (best so far: ${n(cur)})`;
    case "boss_duels_won":
      return `Beat ${n(left)} more bosses one-on-one, with only a sword and no items`;
    case "boss_fight_parry_dmg_best":
      return `Parry ${n(target)} damage in a single boss fight (best so far: ${n(cur)})`;
    case "boss_fight_hits_best":
      return `Survive ${n(target)} boss hits in one fight (best so far: ${n(cur)})`;
    case "damage_taken":
      return `Take ${n(left)} more damage`;
    case "storm_fights_survived":
      return `Survive ${n(left)} more fights surrounded by 10 or more enemies`;
    case "battles_won":
      return `Win ${n(left)} more battles`;
    case "times_poisoned":
      return `Get poisoned ${n(left)} more times`;
    case "poisoned_since_death":
      return `Get poisoned ${n(left)} more times without dying`;
    case "inedible_eaten":
      return `Eat ${n(left)} more things that aren't food`;
    case "dodge_streak_best":
      return `Dodge ${n(target)} attacks in a row without being hit (best so far: ${n(cur)})`;
    case "low_hp_wins":
      return `Win ${n(left)} more battles below 10% HP`;
    case "swamp_turns":
      return `Fight in the poison swamp for ${n(left)} more turns`;
    case "defend_used":
      return `Block ${n(left)} more times`;
    case "crits_landed":
      return `Land ${n(left)} more critical hits`;
    case "magic_damage_dealt":
      return `Deal ${n(left)} more magic damage`;
    case "damage_blocked":
      return `Soak up ${n(left)} more damage with your defense`;
    case "one_hit_kills":
      return `Defeat ${n(left)} more enemies with a single hit`;
    case "phantom_fights":
      return `Dodge 50 attacks in a row in one fight, ${n(left)} more times`;
    case "crits_daggers":
      return `Land ${n(left)} more critical hits with a dagger`;
    case "escapes":
      return `Get away from ${n(left)} more fights`;
    case "boss_fight_dodges_best":
      return `Dodge ${n(target)} boss attacks in a single fight (best so far: ${n(cur)})`;
    case "skill_kills_ground_slam":
      return `Defeat ${n(left)} more enemies with Ground Slam`;
    case "stuns_dealt":
      return `Stun ${n(left)} more enemies`;
    case "boss_fight_hits_hammer_best":
      return `Land ${n(target)} hammer hits on one boss in a single fight (best so far: ${n(cur)})`;
    case "combos_7":
      return `Land a 7-hit combo with your fists ${n(left)} more times`;
    case "clean_fights":
      return `Win ${n(left)} more fights without eating anything`;
    case "boss_fight_hits_fists_best":
      return `Land ${n(target)} unarmed hits on one boss in a single fight (best so far: ${n(cur)})`;
    case "quick_draw_wins":
      return `Win ${n(left)} more fights with a pistol, shooting first within 1 second`;
    case "boss_fight_gun_dmg_best":
      return `Deal ${n(target)} pistol damage in a single boss fight (best so far: ${n(cur)})`;
    case "max_range_hits":
      return `Land ${n(left)} more bow hits from near your maximum range`;
    case "marked_runs":
      return `Land 100 bow hits in a row on one target without missing, ${n(left)} more times`;
    case "spells_survived":
      return `Survive ${n(left)} more enemy spells`;
    case "max_pack_fights":
      return `Win ${n(left)} more fights with as many pets out as you can have`;
    case "pet_kills":
      return `Your pet lands ${n(left)} more killing blows`;
    case "pet_solo_boss_wins":
      return `Win ${n(left)} more boss fight${left === 1 ? "" : "s"} where your pet does all the damage`;
    case "species_tamed":
      return `Tame ${n(left)} more different species`;
    case "spell_kills":
      return `Defeat ${n(left)} more enemies with spells`;
    case "hp_healed":
      return `Heal ${n(left)} more HP`;
    case "hp_healed_unarmed":
      return `Heal ${n(left)} more HP while fighting with your fists (empty hands or a strength bracelet)`;
    case "spell_multikills_10":
      return `Defeat 10 enemies with a single spell, ${n(left)} more times`;
    case "zero_mp_kills":
      return `Defeat ${n(left)} more enemies with a spell that drops your MP to exactly 0`;
    case "boss_fight_mp_spent_best":
      return `Spend ${n(target)} MP in a single boss fight (best so far: ${n(cur)})`;
    case "low_hp_heals":
      return `Heal yourself from below 5% HP ${n(left)} more times`;
    case "boss_fight_healed_best":
      return `Heal or drain ${n(target)} HP in a single boss fight (best so far: ${n(cur)})`;
    case "max_charge_kills":
      return `Defeat ${n(left)} more enemies with a lance charge from full distance`;
    case "charges_done":
      return `Complete ${n(left)} more lance charges`;
    case "jump_kills":
      return `Defeat ${n(left)} more enemies with a lance attack in the air`;
    case "boss_fight_charge_hits_best":
      return `Land ${n(target)} lance charges on one boss in a single fight (best so far: ${n(cur)})`;
    case "masteries_lv20":
      return `Reach mastery level 20 in ${n(left)} more masteries`;
    default:
      return `${COUNTER_KEYS[key as keyof typeof COUNTER_KEYS] ?? key.replace(/_/g, " ")}: ${n(left)} more`;
  }
}

interface Part {
  pct: number;
  left: string | null;
}

/** Progress through a condition, or null when it can't be measured (battle snapshots, "any", "not"...). */
export function progress(cond: Condition, ctx: RuleContext): Part[] | null {
  if ("all" in cond) {
    const parts: Part[] = [];
    for (const c of cond.all) {
      const p = progress(c, ctx);
      if (!p) return null;
      parts.push(...p);
    }
    return parts;
  }
  if ("counter" in cond || "player" in cond || ("stat" in cond && cond.op !== "==" && cond.op !== "!=")) {
    if (cond.op !== ">=" && cond.op !== ">") return null;
    const target = cond.op === ">" ? cond.value + 1 : cond.value;
    const cur = "counter" in cond ? ctx.counters[cond.counter] ?? 0 : "player" in cond ? ctx.level : ctx.stats[cond.stat] ?? 0;
    if (cur >= target) return [{ pct: 1, left: null }];
    const pct = target > 0 ? Math.max(0, cur / target) : 0;
    const left =
      "counter" in cond ? counterText(cond.counter, cur, target) : "player" in cond ? `Reach level ${target}` : `Raise ${cond.stat} to ${target}`;
    return [{ pct, left }];
  }
  if ("stat" in cond || "stat_spread" in cond) {
    // Yes-or-no parts: either already true, or not measurable as a percentage.
    const met = "stat" in cond ? compare(ctx.stats[cond.stat] ?? 0, cond.op, cond.value) : compare(statSpread(ctx.stats), cond.op, cond.value);
    if (met) return [{ pct: 1, left: null }];
    return [
      {
        pct: 0,
        left: "stat" in cond ? `${cond.stat} must be ${cond.value}` : `Keep all 7 stats within ${cond.value} points of each other`,
      },
    ];
  }
  return null;
}

const OPS: Record<string, string> = { ">=": "at least", ">": "more than", "<=": "at most", "<": "less than", "==": "exactly", "!=": "anything but" };

/** One battle fact, in plain words. */
function battleText(key: string, op: string, value: number | string | boolean): string {
  switch (key) {
    case "result":
      return value === "win" ? "Win a fight" : `End a fight: ${value}`;
    case "min_hp_pct":
      return `Drop to ${Math.round(Number(value) * 100)}% HP or lower during that fight`;
    case "dungeon_cleared":
      return value ? "Clear a dungeon" : "Don't clear the dungeon";
    case "dungeon_direct_damage":
      return value === 0 && op === "==" ? "Without hitting anything directly in the whole run" : `Direct damage in the run: ${OPS[op] ?? op} ${value}`;
    case "enemy_is_boss":
      return value ? "Against a boss" : "Against a monster that isn't a boss";
    case "enemy_type":
      return `Against a ${value}-type monster`;
    case "attacks_made":
      return value === 0 && op === "==" ? "Without attacking once in that fight" : `Attacks in that fight: ${OPS[op] ?? op} ${value}`;
    default:
      return `${key.replace(/_/g, " ")}: ${OPS[op] ?? op} ${value}`;
  }
}

/**
 * What a skill asks of you, in plain words: shown when it unlocks, so you can
 * tell what you did to earn it. Counter goals read like the 80% hints.
 */
export function describeCondition(cond: Condition, skillName: (id: string) => string = (id) => id): string[] {
  if ("all" in cond) return cond.all.flatMap((c) => describeCondition(c, skillName));
  if ("any" in cond) {
    const parts = cond.any.map((c) => describeCondition(c, skillName).join(", "));
    return parts.length ? [parts.join(", or ")] : [];
  }
  if ("not" in cond) return describeCondition(cond.not, skillName).map((t) => `Not: ${t}`);
  if ("counter" in cond) {
    const target = cond.op === ">" ? cond.value + 1 : cond.value;
    if (cond.op !== ">=" && cond.op !== ">") return [`${COUNTER_KEYS[cond.counter as keyof typeof COUNTER_KEYS] ?? cond.counter.replace(/_/g, " ")}: ${OPS[cond.op]} ${n(cond.value)}`];
    return [counterText(cond.counter, 0, target).replace(/ \(best so far: [^)]*\)/, "").replace(/ more\b/, "")];
  }
  if ("player" in cond) return [`Be level ${OPS[cond.op] ?? cond.op} ${cond.value}`];
  if ("stat" in cond) return [cond.op === "==" && cond.value === 0 ? `Keep ${cond.stat} at 0` : `${cond.stat} ${OPS[cond.op] ?? cond.op} ${cond.value}`];
  if ("stat_spread" in cond) return [`Keep all 7 stats within ${cond.value} points of each other`];
  if ("battle" in cond) return [battleText(cond.battle, cond.op, cond.value)];
  if ("skill" in cond) return [`Own ${skillName(cond.skill)}`];
  if ("zone" in cond) return [`In ${cond.zone.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`];
  return [];
}

/** Hints for every hidden skill the player is close to. Never names the skill. */
export function revealHints(defs: Iterable<SkillDefinition>, playerSkills: PlayerSkill[], ctx: RuleContext): Hint[] {
  const known = new Set(playerSkills.map((s) => s.skillId));
  const owned = new Set(playerSkills.filter((s) => s.status === "owned").map((s) => s.skillId));
  const list = [...defs];
  const out: Hint[] = [];
  for (const d of list) {
    if (!d.enabled || !d.hidden || known.has(d.id)) continue;
    // A path closed by a skill you chose stays closed.
    if (d.excludes.some((id) => owned.has(id)) || list.some((x) => x.excludes.includes(d.id) && owned.has(x.id))) continue;
    const parts = progress(d.conditions, ctx);
    if (!parts?.length) continue;
    const pct = Math.min(...parts.map((p) => p.pct));
    if (pct < REVEAL_AT || pct >= 1) continue;
    out.push({ pct: Math.floor(pct * 100) / 100, left: parts.map((p) => p.left).filter((l): l is string => !!l) });
  }
  return out.sort((a, b) => b.pct - a.pct);
}
