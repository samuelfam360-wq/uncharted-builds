import type { CompareOp, Condition, Counters, PlayerSkill, SkillDefinition, Stats } from "./types";

/** A snapshot of the last fight (or dungeon run), used by "battle" conditions. */
export type BattleSummary = Record<string, number | string | boolean>;

export interface RuleContext {
  counters: Counters;
  stats: Stats; // allocated points, so "STR equals 0" means the player never invested in STR
  level: number;
  ownedSkills: Set<string>;
  zone: string | null;
  battle: BattleSummary | null;
}

export function compare(actual: unknown, op: CompareOp, expected: number | string | boolean): boolean {
  if (actual === undefined || actual === null) {
    // A missing counter is 0; a missing battle value never matches.
    if (typeof expected === "number") actual = 0;
    else return op === "!=";
  }
  switch (op) {
    case "==":
      return actual === expected;
    case "!=":
      return actual !== expected;
    case ">=":
      return (actual as number) >= (expected as number);
    case ">":
      return (actual as number) > (expected as number);
    case "<=":
      return (actual as number) <= (expected as number);
    case "<":
      return (actual as number) < (expected as number);
  }
}

/** Evaluate a JSON condition tree. Supports all / any / not groups. */
export function evaluate(cond: Condition, ctx: RuleContext): boolean {
  if ("all" in cond) return cond.all.every((c) => evaluate(c, ctx));
  if ("any" in cond) return cond.any.some((c) => evaluate(c, ctx));
  if ("not" in cond) return !evaluate(cond.not, ctx);
  if ("counter" in cond) return compare(ctx.counters[cond.counter] ?? 0, cond.op, cond.value);
  if ("stat" in cond) return compare(ctx.stats[cond.stat] ?? 0, cond.op, cond.value);
  if ("player" in cond) return compare(ctx.level, cond.op, cond.value);
  if ("battle" in cond) return ctx.battle ? compare(ctx.battle[cond.battle], cond.op, cond.value) : false;
  if ("skill" in cond) return ctx.ownedSkills.has(cond.skill) === (cond.owned ?? true);
  if ("zone" in cond) return ctx.zone === cond.zone;
  return false;
}

export interface UnlockCandidate {
  skill: SkillDefinition;
  needsConfirmation: boolean; // locks or exclusions: the player must accept
}

/**
 * Check every enabled skill the player doesn't yet have against their current
 * state. Returns the skills whose conditions are now met. Server-first limits
 * are enforced by the store when granting, inside a transaction.
 */
export function findUnlocks(
  defs: SkillDefinition[],
  playerSkills: PlayerSkill[],
  ctx: RuleContext,
): UnlockCandidate[] {
  const known = new Map(playerSkills.map((s) => [s.skillId, s]));
  const owned = new Set(playerSkills.filter((s) => s.status === "owned").map((s) => s.skillId));
  const out: UnlockCandidate[] = [];
  for (const skill of defs) {
    if (!skill.enabled) continue;
    if (known.has(skill.id)) continue; // owned, already offered, or declined forever
    // Mutual exclusion: owning one closes the path to the other.
    if (skill.excludes.some((id) => owned.has(id))) continue;
    if (defs.some((d) => d.excludes.includes(skill.id) && owned.has(d.id))) continue;
    if (!evaluate(skill.conditions, ctx)) continue;
    out.push({ skill, needsConfirmation: skill.locks.length > 0 || skill.excludes.length > 0 });
  }
  return out;
}

/** Describe which leaves of a condition tree reference counters (for the admin page). */
export function referencedCounters(cond: Condition, acc = new Set<string>()): Set<string> {
  if ("all" in cond) cond.all.forEach((c) => referencedCounters(c, acc));
  else if ("any" in cond) cond.any.forEach((c) => referencedCounters(c, acc));
  else if ("not" in cond) referencedCounters(cond.not, acc);
  else if ("counter" in cond) acc.add(cond.counter);
  return acc;
}
