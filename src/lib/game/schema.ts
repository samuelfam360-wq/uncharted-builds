import { z } from "zod";
import { STAT_KEYS, STATUS_TYPES, WEAPON_TYPES, type ActiveEffect, type Condition, type SkillDefinition } from "./types";

// Validates skill definitions edited on the admin page, so a typo can't break the game.

const op = z.enum([">=", ">", "<=", "<", "==", "!="]);
const stat = z.enum(STAT_KEYS);
const status = z.enum(STATUS_TYPES);

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(conditionSchema) }).strict(),
    z.object({ any: z.array(conditionSchema) }).strict(),
    z.object({ not: conditionSchema }).strict(),
    z.object({ counter: z.string().min(1), op, value: z.number() }).strict(),
    z.object({ stat, op, value: z.number() }).strict(),
    z.object({ player: z.literal("level"), op, value: z.number() }).strict(),
    z.object({ battle: z.string().min(1), op, value: z.union([z.number(), z.string(), z.boolean()]) }).strict(),
    z.object({ skill: z.string().min(1), owned: z.boolean().optional() }).strict(),
    z.object({ zone: z.string().min(1) }).strict(),
    z.object({ stat_spread: z.literal(true), op, value: z.number() }).strict(),
  ]),
);

const statMap = z.partialRecord(stat, z.number());
const statusSpec = z.object({ type: status, chance: z.number().min(0).max(1), turns: z.number().int().min(1) });

