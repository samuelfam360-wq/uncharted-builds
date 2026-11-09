import { z } from "zod";
import { STAT_KEYS, STATUS_TYPES, type Condition, type SkillDefinition } from "./types";

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
  ]),
);

const statMap = z.partialRecord(stat, z.number());
const statusSpec = z.object({ type: status, chance: z.number().min(0).max(1), turns: z.number().int().min(1) });

export const effectSchema = z
  .object({
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
      })
      .strict()
      .optional(),
    active: z
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
      })
      .strict()
      .optional(),
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
