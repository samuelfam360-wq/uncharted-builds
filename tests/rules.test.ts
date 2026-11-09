import { describe, expect, it } from "vitest";
import { evaluate, findUnlocks, type RuleContext } from "../src/lib/game/rules";
import { STARTER_SKILLS } from "../src/lib/game/data/skills";
import { skillDefinitionSchema } from "../src/lib/game/schema";
import { emptyStats } from "../src/lib/game/constants";

const ctx = (over: Partial<RuleContext> = {}): RuleContext => ({
  counters: {},
  stats: emptyStats(),
  level: 1,
  ownedSkills: new Set(),
  zone: null,
  battle: null,
  ...over,
});
const byId = (id: string) => STARTER_SKILLS.find((s) => s.id === id)!;

describe("condition evaluation", () => {
  it("supports all / any / not groups", () => {
    const c = { all: [{ counter: "a", op: ">=" as const, value: 2 }, { not: { stat: "STR" as const, op: ">" as const, value: 0 } }] };
    expect(evaluate(c, ctx({ counters: { a: 2 } }))).toBe(true);
    expect(evaluate(c, ctx({ counters: { a: 1 } }))).toBe(false);
    expect(evaluate(c, ctx({ counters: { a: 5 }, stats: { ...emptyStats(), STR: 1 } }))).toBe(false);
    expect(evaluate({ any: [] }, ctx())).toBe(false);
    expect(evaluate({ all: [] }, ctx())).toBe(true);
  });

  it("treats missing counters as zero and missing battle data as no match", () => {
    expect(evaluate({ counter: "never_seen", op: "==", value: 0 }, ctx())).toBe(true);
    expect(evaluate({ battle: "result", op: "==", value: "win" }, ctx())).toBe(false);
  });

  it("checks location and prerequisite skills", () => {
    expect(evaluate({ zone: "mirewood_fields" }, ctx({ zone: "mirewood_fields" }))).toBe(true);
    expect(evaluate({ skill: "x" }, ctx({ ownedSkills: new Set(["x"]) }))).toBe(true);
    expect(evaluate({ skill: "x", owned: false }, ctx({ ownedSkills: new Set(["x"]) }))).toBe(false);
  });
});

describe("starter skills", () => {
  it("has 15 to 20 discoverable skills, 3+ with stat locks, 2+ that evolve", () => {
    const discoverable = STARTER_SKILLS.filter((s) => !("any" in s.conditions && s.conditions.any.length === 0));
    expect(discoverable.length).toBeGreaterThanOrEqual(15);
    expect(discoverable.length).toBeLessThanOrEqual(20);
    expect(STARTER_SKILLS.filter((s) => s.locks.length > 0).length).toBeGreaterThanOrEqual(3);
    expect(STARTER_SKILLS.filter((s) => s.evolvesFrom).length).toBeGreaterThanOrEqual(2);
  });

  it("all validate against the admin schema", () => {
    for (const s of STARTER_SKILLS) expect(skillDefinitionSchema.safeParse(s).success, s.id).toBe(true);
  });

  it("Iron Endurance unlocks for a 0 STR tank who blocked 5000 and never attacked", () => {
    const c = ctx({ counters: { damage_blocked: 5000 }, battle: { attacks_made: 0 } });
    const found = findUnlocks(STARTER_SKILLS, [], c).map((u) => u.skill.id);
    expect(found).toContain("iron_endurance");
    const u = findUnlocks(STARTER_SKILLS, [], c).find((x) => x.skill.id === "iron_endurance")!;
    expect(u.needsConfirmation).toBe(true);
    // One point in STR closes it.
    expect(findUnlocks(STARTER_SKILLS, [], { ...c, stats: { ...emptyStats(), STR: 1 } }).map((x) => x.skill.id)).not.toContain(
      "iron_endurance",
    );
  });

  it("mutual exclusion: owning Glass Fury hides Iron Endurance", () => {
    const c = ctx({ counters: { damage_blocked: 5000 }, battle: { attacks_made: 0 } });
    const owned = [{ skillId: "glass_fury", status: "owned" as const, equipped: true, stage: 1, evolvedInto: null, unlockedAt: "" }];
    expect(findUnlocks(STARTER_SKILLS, owned, c).map((u) => u.skill.id)).not.toContain("iron_endurance");
  });

  it("poison chain only evolves in order", () => {
    const c = ctx({ counters: { times_poisoned: 500, poisoned_since_death: 200 } });
    expect(findUnlocks(STARTER_SKILLS, [], c).map((u) => u.skill.id)).toEqual(["poison_resistance"]);
    const owned = [{ skillId: "poison_resistance", status: "owned" as const, equipped: true, stage: 1, evolvedInto: null, unlockedAt: "" }];
    expect(findUnlocks(STARTER_SKILLS, owned, { ...c, ownedSkills: new Set(["poison_resistance"]) }).map((u) => u.skill.id)).toEqual([
      "poison_immunity",
    ]);
    expect(byId("venom_body").evolvesFrom).toBe("poison_immunity");
  });

  it("never unlocks item-only skills or disabled skills", () => {
    const defs = STARTER_SKILLS.map((s) => (s.id === "poison_resistance" ? { ...s, enabled: false } : s));
    const ids = findUnlocks(defs, [], ctx({ counters: { times_poisoned: 999 } })).map((u) => u.skill.id);
    expect(ids).not.toContain("poison_resistance");
    expect(ids).not.toContain("thorn_retort");
  });
});
