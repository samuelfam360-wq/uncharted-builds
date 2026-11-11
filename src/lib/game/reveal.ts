// The 80% reveal: once a player is 80% of the way to a hidden skill, the game
// tells them what's left. The skill's name stays hidden until it unlocks.

import { COUNTER_KEYS } from "./counters";
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
