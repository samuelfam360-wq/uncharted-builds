import type { SkillDefinition } from "../types";

type Def = Omit<SkillDefinition, "hidden" | "enabled" | "limit" | "evolvesFrom" | "excludes" | "usesPerBattle" | "locks"> &
  Partial<Pick<SkillDefinition, "hidden" | "enabled" | "limit" | "evolvesFrom" | "excludes" | "usesPerBattle" | "locks">>;

const def = (d: Def): SkillDefinition => ({
  hidden: true,
  enabled: true,
  limit: null,
  evolvesFrom: null,
  excludes: [],
  usesPerBattle: null,
  locks: [],
  ...d,
});

/**
 * Floor 1 starter skills. This file is only the seed: the live copy is the
 * skill_definitions table, which the admin page edits without a deploy.
 * Regenerate the SQL seed with `npm run seed:sql`.
 */
export const STARTER_SKILLS: SkillDefinition[] = [
  // ---------- Build-defining skills with stat locks ----------
  def({
    id: "iron_endurance",
    name: "Iron Endurance",
    description: "Your VIT is doubled. You can no longer raise STR or AGI.",
    kind: "passive",
    conditions: {
      all: [
        { counter: "damage_blocked", op: ">=", value: 5000 },
        { stat: "STR", op: "==", value: 0 },
        { battle: "attacks_made", op: "==", value: 0 },
      ],
    },
    effect: { stat_multiplier: { VIT: 2 } },
    locks: ["STR", "AGI"],
    excludes: ["glass_fury"],
    rumor: "A knight in the old days never swung his sword once. They say the blows just stopped hurting him.",
  }),
  def({
    id: "glass_fury",
    name: "Glass Fury",
    description: "All your damage is multiplied by 1.5. You can no longer raise VIT or HP.",
    kind: "passive",
    conditions: {
      all: [
        { stat: "STR", op: ">=", value: 50 },
        { stat: "VIT", op: "==", value: 0 },
        { counter: "crits_landed", op: ">=", value: 20 },
      ],
    },
    effect: { passive: { damage_multiplier: 1.5 } },
    locks: ["VIT", "HP"],
    excludes: ["iron_endurance"],
    rumor: "Hit hard, hit true, and never wear armor. Some say the reckless get stronger for it.",
  }),
  def({
    id: "arcane_devotion",
    name: "Arcane Devotion",
    description: "INT x1.5 and you regain 3 MP every turn. You can no longer raise STR.",
    kind: "passive",
    conditions: {
      all: [
        { stat: "INT", op: ">=", value: 60 },
        { stat: "STR", op: "==", value: 0 },
        { counter: "magic_damage_dealt", op: ">=", value: 3000 },
      ],
    },
    effect: { stat_multiplier: { INT: 1.5 }, passive: { mp_regen: 3 } },
    locks: ["STR"],
    rumor: "The hermit by the lake never lifted anything heavier than a book.",
  }),

  // ---------- Poison evolution chain ----------
  def({
    id: "poison_resistance",
    name: "Poison Resistance",
    description: "Poison deals half damage and sometimes fails to take hold.",
    kind: "passive",
    conditions: { counter: "times_poisoned", op: ">=", value: 20 },
    effect: { poison_damage_mult: 0.5, status_resist: { poison: 0.3 } },
    rumor: "The swamp toads made me sick for a week. After that they barely bothered me.",
  }),
  def({
    id: "poison_immunity",
    name: "Poison Immunity",
    description: "Poison no longer affects you.",
    kind: "passive",
    evolvesFrom: "poison_resistance",
    conditions: {
      all: [
        { skill: "poison_resistance" },
        { counter: "poisoned_since_death", op: ">=", value: 100 },
      ],
    },
    effect: { immunities: ["poison"] },
    rumor: "Resistance is only the start. Keep drinking from the swamp and never fall, and the poison gives up.",
  }),
  def({
    id: "venom_body",
    name: "Venom Body",
    description: "Immune to poison, and anything that touches you may be poisoned.",
    kind: "passive",
    evolvesFrom: "poison_immunity",
    conditions: {
      all: [
        { skill: "poison_immunity" },
        { battle: "result", op: "==", value: "win" },
        { battle: "enemy_is_boss", op: "==", value: true },
        { battle: "enemy_type", op: "==", value: "poison" },
      ],
    },
    effect: { immunities: ["poison"], passive: { poison_aura: { chance: 0.5, turns: 3 } } },
    rumor: "Whoever beats the queen of the mire with her own weapon will carry her venom forever.",
  }),

  // ---------- Glutton / strange behavior ----------
  def({
    id: "glutton",
    name: "Glutton",
    description: "After winning a battle you eat what's left and restore 25% of your max HP.",
    kind: "passive",
    conditions: { counter: "inedible_eaten", op: ">=", value: 50 },
    effect: { passive: { heal_on_win_pct: 0.25 } },
    rumor: "My cousin eats slime jelly. Raw. He's never been healthier, somehow.",
  }),
  def({
    id: "pacifist",
    name: "Pacifist",
    description: "Enemies won't attack you until you attack them.",
    kind: "passive",
    conditions: {
      all: [
        { battle: "dungeon_cleared", op: "==", value: true },
        { battle: "dungeon_direct_damage", op: "==", value: 0 },
      ],
    },
    effect: { passive: { pacifist: true } },
    rumor: "A wanderer walked out of the Hollow with clean hands. Nobody knows how the queen fell.",
  }),
  def({
    id: "ghost_step",
    name: "Ghost Step",
    description: "After a dodge you vanish for a moment, and the next attack can't find you.",
    kind: "passive",
    // Doc idea is 1,000 in a row; lowered for the prototype. Tune in /admin.
    conditions: { counter: "dodge_streak_best", op: ">=", value: 100 },
    effect: { passive: { dodge_invisibility: 1 } },
    rumor: "The rabbits here are fast. Faster still is the one who never lets them land a hit.",
  }),
  def({
    id: "last_stand",
    name: "Last Stand",
    description: "Below 25% HP your damage is doubled.",
    kind: "passive",
    conditions: { counter: "low_hp_wins", op: ">=", value: 20 },
    effect: { passive: { low_hp_damage: { threshold: 0.25, multiplier: 2 } } },
    rumor: "Some fighters only wake up when they're one breath from the end.",
  }),
  def({
    id: "bare_knuckle",
    name: "Bare Knuckle",
    description: "Unarmed attacks scale with VIT instead of STR.",
    kind: "passive",
    conditions: { counter: "kills_unarmed", op: ">=", value: 300 },
    effect: { passive: { unarmed_stat: "VIT" } },
    rumor: "The old brawler said his fists got harder the more he got hit. Then he punched a golem.",
  }),
  def({
    id: "swamp_walker",
    name: "Swamp Walker",
    description: "The poison swamp no longer hurts you.",
    kind: "passive",
    conditions: {
      all: [
        { zone: "mirewood_fields" },
        { counter: "swamp_turns", op: ">=", value: 150 },
      ],
    },
    effect: { passive: { hazard_immunity: ["poison_swamp"] }, status_resist: { poison: 0.2 } },
    rumor: "Spend long enough knee-deep in the bog and it starts to treat you like family.",
  }),

  // ---------- Weapon mastery (early, first-hour unlocks) ----------
  def({
    id: "second_wind",
    name: "Second Wind",
    description: "Active. Restore 30% of your max HP. 8 MP.",
    kind: "active",
    usesPerBattle: 2,
    conditions: {
      all: [
        { counter: "battles_won", op: ">=", value: 5 },
        { battle: "result", op: "==", value: "win" },
        { battle: "min_hp_pct", op: "<=", value: 0.3 },
      ],
    },
    effect: { active: { mp_cost: 8, heal_pct: 0.3 } },
    rumor: "Win a fight you should have lost and your body remembers how to keep going.",
  }),
  def({
    id: "twin_cut",
    name: "Twin Cut",
    description: "Active. Two quick sword strikes at 80% power each. 6 MP.",
    kind: "active",
    conditions: { counter: "kills_sword", op: ">=", value: 25 },
    effect: { active: { mp_cost: 6, multiplier: 0.8, hits: 2, element: "physical" } },
    rumor: "The guard captain says a blade that's tasted enough monsters learns to strike twice.",
  }),
  def({
    id: "shield_bash",
    name: "Shield Bash",
    description: "Active. Slam with your guard, scaling with VIT. May stun. 5 MP.",
    kind: "active",
    conditions: {
      any: [
        { counter: "kills_large_shield", op: ">=", value: 20 },
        { counter: "defend_used", op: ">=", value: 60 },
      ],
    },
    effect: {
      active: { mp_cost: 5, multiplier: 1.2, scale_stat: "VIT", element: "physical", status: { type: "stun", chance: 0.3, turns: 1 } },
    },
    rumor: "A shield is a wall. A wall, swung hard enough, is a hammer.",
  }),
  def({
    id: "venom_fang",
    name: "Venom Fang",
    description: "Active. A dagger strike with a high crit chance that often poisons. 6 MP.",
    kind: "active",
    conditions: { counter: "kills_daggers", op: ">=", value: 25 },
    effect: {
      active: { mp_cost: 6, multiplier: 1.0, crit_bonus: 0.2, element: "physical", status: { type: "poison", chance: 0.6, turns: 3 } },
    },
    rumor: "Daggers dipped in the swamp long enough start carrying it with them.",
  }),
  def({
    id: "piercing_arrow",
    name: "Piercing Arrow",
    description: "Active. An arrow that adds your DEX as damage that ignores defense. 8 MP.",
    kind: "active",
    conditions: { counter: "kills_bow", op: ">=", value: 25 },
    effect: { active: { mp_cost: 8, multiplier: 0.8, piercing_stat: "DEX", element: "physical" } },
    rumor: "The hunters say the moss golems can't be scratched. The good hunters disagree.",
  }),
  def({
    id: "fireball",
    name: "Fireball",
    description: "Active. Magic fire that hits the whole area and may burn. 10 MP.",
    kind: "active",
    conditions: { counter: "kills_staff", op: ">=", value: 25 },
    effect: {
      active: { mp_cost: 10, multiplier: 1.6, element: "magic", area: true, status: { type: "burn", chance: 0.4, turns: 3 } },
    },
    rumor: "Swing a staff at enough wolves and sparks start coming out of the end.",
  }),
  def({
    id: "ground_slam",
    name: "Ground Slam",
    description: "Active. Smash the ground; can't be dodged and may stun. 9 MP.",
    kind: "active",
    conditions: { counter: "kills_hammer", op: ">=", value: 25 },
    effect: {
      active: { mp_cost: 9, multiplier: 1.3, element: "physical", area: true, status: { type: "stun", chance: 0.25, turns: 1 } },
    },
    rumor: "Miss with a hammer often enough and you stop aiming at the enemy. You aim at the ground.",
  }),

  // ---------- Server-first ----------
  def({
    id: "first_light",
    name: "First Light",
    description: "+5 to every combat stat. Only one player on the server will ever hold this.",
    kind: "passive",
    limit: 1,
    conditions: {
      all: [
        { battle: "dungeon_cleared", op: "==", value: true },
        { player: "level", op: "<=", value: 5 },
      ],
    },
    effect: { stat_bonus: { STR: 5, VIT: 5, AGI: 5, DEX: 5, INT: 5 } },
    rumor: "The Hollow has waited a long time for someone small and foolish enough to walk out of it.",
  }),

  // ---------- Item-attached (never unlocked by the rule engine) ----------
  def({
    id: "thorn_retort",
    name: "Thorn Retort",
    description: "Reflects part of the damage you take back at the attacker. Grows with the Thornheart Mantle.",
    kind: "passive",
    hidden: false,
    conditions: { any: [] }, // always false: granted only by the Thornheart Mantle
    effect: { passive: { reflect_pct: 0.2 } },
    rumor: null,
  }),
];
