import type { SkillDefinition } from "../types";

type Def = Pick<SkillDefinition, "id" | "name" | "description" | "kind" | "conditions" | "effect"> & Partial<SkillDefinition>;

const def = (d: Def): SkillDefinition => ({
  hidden: true,
  enabled: true,
  limit: null,
  evolvesFrom: null,
  excludes: [],
  usesPerBattle: null,
  locks: [],
  rumor: null,
  ...d,
});

/**
 * Hidden mastery skills, with the names and numbers agreed in the design
 * (Sword and Shield masteries, plus the multi-mastery skills that work today).
 * Skills whose game systems don't exist yet are here but switched off.
 * Like the starter skills, the live copy is the skill_definitions table.
 */
export const MASTERY_SKILLS: SkillDefinition[] = [
  // ---------- Sword mastery ----------
  def({
    id: "blade_read",
    name: "Blade Read",
    description:
      "After a parry, your next slash can't miss and always crits. 3 parries in a row: that slash ignores defense. 20 parries in a row: your next slash one-shots any monster that isn't a boss. Needs a sword in hand.",
    kind: "passive",
    conditions: { counter: "parries", op: ">=", value: 1000 },
    effect: { weapons: ["sword"], passive: { blade_read: { pierce_at: 3, execute_at: 20 } } },
  }),
  def({
    id: "hundred_cuts",
    name: "Hundred Cuts",
    description:
      "Each hit in a row adds 2% damage. 50 in a row: slashes also hit enemies next to your target. 100 in a row: a slash hits every enemy on screen. Getting hit resets the count to 0. Needs a sword in hand.",
    kind: "passive",
    conditions: { counter: "hit_streak_best", op: ">=", value: 100 },
    effect: { weapons: ["sword"], passive: { hundred_cuts: { per_hit: 0.02, adjacent_at: 50, screen_at: 100 } } },
  }),
  def({
    id: "duelists_oath",
    name: "Duelist's Oath",
    description: "+30% STR while fighting a single enemy. Turns off when more enemies join.",
    kind: "passive",
    conditions: { counter: "boss_duels_won", op: ">=", value: 50 },
    effect: { passive: { duelist: { stat: "STR", mult: 1.3 } } },
  }),
  def({
    id: "broken_blade",
    name: "Broken Blade",
    description: "Broken swords deal double damage, and a sword breaking mid-fight makes its shards explode.",
    kind: "passive",
    conditions: { counter: "broken_blade_kills", op: ">=", value: 300 },
    effect: {},
    enabled: false, // waits for weapon durability
  }),
  def({
    id: "parry_emperor",
    name: "Parry Emperor",
    description:
      "Ultimate, bosses only. Each successful parry against a boss charges the gauge (a missed parry doesn't drain it). 25: counter for 50% of the boss's HP (once per fight, resets the gauge). 50: a full kill. 100: a full kill + 20% EXP. Fire or keep charging at each tier.",
    kind: "active",
    conditions: { counter: "boss_fight_parry_dmg_best", op: ">=", value: 100000 },
    effect: { active: { ultimate: { gauge: "boss_parries", tiers: [25, 50, 100] } } },
  }),

  // ---------- Shield mastery ----------
  def({
    id: "retribution",
    name: "Retribution",
    description:
      "Ultimate, bosses only. Each boss attack you survive charges the gauge (a multi-strike swing counts once). 50: counter for 50% of the boss's HP (once per fight, resets the gauge). 100: a full kill. 200: a full kill + 20% EXP. Fire or keep charging at each tier.",
    kind: "active",
    conditions: { counter: "boss_fight_hits_best", op: ">=", value: 50 },
    effect: { active: { ultimate: { gauge: "boss_hits", tiers: [50, 100, 200] } } },
  }),
  def({
    id: "titans_defiance",
    name: "Titan's Defiance",
    description:
      "Against a higher-level monster, after 5 defends (20 against a boss) you become immune to damage for 10 seconds. 15 minute cooldown. Hits taken while immune still count toward Retribution.",
    kind: "passive",
    conditions: { counter: "titan_kills", op: ">=", value: 1 },
    effect: {},
    enabled: false, // waits for monster levels
  }),
  def({
    id: "iron_riposte",
    name: "Iron Riposte",
    description: "Every perfect block (a parry with your shield) automatically strikes back with VIT-based damage.",
    kind: "passive",
    conditions: { counter: "perfect_blocks", op: ">=", value: 1000 },
    effect: { weapons: ["large_shield"], passive: { riposte: { multiplier: 1, scale_stat: "VIT", element: "physical" } } },
  }),
  def({
    id: "vengeance_vault",
    name: "Vengeance Vault",
    description: "Damage you block while guarding is stored. Let go of block to release it as one piercing shockwave.",
    kind: "passive",
    conditions: { counter: "damage_taken", op: ">=", value: 1_000_000 },
    effect: { passive: { vault: true } },
  }),
  def({
    id: "eye_of_the_storm",
    name: "Eye of the Storm",
    description: "Every enemy hit you take strikes back at all the enemies around you at once, with VIT-based damage.",
    kind: "passive",
    conditions: { counter: "storm_fights_survived", op: ">=", value: 100 },
    effect: { passive: { storm: { multiplier: 1, scale_stat: "VIT", element: "physical", area: true } } },
  }),

  // ---------- Multi-mastery ----------
  def({
    id: "wanderers_path",
    name: "Wanderer's Path",
    description: "All your masteries grow 10% faster.",
    kind: "passive",
    conditions: { counter: "masteries_lv20", op: ">=", value: 5 },
    effect: { passive: { mastery_growth: 1.1 } },
  }),
  def({
    id: "adaptive_body",
    name: "Adaptive Body",
    description: "+10% to all stats.",
    kind: "passive",
    conditions: {
      all: [
        { player: "level", op: ">=", value: 30 },
        { stat_spread: true, op: "<=", value: 5 },
      ],
    },
    effect: { stat_multiplier: { HP: 1.1, MP: 1.1, STR: 1.1, VIT: 1.1, AGI: 1.1, DEX: 1.1, INT: 1.1 } },
  }),
];
