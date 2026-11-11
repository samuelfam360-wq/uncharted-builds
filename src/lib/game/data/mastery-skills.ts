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
 * (one block per mastery, plus the multi-mastery skills).
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

  // ---------- Dagger mastery ----------
  def({
    id: "silent_finish",
    name: "Silent Finish",
    description:
      "A first hit on an unaware enemy deals 3x damage. If it kills, you stay hidden, and each stealth kill in a row adds +1x, up to 10x. Monsters only. Needs a dagger in hand.",
    kind: "passive",
    conditions: { counter: "one_hit_kills", op: ">=", value: 1000 },
    effect: { weapons: ["daggers"], passive: { silent_finish: { mult: 3, chain_max: 10, hide_s: 3 } } },
  }),
  def({
    id: "phantom_legion",
    name: "Phantom Legion",
    description: "Every perfect dodge leaves a shadow clone that fights for 5 seconds (up to 5 at once, each dealing 30% of your damage).",
    kind: "passive",
    conditions: { counter: "phantom_fights", op: ">=", value: 100 },
    effect: { passive: { phantom_legion: { pct: 0.3, life_s: 5, max: 5 } } },
  }),
  def({
    id: "thousand_needles",
    name: "Thousand Needles",
    description: "Dagger crits stack bleeding. At 10 stacks, a normal monster dies instantly, and a boss loses 5% of its max HP. Needs a dagger in hand.",
    kind: "passive",
    conditions: { counter: "crits_daggers", op: ">=", value: 10000 },
    effect: { weapons: ["daggers"], passive: { thousand_needles: { stacks: 10, boss_pct: 0.05, tick_pct: 0.01 } } },
  }),
  def({
    id: "shadow_walk",
    name: "Shadow Walk",
    description: "Go fully invisible for 5 seconds, and appear behind the nearest enemy you can see. 10 minute cooldown.",
    kind: "active",
    conditions: { counter: "escapes", op: ">=", value: 300 },
    effect: { active: { cooldown_s: 600, shadow_walk: { invisible_s: 5 } } },
  }),
  def({
    id: "phantom_verdict",
    name: "Phantom Verdict",
    description:
      "Ultimate, bosses only. Each boss attack you dodge charges the gauge. 50: 50% of the boss's HP (once per fight, resets the gauge). 100: a full kill. 200: a full kill + 20% EXP. Fire or keep charging at each tier.",
    kind: "active",
    conditions: { counter: "boss_fight_dodges_best", op: ">=", value: 100 },
    effect: { active: { ultimate: { gauge: "boss_dodges", tiers: [50, 100, 200] } } },
  }),

  // ---------- Hammer mastery ----------
  def({
    id: "armor_crusher",
    name: "Armor Crusher",
    description: "Each hammer hit lowers the target's defense by 2%, stacking up to 50%. Needs a hammer in hand.",
    kind: "passive",
    conditions: { counter: "hits_hammer", op: ">=", value: 5000 },
    effect: { weapons: ["hammer"], passive: { armor_crusher: { per_hit: 0.02, max: 0.5 } } },
  }),
  def({
    id: "quake_slam",
    name: "Quake Slam",
    description: "Ground Slam sends out a shockwave that knocks down everything nearby.",
    kind: "passive",
    conditions: { counter: "skill_kills_ground_slam", op: ">=", value: 500 },
    effect: { passive: { quake_slam: { stun_ms: 1000, reach: 300 } } },
  }),
  def({
    id: "ringing_blow",
    name: "Ringing Blow",
    description: "Your stuns last 1 second longer, and stunned enemies take 30% more damage.",
    kind: "passive",
    conditions: { counter: "stuns_dealt", op: ">=", value: 1000 },
    effect: { passive: { ringing_blow: { extra_ms: 1000, dmg_mult: 1.3 } } },
  }),
  def({
    id: "full_swing",
    name: "Full Swing",
    description: "Charged swings can't be interrupted and deal 3x damage.",
    kind: "passive",
    conditions: { counter: "full_swing_wins", op: ">=", value: 100 },
    effect: {},
    enabled: false, // waits for charged swings
  }),
  def({
    id: "anvil_breaker",
    name: "Anvil Breaker",
    description:
      "Ultimate, bosses only. Each hammer hit on the boss charges the gauge. 50: 50% of the boss's HP (once per fight, resets the gauge). 100: a full kill. 200: a full kill + 20% EXP. Needs a hammer in hand.",
    kind: "active",
    conditions: { counter: "boss_fight_hits_hammer_best", op: ">=", value: 200 },
    effect: { weapons: ["hammer"], active: { ultimate: { gauge: "boss_weapon_hits", tiers: [50, 100, 200] } } },
  }),

  // ---------- Fists mastery ----------
  def({
    id: "seven_strikes",
    name: "Seven Strikes",
    description: "The 7th hit of every combo deals 7x damage. Needs empty hands or a strength bracelet.",
    kind: "passive",
    conditions: { counter: "combos_7", op: ">=", value: 1000 },
    effect: { weapons: ["unarmed", "strength_bracelet"], passive: { seven_strikes: { every: 7, mult: 7, gap_ms: 1000 } } },
  }),
  def({
    id: "breath_control",
    name: "Breath Control",
    description: "Slowly regenerate HP and MP during combat.",
    kind: "passive",
    conditions: { counter: "clean_fights", op: ">=", value: 100 },
    effect: { passive: { breath_control: { hp_pct: 0.01, mp: 1 } } },
  }),
  def({
    id: "empty_vessel",
    name: "Empty Vessel",
    description: "AGI and VIT bonus while unarmored.",
    kind: "passive",
    conditions: { counter: "unarmored_wins", op: ">=", value: 500 },
    effect: {},
    enabled: false, // waits for armor
  }),
  def({
    id: "pressure_point",
    name: "Pressure Point",
    description: "Your hits can paralyze for 1 second.",
    kind: "passive",
    conditions: { counter: "weak_point_crits", op: ">=", value: 500 },
    effect: {},
    enabled: false, // waits for weak points
  }),
  def({
    id: "heavenly_palm",
    name: "Heavenly Palm",
    description:
      "Ultimate, bosses only. Each unarmed hit on the boss charges the gauge. 100: 50% of the boss's HP (once per fight, resets the gauge). 200: a full kill. 400: a full kill + 20% EXP. Needs empty hands or a strength bracelet.",
    kind: "active",
    conditions: { counter: "boss_fight_hits_fists_best", op: ">=", value: 1000 },
    effect: { weapons: ["unarmed", "strength_bracelet"], active: { ultimate: { gauge: "boss_weapon_hits", tiers: [100, 200, 400] } } },
  }),

  // ---------- Gun mastery ----------
  def({
    id: "quick_draw",
    name: "Quick Draw",
    description: "The first shot of every fight is a guaranteed crit. Needs a pistol in hand.",
    kind: "passive",
    conditions: { counter: "quick_draw_wins", op: ">=", value: 100 },
    effect: { weapons: ["pistol"], passive: { quick_draw: true } },
  }),
  def({
    id: "dead_mans_hand",
    name: "Dead Man's Hand",
    description: "Below 10% HP: +50% fire rate (unlimited ammo too, once guns use ammo). Needs a pistol in hand.",
    kind: "passive",
    conditions: { counter: "low_hp_wins", op: ">=", value: 200 },
    effect: { weapons: ["pistol"], passive: { dead_mans_hand: { below: 0.1, rate: 1.5 } } },
  }),
  def({
    id: "final_round",
    name: "Final Round",
    description: "The last bullet of every reload deals double damage and pierces.",
    kind: "passive",
    conditions: { counter: "last_bullet_kills", op: ">=", value: 300 },
    effect: {},
    enabled: false, // waits for ammo
  }),
  def({
    id: "ricochet",
    name: "Ricochet",
    description: "Bullets bounce to a second target. Evolves to a third.",
    kind: "passive",
    conditions: { counter: "ricochet_hits", op: ">=", value: 1000 },
    effect: {},
    enabled: false, // waits for bouncing shots
  }),
  def({
    id: "high_noon",
    name: "High Noon",
    description:
      "Ultimate, bosses only. Each bullet that hits the boss charges the gauge. 100: 50% of the boss's HP (once per fight, resets the gauge). 200: a full kill. 400: a full kill + 20% EXP. Needs a pistol in hand.",
    kind: "active",
    conditions: { counter: "boss_fight_gun_dmg_best", op: ">=", value: 100000 },
    effect: { weapons: ["pistol"], active: { ultimate: { gauge: "boss_weapon_hits", tiers: [100, 200, 400] } } },
  }),

  // ---------- Bow mastery ----------
  def({
    id: "hawk_line",
    name: "Hawk Line",
    description: "Range +50%, and damage grows with distance. Needs a bow in hand.",
    kind: "passive",
    conditions: { counter: "max_range_hits", op: ">=", value: 10000 },
    effect: { weapons: ["bow"], passive: { hawk_line: { range: 1.5, max_mult: 1.5 } } },
  }),
  def({
    id: "marked_prey",
    name: "Marked Prey",
    description: "The last enemy you shot is marked: your arrows never miss it, and it can't hide or turn invisible. Needs a bow in hand.",
    kind: "passive",
    conditions: { counter: "marked_runs", op: ">=", value: 50 },
    effect: { weapons: ["bow"], passive: { marked_prey: true } },
  }),
  def({
    id: "bending_shot",
    name: "Bending Shot",
    description: "Your arrows curve around walls and obstacles.",
    kind: "passive",
    conditions: { counter: "cover_hits", op: ">=", value: 500 },
    effect: {},
    enabled: false, // waits for cover
  }),
  def({
    id: "last_arrow",
    name: "Last Arrow",
    description: "When you have 1 arrow left, it splits into 10.",
    kind: "passive",
    conditions: { counter: "last_arrow_wins", op: ">=", value: 50 },
    effect: {},
    enabled: false, // waits for arrows as ammo
  }),
  def({
    id: "heavens_draw",
    name: "Heaven's Draw",
    description:
      "Ultimate, bosses only. Each weak-point hit on the boss charges the gauge. 25: 50% of the boss's HP (once per fight, resets the gauge). 50: a full kill. 100: a full kill + 20% EXP.",
    kind: "active",
    conditions: { counter: "boss_weak_point_hits", op: ">=", value: 300 },
    effect: {},
    enabled: false, // waits for boss weak points
  }),

  // ---------- Staff mastery ----------
  def({
    id: "storm_sovereign",
    name: "Storm Sovereign",
    description:
      "Change the weather of the whole zone for 3 minutes: a heat wave, a thunderstorm, a blizzard or a hurricane, by element. It hits everyone in the zone, friend and foe.",
    kind: "active",
    conditions: { counter: "element_spells_outdoors", op: ">=", value: 10000 },
    effect: {},
    enabled: false, // waits for elements and weather
  }),
  def({
    id: "spell_thief",
    name: "Spell Thief",
    description: "When an enemy spell hits you, you absorb it and cast it back at double power. Once per enemy per fight.",
    kind: "passive",
    conditions: { counter: "spells_survived", op: ">=", value: 1000 },
    effect: { passive: { spell_thief: { mult: 2 } } },
  }),
  def({
    id: "chain_catastrophe",
    name: "Chain Catastrophe",
    description: "Every enemy your spell kills explodes into the same spell, so one spell can chain across the battlefield. Needs a staff in hand.",
    kind: "passive",
    conditions: { counter: "spell_multikills_10", op: ">=", value: 100 },
    effect: { weapons: ["staff"], passive: { chain_catastrophe: { radius: 150 } } },
  }),
  def({
    id: "blood_sorcery",
    name: "Blood Sorcery",
    description: "At 0 MP, your attack spells cost HP instead (1% of max HP per MP) and hit at double power. Needs a staff in hand.",
    kind: "passive",
    conditions: { counter: "zero_mp_kills", op: ">=", value: 100 },
    effect: { weapons: ["staff"], passive: { blood_sorcery: { hp_per_mp: 0.01, mult: 2 } } },
  }),
  def({
    id: "star_fall",
    name: "Star Fall",
    description:
      "Ultimate, bosses only. MP you spend in the boss fight charges the gauge. 500: a meteor for 50% of the boss's HP (once per fight, resets the gauge). 1,000: a meteor that ends the boss. 2,000: a meteor shower that ends the boss and wipes the field, + 20% EXP.",
    kind: "active",
    conditions: { counter: "boss_fight_mp_spent_best", op: ">=", value: 5000 },
    effect: { active: { ultimate: { gauge: "boss_mp_spent", tiers: [500, 1000, 2000], field: true } } },
  }),

  // ---------- Holy mastery ----------
  def({
    id: "grace_rebound",
    name: "Grace Rebound",
    description: "Your first heal below 10% HP in each fight is tripled.",
    kind: "passive",
    conditions: { counter: "low_hp_heals", op: ">=", value: 500 },
    effect: { passive: { grace_rebound: { below: 0.1, mult: 3 } } },
  }),
  def({
    id: "divine_blessing",
    name: "Divine Blessing",
    description: "You and your party get +10% to all stats for 60 seconds. 5 minute cooldown. After 20,000 buffs it grows to +20%.",
    kind: "active",
    conditions: { counter: "buffs_cast", op: ">=", value: 5000 },
    effect: {},
    enabled: false, // waits for buffs and parties
  }),
  def({
    id: "soul_drain",
    name: "Soul Drain",
    description: "Every hit drains 25% of its damage as HP. HP beyond your max becomes a shield. Needs a healing bracelet in hand.",
    kind: "passive",
    conditions: { counter: "hits_healing_bracelet", op: ">=", value: 10000 },
    effect: { weapons: ["healing_bracelet"], passive: { soul_drain: { pct: 0.25, max_shield: 1 } } },
  }),
  def({
    id: "purify",
    name: "Purify",
    description: "When you cleanse a status, it bounces back to whoever caused it.",
    kind: "passive",
    conditions: { counter: "statuses_cleansed", op: ">=", value: 2000 },
    effect: {},
    enabled: false, // waits for a way to cleanse statuses
  }),
  def({
    id: "judgment_of_mercy",
    name: "Judgment of Mercy",
    description:
      "Ultimate, bosses only. HP you heal or drain in the boss fight charges the gauge. 10,000: a holy burst for 50% of the boss's HP (once per fight, resets the gauge). 20,000: a full kill. 40,000: a full kill + 20% EXP.",
    kind: "active",
    conditions: { counter: "boss_fight_healed_best", op: ">=", value: 50000 },
    effect: { active: { ultimate: { gauge: "boss_healed", tiers: [10000, 20000, 40000] } } },
  }),
  def({
    id: "curse_ward",
    name: "Curse Ward",
    description: "Curses on you last half as long. Needs a healing bracelet in hand.",
    kind: "passive",
    conditions: { counter: "curses_received", op: ">=", value: 500 },
    effect: {},
    enabled: false, // waits for the Curse status
  }),
  def({
    id: "hallowed_soul",
    name: "Hallowed Soul",
    description: "Immune to Curse while Divine Blessing is active. Needs a healing bracelet in hand.",
    kind: "passive",
    conditions: { counter: "curses_received", op: ">=", value: 2000 },
    effect: {},
    enabled: false, // waits for the Curse status and Divine Blessing
  }),

  // ---------- Lance mastery ----------
  def({
    id: "comet_charge",
    name: "Comet Charge",
    description: "Charge damage grows with the distance you run, up to double at a full run. Needs a lance in hand.",
    kind: "passive",
    conditions: { counter: "max_charge_kills", op: ">=", value: 1000 },
    effect: { weapons: ["lance"], passive: { comet_charge: { max_mult: 2 } } },
  }),
  def({
    id: "skewer",
    name: "Skewer",
    description: "Thrusts pierce through every enemy in a line.",
    kind: "passive",
    conditions: { counter: "multi_thrusts", op: ">=", value: 500 },
    effect: {},
    enabled: false, // waits for thrusts that can hit more than one enemy
  }),
  def({
    id: "iron_momentum",
    name: "Iron Momentum",
    description: "While charging, you can't be stunned or knocked back. Needs a lance in hand.",
    kind: "passive",
    conditions: { counter: "charges_done", op: ">=", value: 1000 },
    effect: { weapons: ["lance"], passive: { iron_momentum: true } },
  }),
  def({
    id: "sky_lance",
    name: "Sky Lance",
    description: "Attack in the air to dive down and crash, hitting every enemy where you land. Needs a lance in hand.",
    kind: "passive",
    conditions: { counter: "jump_kills", op: ">=", value: 100 },
    effect: { weapons: ["lance"], passive: { sky_lance: { reach: 150 } } },
  }),
  def({
    id: "dragonpiercer",
    name: "Dragonpiercer",
    description:
      "Ultimate, bosses only. Each charge that hits the boss charges the gauge. 15: 50% of the boss's HP (once per fight, resets the gauge). 30: a full kill. 60: a full kill + 20% EXP. Needs a lance in hand.",
    kind: "active",
    conditions: { counter: "boss_fight_charge_hits_best", op: ">=", value: 100 },
    effect: { weapons: ["lance"], active: { ultimate: { gauge: "boss_charges", tiers: [15, 30, 60] } } },
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
