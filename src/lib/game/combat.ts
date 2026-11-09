import { WEAPONS } from "./constants";
import type { Derived } from "./character";
import type { BattleSummary } from "./rules";
import { ITEMS, MONSTERS, type EnemyAttack, type MonsterDef } from "./data/world";
import type {
  CounterDeltas,
  InventoryItem,
  SkillDefinition,
  StatKey,
  StatusEffect,
  StatusType,
  WeaponType,
} from "./types";

export type Rng = () => number;

type CombatStats = Record<Exclude<StatKey, "HP" | "MP">, number>;

export interface Fighter {
  name: string;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  stats: CombatStats;
  statuses: StatusEffect[];
}

export interface DungeonRun {
  dungeonId: string;
  room: number; // 0-based index into zone.rooms
  totalRooms: number;
  firstAttempt: boolean;
  directDamage: number;
}

export interface BattleState {
  id: string;
  playerId: string;
  zoneId: string;
  kind: "field" | "dungeon";
  hazard: { id: string; name: string; damage: number; status?: { type: StatusType; chance: number; turns: number } } | null;
  turn: number;
  weapon: WeaponType;
  player: Fighter;
  enemy: Fighter & { monsterId: string; isBoss: boolean; type: string; hitsTaken: number };
  log: string[];
  over: boolean;
  result: "win" | "loss" | "fled" | null;
  deltas: CounterDeltas;
  skillUses: Record<string, number>;
  tally: {
    attacksMade: number;
    directDamage: number;
    damageTaken: number;
    minHpPct: number;
    dodgeStreak: number;
  };
  flags: { invisible: number; provoked: boolean; reviveUsed: boolean; defending: boolean };
  rewards: { exp: number; gold: number; drops: string[] } | null;
  run: DungeonRun | null;
}

export type BattleAction =
  | { type: "attack" }
  | { type: "skill"; skillId: string }
  | { type: "defend" }
  | { type: "wait" }
  | { type: "flee" }
  | { type: "eat"; itemId: string };

// ---------- Counter helpers ----------

export function inc(deltas: CounterDeltas, key: string, n = 1) {
  if (n === 0) return;
  const cur = deltas[key];
  if (!cur) deltas[key] = { op: "inc", value: n };
  else if (cur.op === "inc" || cur.op === "set") cur.value += n;
  else deltas[key] = { op: "inc", value: n }; // max then inc: unusual, inc wins
}
export function setCounter(deltas: CounterDeltas, key: string, value: number) {
  deltas[key] = { op: "set", value };
}
export function maxCounter(deltas: CounterDeltas, key: string, value: number) {
  const cur = deltas[key];
  if (!cur || cur.op === "max") deltas[key] = { op: "max", value: Math.max(cur?.value ?? 0, value) };
}

// ---------- Setup ----------

export function startBattle(opts: {
  id: string;
  playerId: string;
  playerName: string;
  zoneId: string;
  kind: "field" | "dungeon";
  monster: MonsterDef;
  derived: Derived;
  currentHp: number;
  currentMp: number;
  weapon: WeaponType;
  dodgeStreak: number;
  hazard: BattleState["hazard"];
  run: DungeonRun | null;
}): BattleState {
  const { derived: d, monster: m } = opts;
  const state: BattleState = {
    id: opts.id,
    playerId: opts.playerId,
    zoneId: opts.zoneId,
    kind: opts.kind,
    hazard: opts.hazard && !d.passive.hazard_immunity.includes(opts.hazard.id) ? opts.hazard : null,
    turn: 1,
    weapon: opts.weapon,
    player: {
      name: opts.playerName,
      hp: Math.min(opts.currentHp, d.maxHp),
      maxHp: d.maxHp,
      mp: Math.min(opts.currentMp, d.maxMp),
      maxMp: d.maxMp,
      stats: { STR: d.stats.STR, VIT: d.stats.VIT, AGI: d.stats.AGI, DEX: d.stats.DEX, INT: d.stats.INT },
      statuses: [],
    },
    enemy: {
      name: m.name,
      hp: m.stats.HP,
      maxHp: m.stats.HP,
      mp: 0,
      maxMp: 0,
      stats: { STR: m.stats.STR, VIT: m.stats.VIT, AGI: m.stats.AGI, DEX: m.stats.DEX, INT: m.stats.INT },
      statuses: [],
      monsterId: m.id,
      isBoss: !!m.isBoss,
      type: m.type,
      hitsTaken: 0,
    },
    log: [],
    over: false,
    result: null,
    deltas: {},
    skillUses: {},
    tally: { attacksMade: 0, directDamage: 0, damageTaken: 0, minHpPct: 1, dodgeStreak: opts.dodgeStreak },
    flags: { invisible: 0, provoked: false, reviveUsed: false, defending: false },
    rewards: null,
    run: opts.run,
  };
  state.tally.minHpPct = state.player.hp / state.player.maxHp;
  state.log.push(`${m.isBoss ? "A boss appears" : "A wild enemy appears"}: ${m.name}!`);
  if (opts.hazard && !state.hazard) state.log.push(`The ${opts.hazard.name.toLowerCase()} can't hurt you anymore.`);
  else if (state.hazard) state.log.push(`You're fighting in the ${state.hazard.name.toLowerCase()}. It will hurt every round.`);
  return state;
}