const activeSchema: z.ZodType<ActiveEffect> = z
  .object({
    mp_cost: z.number().min(0).optional(),
    hp_cost_pct: z.number().min(0).max(1).optional(),
    multiplier: z.number().optional(),
    element: z.enum(["physical", "magic"]).optional(),
    hits: z.number().int().min(1).max(10).optional(),
    scale_stat: stat.optional(),
    piercing_stat: stat.optional(),
    piercing_flat: z.number().optional(),
    area: z.boolean().optional(),
    crit_bonus: z.number().optional(),
    status: statusSpec.optional(),
    heal_pct: z.number().optional(),
    cleanse: z.boolean().optional(),
    cooldown_s: z.number().min(0).optional(),
    shadow_walk: z.object({ invisible_s: z.number().min(0) }).strict().optional(),
    ultimate: z
      .object({
        gauge: z.enum(["boss_hits", "boss_parries", "boss_dodges", "boss_weapon_hits", "boss_mp_spent", "boss_healed", "boss_charges"]),
        tiers: z.tuple([z.number().int().min(1), z.number().int().min(1), z.number().int().min(1)]),
        field: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const effectSchema = z
  .object({
    weapons: z.array(z.enum(WEAPON_TYPES)).optional(),
    stat_multiplier: statMap.optional(),
    stat_bonus: statMap.optional(),
    immunities: z.array(status).optional(),
    status_resist: z.partialRecord(status, z.number().min(0).max(1)).optional(),
    poison_damage_mult: z.number().min(0).optional(),
    passive: z
      .object({
        low_hp_damage: z.object({ threshold: z.number(), multiplier: z.number() }).optional(),
        unarmed_stat: stat.optional(),
        heal_on_win_pct: z.number().optional(),
        dodge_invisibility: z.number().int().optional(),
        pacifist: z.boolean().optional(),
        poison_aura: z.object({ chance: z.number(), turns: z.number().int() }).optional(),
        revive_once: z.boolean().optional(),
        flee_always: z.boolean().optional(),
        mp_regen: z.number().optional(),
        damage_multiplier: z.number().optional(),
        reflect_pct: z.number().optional(),
        hazard_immunity: z.array(z.string()).optional(),
        blade_read: z.object({ pierce_at: z.number().int().min(1), execute_at: z.number().int().min(1) }).strict().optional(),
        hundred_cuts: z.object({ per_hit: z.number().min(0), adjacent_at: z.number().int().min(1), screen_at: z.number().int().min(1) }).strict().optional(),
        duelist: z.object({ stat, mult: z.number().min(1) }).strict().optional(),
        riposte: activeSchema.optional(),
        vault: z.boolean().optional(),
        storm: activeSchema.optional(),
        mastery_growth: z.number().min(0).optional(),
        silent_finish: z.object({ mult: z.number().min(1), chain_max: z.number().min(1), hide_s: z.number().min(0) }).strict().optional(),
        phantom_legion: z.object({ pct: z.number().min(0).max(1), life_s: z.number().min(0), max: z.number().int().min(1) }).strict().optional(),
        thousand_needles: z.object({ stacks: z.number().int().min(1), boss_pct: z.number().min(0).max(1), tick_pct: z.number().min(0) }).strict().optional(),
        armor_crusher: z.object({ per_hit: z.number().min(0), max: z.number().min(0).max(1) }).strict().optional(),
        quake_slam: z.object({ stun_ms: z.number().min(0), reach: z.number().min(0) }).strict().optional(),
        ringing_blow: z.object({ extra_ms: z.number().min(0), dmg_mult: z.number().min(1) }).strict().optional(),
        seven_strikes: z.object({ every: z.number().int().min(2), mult: z.number().min(1), gap_ms: z.number().min(0) }).strict().optional(),
        breath_control: z.object({ hp_pct: z.number().min(0), mp: z.number().min(0) }).strict().optional(),
        quick_draw: z.boolean().optional(),
        dead_mans_hand: z.object({ below: z.number().min(0).max(1), rate: z.number().min(1) }).strict().optional(),
        hawk_line: z.object({ range: z.number().min(1), max_mult: z.number().min(1) }).strict().optional(),
        marked_prey: z.boolean().optional(),
        spell_thief: z.object({ mult: z.number().min(1) }).strict().optional(),
        chain_catastrophe: z.object({ radius: z.number().min(0) }).strict().optional(),
        blood_sorcery: z.object({ hp_per_mp: z.number().min(0), mult: z.number().min(1) }).strict().optional(),
        grace_rebound: z.object({ below: z.number().min(0).max(1), mult: z.number().min(1) }).strict().optional(),
        soul_drain: z.object({ pct: z.number().min(0).max(1), max_shield: z.number().min(0) }).strict().optional(),
        comet_charge: z.object({ max_mult: z.number().min(1) }).strict().optional(),
        iron_momentum: z.boolean().optional(),
        sky_lance: z.object({ reach: z.number().min(0) }).strict().optional(),
        spellblade: z.object({ int_mult: z.number().min(0) }).strict().optional(),
        iron_sanctuary: z.object({ pct: z.number().min(0).max(1) }).strict().optional(),
        life_palm: z.object({ pct: z.number().min(0).max(1) }).strict().optional(),
        shared_glory: z.object({ stat_share: z.number().min(0).max(1), exp_mult: z.number().min(0) }).strict().optional(),
        beast_tongue: z.object({ early_ms: z.number().min(0).max(5000) }).strict().optional(),
        slime_mercy: z.object({ monsters: z.array(z.string()).max(50) }).strict().optional(),
        foe_bane: z.object({ monsters: z.array(z.string()).max(50), mult: z.number().min(1).max(10) }).strict().optional(),
        scar_aura: z.object({ radius: z.number().min(0).max(2000), slow: z.number().min(0).max(1) }).strict().optional(),
      })
      .strict()
      .optional(),
    active: activeSchema.optional(),
  })
  .strict();

export const skillDefinitionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/, "lowercase letters, digits and underscores only"),
    name: z.string().min(1),
    description: z.string(),
    kind: z.enum(["active", "passive"]),
    hidden: z.boolean(),
    conditions: conditionSchema,
    effect: effectSchema,
    locks: z.array(stat),
    limit: z.number().int().min(1).nullable(),
    evolvesFrom: z.string().nullable(),
    excludes: z.array(z.string()),
    usesPerBattle: z.number().int().min(1).nullable(),
    rumor: z.string().nullable(),
    enabled: z.boolean(),
  })
  .strict() satisfies z.ZodType<SkillDefinition>;