// ---------- Core math (the design doc's formula) ----------

const has = (f: Fighter, t: StatusType) => f.statuses.some((s) => s.type === t);
const effAgi = (f: Fighter) => (has(f, "slow") ? Math.floor(f.stats.AGI / 2) : f.stats.AGI);

export function hitChance(attackerDex: number, defenderAgi: number, bonus = 0) {
  return Math.min(0.98, Math.max(0.05, 0.9 + (attackerDex - defenderAgi) * 0.01 + bonus));
}
export function critChance(dex: number, bonus = 0) {
  return Math.min(0.6, 0.05 + dex * 0.004 + bonus);
}
/** Damage = max(0, ATK x SkillMultiplier - DEF) + PiercingDamage */
export function damageFormula(atk: number, multiplier: number, def: number, piercing = 0) {
  return Math.max(0, Math.round(atk * multiplier - def)) + Math.round(piercing);
}

interface AttackSpec {
  name: string;
  element: "physical" | "magic";
  multiplier: number;
  scaleStat?: StatKey;
  piercing?: number;
  area?: boolean;
  critBonus?: number;
  hitBonus?: number;
  weaponAttack?: number;
  status?: { type: StatusType; chance: number; turns: number };
}

// ---------- Turn resolution ----------

export function resolveTurn(
  s: BattleState,
  action: BattleAction,
  ctx: { derived: Derived; defs: Map<string, SkillDefinition>; inventory: InventoryItem[]; rng: Rng },
): { state: BattleState; consumed: string[] } {
  if (s.over) throw new Error("This battle is over");
  const state: BattleState = structuredClone(s);
  const consumed: string[] = [];
  const { derived: d, rng } = ctx;
  const P = state.player;
  const E = state.enemy;
  const log = (m: string) => state.log.push(m);
  const deltas = state.deltas;
  state.flags.defending = false;
  log(`— Turn ${state.turn} —`);

  // Validate the chosen action before anything happens.
  let skill: SkillDefinition | undefined;
  if (action.type === "skill") {
    skill = d.activeSkills.find((k) => k.id === action.skillId);
    if (!skill?.effect.active) throw new Error("That skill isn't equipped");
    const a = skill.effect.active;
    if (has(P, "silence")) throw new Error("You're silenced and can't use skills");
    if ((a.mp_cost ?? 0) > P.mp) throw new Error("Not enough MP");
    if (skill.usesPerBattle && (state.skillUses[skill.id] ?? 0) >= skill.usesPerBattle) throw new Error("No uses left this battle");
  }
  if (action.type === "eat") {
    const inv = ctx.inventory.find((i) => i.itemId === action.itemId);
    if (!inv || inv.qty < 1 || !ITEMS[action.itemId]) throw new Error("You don't have that item");
  }

  const playerFirst = effAgi(P) >= effAgi(E);
  const order: ("player" | "enemy")[] = playerFirst ? ["player", "enemy"] : ["enemy", "player"];

  for (const who of order) {
    if (state.over) break;
    if (who === "player") playerAct();
    else enemyAct();
  }
  if (!state.over) endOfRound();
  state.turn++;
  return { state, consumed };

  // ----- helpers (closures over state) -----

  function skipTurn(f: Fighter): boolean {
    for (const t of ["stun", "freeze"] as const) {
      if (has(f, t)) {
        log(`${f.name} is ${t === "stun" ? "stunned" : "frozen"} and can't move!`);
        return true;
      }
    }
    if (has(f, "paralysis") && rng() < 0.5) {
      log(`${f.name} is paralyzed and can't move!`);
      return true;
    }
    return false;
  }

  function applyStatus(target: Fighter, spec: { type: StatusType; chance: number; turns: number }, isPlayer: boolean) {
    if (rng() >= spec.chance) return;
    if (isPlayer) {
      if (d.immunities.has(spec.type)) {
        log(`You're immune to ${spec.type}.`);
        return;
      }
      if (rng() < (d.statusResist[spec.type] ?? 0)) {
        log(`You resist the ${spec.type}.`);
        return;
      }
      inc(deltas, "statuses_received");
      const key = { poison: "times_poisoned", burn: "times_burned", paralysis: "times_paralyzed" }[spec.type as string];
      if (key) inc(deltas, key);
      if (spec.type === "poison") inc(deltas, "poisoned_since_death");
    }
    const existing = target.statuses.find((x) => x.type === spec.type);
    if (existing) existing.turns = Math.max(existing.turns, spec.turns);
    else target.statuses.push({ type: spec.type, turns: spec.turns });
    log(`${target.name} is afflicted with ${spec.type}!`);
  }

  function damagePlayer(amount: number, source: string, opts: { direct?: boolean } = {}) {
    if (amount <= 0) return;
    P.hp -= amount;
    state.tally.damageTaken += amount;
    inc(deltas, "damage_taken", amount);
    if (source === "hazard") inc(deltas, "hazard_damage_taken", amount);
    if (P.hp <= 0 && d.passive.revive_once && !state.flags.reviveUsed) {
      P.hp = 1;
      state.flags.reviveUsed = true;
      log("You refuse to fall! (Stubborn)");
    }
    state.tally.minHpPct = Math.min(state.tally.minHpPct, Math.max(0, P.hp) / P.maxHp);
    if (opts.direct && d.passive.reflect_pct > 0) {
      const back = Math.max(1, Math.round(amount * d.passive.reflect_pct));
      damageEnemy(back, false);
      log(`Thorns reflect ${back} damage back.`);
    }
    if (P.hp <= 0) finish("loss");
  }

  function damageEnemy(amount: number, direct: boolean) {
    if (amount <= 0 || state.over) return;
    E.hp -= amount;
    if (direct) {
      E.hitsTaken++;
      state.tally.directDamage += amount;
      if (state.run) state.run.directDamage += amount;
    }
    if (E.hp <= 0) finish("win");
  }

  function playerAttack(spec: AttackSpec) {
    state.flags.provoked = true;
    state.tally.attacksMade++;
    inc(deltas, "attacks_made");
    if (!spec.area && rng() >= hitChance(P.stats.DEX, effAgi(E), spec.hitBonus)) {
      log(`${spec.name} misses!`);
      return;
    }
    const atkStat = spec.scaleStat ?? (spec.element === "magic" ? "INT" : "STR");
    let atk = (P.stats[atkStat as keyof CombatStats] ?? 0) + (spec.weaponAttack ?? 0);
    atk *= d.passive.damage_multiplier;
    const low = d.passive.low_hp_damage;
    if (low && P.hp / P.maxHp < low.threshold) atk *= low.multiplier;
    const crit = rng() < critChance(P.stats.DEX, spec.critBonus);
    if (crit) inc(deltas, "crits_landed");
    const mult = spec.multiplier * (crit ? 1.5 : 1);
    const def = spec.element === "magic" ? E.stats.INT : E.stats.VIT;
    const dmg = damageFormula(atk, mult, def, spec.piercing);
    inc(deltas, spec.element === "magic" ? "magic_damage_dealt" : "physical_damage_dealt", dmg);
    log(`${spec.name}${crit ? " (critical!)" : ""} deals ${dmg} damage to ${E.name}.`);
    if (dmg > 0) damageEnemy(dmg, true);
    if (!state.over && spec.status) applyStatus(E, spec.status, false);
  }

  function playerAct() {
    if (skipTurn(P)) {
      inc(deltas, "turns_without_attacking");
      return;
    }
    const w = WEAPONS[state.weapon];
    switch (action.type) {
      case "attack": {
        const unarmedStat = state.weapon === "unarmed" ? d.passive.unarmed_stat : undefined;
        playerAttack({
          name: state.weapon === "unarmed" ? "Punch" : `${w.name} attack`,
          element: w.element,
          multiplier: 1,
          scaleStat: unarmedStat,
          weaponAttack: w.attack,
          critBonus: w.critBonus,
          hitBonus: w.hitBonus,
        });
        break;
      }
      case "skill": {
        const a = skill!.effect.active!;
        P.mp -= a.mp_cost ?? 0;
        if (a.hp_cost_pct) P.hp = Math.max(1, P.hp - Math.round(P.maxHp * a.hp_cost_pct));
        state.skillUses[skill!.id] = (state.skillUses[skill!.id] ?? 0) + 1;
        inc(deltas, "skills_used");
        inc(deltas, `skill_used_${skill!.id}`);
        log(`You use ${skill!.name}!`);
        if (a.heal_pct) {
          const heal = Math.min(P.maxHp - P.hp, Math.round(P.maxHp * a.heal_pct));
          P.hp += heal;
          inc(deltas, "hp_healed", heal);
          log(`You recover ${heal} HP.`);
        }
        if (a.cleanse) P.statuses = [];
        if (a.multiplier) {
          const piercing = (a.piercing_flat ?? 0) + (a.piercing_stat ? P.stats[a.piercing_stat as keyof CombatStats] ?? 0 : 0);
          for (let i = 0; i < (a.hits ?? 1) && !state.over; i++) {
            playerAttack({
              name: skill!.name,
              element: a.element ?? w.element,
              multiplier: a.multiplier,
              scaleStat: a.scale_stat,
              piercing,
              area: a.area,
              critBonus: (a.crit_bonus ?? 0) + (w.critBonus ?? 0),
              hitBonus: w.hitBonus,
              weaponAttack: w.attack,
              status: a.status,
            });
          }
        } else {
          inc(deltas, "turns_without_attacking");
        }
        break;
      }
      case "defend":
        state.flags.defending = true;
        inc(deltas, "defend_used");
        inc(deltas, "turns_without_attacking");
        log("You brace yourself.");
        break;
      case "wait":
        inc(deltas, "turns_without_attacking");
        log("You wait and watch.");
        break;
      case "eat": {
        const item = ITEMS[action.itemId];
        consumed.push(item.id);
        inc(deltas, "turns_without_attacking");
        eatItem(item.id);
        break;
      }
      case "flee": {
        inc(deltas, "turns_without_attacking");
        const chance = d.passive.flee_always ? 1 : E.isBoss ? 0.25 : Math.min(0.95, 0.5 + (effAgi(P) - effAgi(E)) * 0.02);
        if (rng() < chance) {
          log("You got away!");
          finish("fled");
        } else log("You couldn't escape!");
        break;
      }
    }
  }

  function eatItem(itemId: string) {
    const item = ITEMS[itemId];
    inc(deltas, "items_eaten");
    log(`You eat the ${item.name}.`);
    if (item.edible) {
      const heal = Math.min(P.maxHp - P.hp, item.heal ?? 0);
      P.hp += heal;
      inc(deltas, "hp_healed", heal);
      log(`You recover ${heal} HP.`);
    } else {
      inc(deltas, "inedible_eaten");
      inc(deltas, `ate_${item.id}`);
      log("That was not food.");
      if (item.onEat?.damage) damagePlayer(item.onEat.damage, "food");
      if (!state.over && item.onEat?.status) applyStatus(P, item.onEat.status, true);
    }
  }

  function enemyAct() {
    const m = MONSTERS[E.monsterId];
    if (skipTurn(E)) return;
    if (d.passive.pacifist && !state.flags.provoked) {
      log(`${E.name} eyes you, but doesn't attack.`);
      return;
    }
    if (state.flags.invisible > 0) {
      state.flags.invisible--;
      log(`${E.name} can't find you! (Ghost Step)`);
      return;
    }
    let pool: EnemyAttack[] = m.attacks;
    if (has(E, "silence")) pool = pool.filter((a) => a.element !== "magic" && !a.status);
    if (pool.length === 0) pool = [{ name: "Attack", weight: 1, multiplier: 1, element: "physical" }];
    const total = pool.reduce((n, a) => n + a.weight, 0);
    let roll = rng() * total;
    const atk = pool.find((a) => (roll -= a.weight) < 0) ?? pool[0];

    if (!atk.area && rng() >= hitChance(E.stats.DEX, effAgi(P))) {
      state.tally.dodgeStreak++;
      inc(deltas, "hits_dodged");
      log(`You dodge ${E.name}'s ${atk.name}!`);
      if (d.passive.dodge_invisibility) state.flags.invisible = d.passive.dodge_invisibility;
      return;
    }
    if (state.tally.dodgeStreak > 0) maxCounter(deltas, "dodge_streak_best", state.tally.dodgeStreak);
    state.tally.dodgeStreak = 0;

    const atkStat = atk.element === "magic" ? E.stats.INT : E.stats.STR;
    const w = WEAPONS[state.weapon];
    let def = atk.element === "magic" ? P.stats.INT : P.stats.VIT + (w.defenseBonus ?? 0);
    if (state.flags.defending) def *= 2;
    const raw = Math.round(atkStat * atk.multiplier);
    const dmg = damageFormula(atkStat, atk.multiplier, def, atk.piercing);
    const blocked = Math.min(raw, Math.round(def));
    inc(deltas, "damage_blocked", Math.max(0, blocked));
    if (dmg === 0) {
      inc(deltas, "zero_damage_hits");
      log(`${E.name}'s ${atk.name} bounces off you. 0 damage!`);
    } else {
      log(`${E.name}'s ${atk.name} hits you for ${dmg}.`);
      damagePlayer(dmg, "enemy", { direct: true });
    }
    if (state.over) return;
    if (atk.status) applyStatus(P, atk.status, true);
    // Venom Body: anything that touches you may be poisoned.
    if (d.passive.poison_aura && atk.element === "physical" && !atk.area) {
      applyStatus(E, { type: "poison", ...d.passive.poison_aura }, false);
    }
  }

  function endOfRound() {
    // Environmental damage ignores stats.
    if (state.hazard) {
      inc(deltas, "swamp_turns");
      log(`The ${state.hazard.name.toLowerCase()} burns your skin for ${state.hazard.damage}.`);
      damagePlayer(state.hazard.damage, "hazard");
      if (!state.over && state.hazard.status) applyStatus(P, state.hazard.status, true);
    }
    // Status ticks ignore defense: the main tool against tanks.
    for (const [f, isPlayer] of [
      [P, true],
      [E, false],
    ] as const) {
      if (state.over) return;
      for (const st of f.statuses) {
        if (state.over) break;
        let dmg = 0;
        if (st.type === "poison") dmg = Math.max(1, Math.round(f.maxHp * 0.05 * (isPlayer ? d.poisonMult : 1)));
        if (st.type === "burn") dmg = Math.max(1, Math.round(4 + f.maxHp * 0.03));
        if (dmg > 0) {
          log(`${f.name} takes ${dmg} ${st.type} damage.`);
          if (isPlayer) damagePlayer(dmg, st.type);
          else damageEnemy(dmg, false);
        }
      }
      f.statuses = f.statuses.map((x) => ({ ...x, turns: x.turns - 1 })).filter((x) => x.turns > 0);
    }
    if (!state.over && d.passive.mp_regen) P.mp = Math.min(P.maxMp, P.mp + d.passive.mp_regen);
  }

  function finish(result: "win" | "loss" | "fled") {
    if (state.over) return;
    state.over = true;
    state.result = result;
    setCounter(deltas, "dodge_streak", state.tally.dodgeStreak);
    maxCounter(deltas, "dodge_streak_best", state.tally.dodgeStreak);
    if (result === "win") {
      const m = MONSTERS[E.monsterId];
      log(`${E.name} is defeated!`);
      inc(deltas, "enemies_defeated");
      inc(deltas, `kills_${state.weapon}`);
      inc(deltas, `defeated_${m.id}`);
      if (E.isBoss) inc(deltas, "bosses_defeated");
      if (E.hitsTaken === 1) inc(deltas, "one_hit_kills");
      inc(deltas, "battles_won");
      if (P.hp / P.maxHp < 0.1) inc(deltas, "low_hp_wins");
      const drops = m.drops.filter((dr) => rng() < dr.chance).map((dr) => dr.itemId);
      state.rewards = { exp: m.exp, gold: m.gold, drops };
      log(`You gain ${m.exp} EXP and ${m.gold} gold.${drops.length ? ` Dropped: ${drops.map((i) => ITEMS[i].name).join(", ")}.` : ""}`);
      if (d.passive.heal_on_win_pct) {
        const heal = Math.min(P.maxHp - P.hp, Math.round(P.maxHp * d.passive.heal_on_win_pct));
        if (heal > 0) {
          P.hp += heal;
          inc(deltas, "hp_healed", heal);
          log(`You eat what's left of ${E.name} and recover ${heal} HP. (Glutton)`);
        }
      }
    } else if (result === "loss") {
      P.hp = 0;
      log("You have been defeated...");
      inc(deltas, "deaths");
      setCounter(deltas, "poisoned_since_death", 0);
    } else {
      inc(deltas, "battles_fled");
    }
  }
}

/** Outside battle: eat an item from the inventory (no enemy, same counters). */
export function eatOutsideBattle(
  hp: number,
  maxHp: number,
  itemId: string,
  derived: Derived,
  rng: Rng,
): { hp: number; deltas: CounterDeltas; log: string[] } {
  const item = ITEMS[itemId];
  const deltas: CounterDeltas = {};
  const log: string[] = [`You eat the ${item.name}.`];
  inc(deltas, "items_eaten");
  if (item.edible) {
    const heal = Math.min(maxHp - hp, item.heal ?? 0);
    hp += heal;
    inc(deltas, "hp_healed", heal);
    log.push(`You recover ${heal} HP.`);
  } else {
    inc(deltas, "inedible_eaten");
    inc(deltas, `ate_${item.id}`);
    log.push("That was not food.");
    const dmg = item.onEat?.damage ?? 0;
    const st = item.onEat?.status;
    let total = dmg;
    if (st && rng() < st.chance) {
      if (derived.immunities.has(st.type)) log.push(`You're immune to ${st.type}.`);
      else if (rng() < (derived.statusResist[st.type] ?? 0)) log.push(`You resist the ${st.type}.`);
      else {
        inc(deltas, "statuses_received");
        if (st.type === "poison") {
          inc(deltas, "times_poisoned");
          inc(deltas, "poisoned_since_death");
          total += Math.max(1, Math.round(maxHp * 0.05 * derived.poisonMult)) * st.turns;
        }
        log.push(`You feel the ${st.type} work through you.`);
      }
    }
    total = Math.min(total, hp - 1); // eating junk outside battle can't kill you
    if (total > 0) {
      hp -= total;
      inc(deltas, "damage_taken", total);
      log.push(`You lose ${total} HP.`);
    }
  }
  return { hp, deltas, log };
}

/** What the rule engine sees about the battle that just ended. */
export function summarize(s: BattleState, dungeonCleared: boolean): BattleSummary {
  return {
    result: s.result ?? "none",
    kind: s.kind,
    zone: s.zoneId,
    weapon: s.weapon,
    turns: s.turn - 1,
    attacks_made: s.tally.attacksMade,
    direct_damage_dealt: s.tally.directDamage,
    damage_taken: s.tally.damageTaken,
    min_hp_pct: Math.round(s.tally.minHpPct * 1000) / 1000,
    final_hp_pct: Math.round((Math.max(0, s.player.hp) / s.player.maxHp) * 1000) / 1000,
    enemy_id: s.enemy.monsterId,
    enemy_type: s.enemy.type,
    enemy_is_boss: s.enemy.isBoss,
    in_hazard: !!s.hazard,
    dungeon_cleared: dungeonCleared,
    dungeon_direct_damage: s.run ? s.run.directDamage : -1,
    dungeon_first_attempt: s.run ? s.run.firstAttempt : false,
  };
}
