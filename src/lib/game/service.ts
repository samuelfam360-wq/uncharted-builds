// Orchestrates a player action end to end: load state, resolve on the server,
// flush counters, run the skill rule engine, persist. Nothing here trusts the client.

import { randomUUID } from "node:crypto";
import { WEAPON_PRICE, WEAPONS, expToNext } from "./constants";
import {
  GameError,
  allocatePoints,
  canEquip,
  derive,
  grantExp,
  newCharacter,
  slotUsage,
  worksWith,
  type CreateCharacterInput,
} from "./character";
import { eatOutsideBattle, maxCounter, resolveTurn, startBattle, summarize, type BattleAction, type BattleState, type Rng } from "./combat";
import { CLASSES, describeAppearance } from "./data/classes";
import { ITEMS, MONSTERS, ZONES } from "./data/world";
import { findUnlocks, type BattleSummary } from "./rules";
import { MAX_HITS_PER_SEC, PARRY_COUNTER_MULT, TICK_MS, ULT_EXP_BONUS, attackSpec, maxHit, streakMult, withDuelist, type AttackSpec, type LiveReport } from "./live";
import { MASTERIES, MASTERY_XP, WEAPON_MASTERY, masteryKey, masteryLevel, masteryRate, masteryViews } from "./masteries";
import { revealHints } from "./reveal";
import { WEAPON_TYPES, type ActiveEffect, type CounterDeltas, type Player, type PlayerSkill, type SkillDefinition, type Stats, type UniqueItem, type WeaponType } from "./types";
import type { GameStore } from "../store/types";

export interface UnlockNotice {
  id: string;
  name: string;
  description: string;
  kind: "active" | "passive";
  locks: string[];
  excludes: string[];
  needsConfirmation: boolean;
  evolvedFrom: string | null;
}

interface Loaded {
  player: Player;
  defs: Map<string, SkillDefinition>;
  skills: PlayerSkill[];
  unique: UniqueItem | null;
}

async function load(store: GameStore, playerId: string): Promise<Loaded> {
  const player = await store.getPlayer(playerId);
  if (!player) throw new GameError("Character not found", 404);
  const [defList, skills, uniques] = await Promise.all([
    store.listSkillDefs(),
    store.getPlayerSkills(playerId),
    store.getUniqueItems(),
  ]);
  return {
    player,
    defs: new Map(defList.map((d) => [d.id, d])),
    skills,
    unique: uniques.find((u) => u.ownerId === playerId) ?? null,
  };
}

// ---------- Character creation ----------

export async function createCharacter(store: GameStore, input: CreateCharacterInput) {
  const p = newCharacter(input, randomUUID());
  await store.createPlayer(p);
  return p;
}

// ---------- Rule engine run ----------

/**
 * Compare the player's counters, stats and state against every skill they
 * don't have yet, and grant or offer the ones whose conditions are now met.
 */
export async function checkUnlocks(
  store: GameStore,
  playerId: string,
  opts: { battle?: BattleSummary | null; zone?: string | null } = {},
): Promise<UnlockNotice[]> {
  const notices: UnlockNotice[] = [];
  // Loop so a chain (prerequisite unlocked this batch) can resolve in one go.
  for (let pass = 0; pass < 3; pass++) {
    const { player, defs, skills } = await load(store, playerId);
    const counters = await store.getCounters(playerId);
    const candidates = findUnlocks([...defs.values()], skills, {
      counters,
      stats: player.stats,
      level: player.level,
      ownedSkills: new Set(skills.filter((s) => s.status === "owned").map((s) => s.skillId)),
      zone: opts.zone ?? null,
      battle: opts.battle ?? null,
    });
    if (candidates.length === 0) break;
    let working = skills;
    for (const { skill, needsConfirmation } of candidates) {
      const prev = skill.evolvesFrom ? working.find((s) => s.skillId === skill.evolvesFrom) : undefined;
      const equipped = !needsConfirmation && (prev?.equipped || canEquip(player, working, defs, skill.id));
      const ok = await store.grantSkill(playerId, skill.id, {
        status: needsConfirmation ? "offered" : "owned",
        equipped,
        stage: (prev?.stage ?? 0) + 1,
        evolvesFrom: skill.evolvesFrom,
      });
      if (!ok) continue; // server-first skill already taken
      working = await store.getPlayerSkills(playerId);
      notices.push({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        kind: skill.kind,
        locks: skill.locks,
        excludes: skill.excludes.map((id) => defs.get(id)?.name ?? id),
        needsConfirmation,
        evolvedFrom: prev ? defs.get(prev.skillId)?.name ?? null : null,
      });
    }
  }
  return notices;
}

// ---------- Player-facing state ----------

export async function getState(store: GameStore, playerId: string) {
  const { player, defs, skills, unique } = await load(store, playerId);
  const d = derive(player, skills, defs, unique);
  const [inventory, battle, counters] = await Promise.all([store.getInventory(playerId), store.getActiveBattle(playerId), store.getCounters(playerId)]);
  return {
    player,
    className: CLASSES[player.classId]?.name ?? "Free Class",
    look: describeAppearance(player.appearance),
    derived: { stats: d.stats, maxHp: d.maxHp, maxMp: d.maxMp, immunities: [...d.immunities] },
    expToNext: expToNext(player.level),
    slots: slotUsage(player, skills, defs),
    masteries: masteryViews(player.classId, counters),
    hints: revealHints(defs.values(), skills, {
      counters,
      stats: player.stats,
      level: player.level,
      ownedSkills: new Set(skills.filter((s) => s.status === "owned").map((s) => s.skillId)),
      zone: null,
      battle: null,
    }),
    // Players see names and effects, never the conditions that unlocked them.
    skills: skills
      .filter((s) => s.status !== "declined" && !s.evolvedInto)
      .map((s) => {
        const def = defs.get(s.skillId);
        return {
          id: s.skillId,
          name: def?.name ?? s.skillId,
          description: def?.description ?? "",
          kind: def?.kind ?? "passive",
          locks: def?.locks ?? [],
          excludes: (def?.excludes ?? []).map((id) => defs.get(id)?.name ?? id),
          status: s.status,
          equipped: s.equipped,
          stage: s.stage,
          usesPerBattle: def?.usesPerBattle ?? null,
          mpCost: def?.effect.active?.mp_cost ?? 0,
          ultimate: !!def?.effect.active?.ultimate,
          needsWeapon: def && !worksWith(def, player.weapon) ? (def.effect.weapons ?? []).map((w) => WEAPONS[w].name) : null,
        };
      }),
    inventory: inventory.map((i) => ({ ...i, name: ITEMS[i.itemId]?.name ?? i.itemId, description: ITEMS[i.itemId]?.description ?? "", edible: ITEMS[i.itemId]?.edible ?? false })),
    uniqueItem: unique,
    battle: battle ? publicBattle(battle) : null,
    zones: Object.values(ZONES).map((z) => ({ id: z.id, name: z.name, kind: z.kind, description: z.description })),
    weapons: Object.values(WEAPONS).map((w) => ({ ...w, owned: player.ownedWeapons.includes(w.type) })),
    weaponPrice: WEAPON_PRICE,
    // What the live fights in the browser need to use the same math as the server.
    combat: {
      stats: d.stats,
      passive: d.passive,
      statusResist: d.statusResist,
      poisonMult: d.poisonMult,
      immunities: [...d.immunities],
      skills: d.activeSkills.map((s) => ({ id: s.id, name: s.name, active: s.effect.active ?? {}, usesPerBattle: s.usesPerBattle })),
      dodgeStreak: counters.dodge_streak ?? 0,
      dodgeStreakBest: counters.dodge_streak_best ?? 0,
    },
  };
}

/** Strip server-only bookkeeping from the battle before sending it to the browser. */
export function publicBattle(b: BattleState) {
  return {
    id: b.id,
    zoneId: b.zoneId,
    kind: b.kind,
    turn: b.turn,
    hazard: b.hazard ? b.hazard.name : null,
    player: { hp: b.player.hp, maxHp: b.player.maxHp, mp: b.player.mp, maxMp: b.player.maxMp, statuses: b.player.statuses },
    enemy: { name: b.enemy.name, hp: Math.max(0, b.enemy.hp), maxHp: b.enemy.maxHp, statuses: b.enemy.statuses, isBoss: b.enemy.isBoss },
    log: b.log.slice(-40),
    logStart: Math.max(0, b.log.length - 40), // index of log[0] in the full battle log
    over: b.over,
    result: b.result,
    rewards: b.rewards,
    skillUses: b.skillUses,
    run: b.run ? { room: b.run.room + 1, totalRooms: b.run.totalRooms } : null,
  };
}

// ---------- Stats ----------

export async function spendPoints(store: GameStore, playerId: string, add: Partial<Stats>) {
  if (await store.getActiveBattle(playerId)) throw new GameError("Finish your battle first");
  const { player, skills, defs, unique } = await load(store, playerId);
  const before = derive(player, skills, defs, unique);
  const next = allocatePoints(player, add);
  const after = derive(next, skills, defs, unique);
  next.currentHp = Math.min(after.maxHp, player.currentHp + Math.max(0, after.maxHp - before.maxHp));
  next.currentMp = Math.min(after.maxMp, player.currentMp + Math.max(0, after.maxMp - before.maxMp));
  await store.savePlayer(next);
  return { unlocks: await checkUnlocks(store, playerId) };
}

// ---------- Skills ----------

export async function respondToOffer(store: GameStore, playerId: string, skillId: string, accept: boolean) {
  const { player, skills, defs } = await load(store, playerId);
  const row = skills.find((s) => s.skillId === skillId);
  const def = defs.get(skillId);
  if (!row || row.status !== "offered" || !def) throw new GameError("No pending offer for that skill");
  if (!accept) {
    await store.updatePlayerSkill(playerId, skillId, { status: "declined", equipped: false });
    return { accepted: false };
  }
  // Locked stats with points already in them keep those points, but can't grow.
  player.lockedStats = [...new Set([...player.lockedStats, ...def.locks])];
  await store.savePlayer(player);
  await store.updatePlayerSkill(playerId, skillId, { status: "owned", equipped: canEquip(player, skills, defs, skillId) });
  // Taking one closes the path to the other forever.
  for (const other of skills) {
    const od = defs.get(other.skillId);
    if (other.status === "offered" && (def.excludes.includes(other.skillId) || od?.excludes.includes(skillId))) {
      await store.updatePlayerSkill(playerId, other.skillId, { status: "declined", equipped: false });
    }
  }
  return { accepted: true };
}

export async function setEquipped(store: GameStore, playerId: string, skillId: string, equipped: boolean) {
  if (await store.getActiveBattle(playerId)) throw new GameError("You can't change skills mid-battle");
  const { player, skills, defs } = await load(store, playerId);
  const row = skills.find((s) => s.skillId === skillId && s.status === "owned" && !s.evolvedInto);
  if (!row) throw new GameError("You don't own that skill");
  if (equipped && !row.equipped && !canEquip(player, skills, defs, skillId)) throw new GameError("No free slot. Unequip something first.");
  await store.updatePlayerSkill(playerId, skillId, { equipped });
}

// ---------- Town ----------

export async function rest(store: GameStore, playerId: string) {
  if (await store.getActiveBattle(playerId)) throw new GameError("You're in a battle");
  const { player, skills, defs, unique } = await load(store, playerId);
  const d = derive(player, skills, defs, unique);
  player.currentHp = d.maxHp;
  player.currentMp = d.maxMp;
  await store.savePlayer(player);
}

export async function weaponAction(store: GameStore, playerId: string, weapon: WeaponType) {
  if (await store.getActiveBattle(playerId)) throw new GameError("You're in a battle");
  const player = await store.getPlayer(playerId);
  if (!player) throw new GameError("Character not found", 404);
  if (!WEAPON_TYPES.includes(weapon)) throw new GameError("Unknown weapon");
  if (!player.ownedWeapons.includes(weapon)) {
    if (player.gold < WEAPON_PRICE) throw new GameError(`You need ${WEAPON_PRICE} gold`);
    player.gold -= WEAPON_PRICE;
    player.ownedWeapons.push(weapon);
  }
  player.weapon = weapon;
  await store.savePlayer(player);
}

export async function rumors(store: GameStore, playerId: string, rng: Rng = Math.random) {
  const [defs, skills] = await Promise.all([store.listSkillDefs(), store.getPlayerSkills(playerId)]);
  const known = new Set(skills.map((s) => s.skillId));
  const pool = defs.filter((d) => d.enabled && d.rumor && !known.has(d.id));
  const out: string[] = [];
  while (pool.length && out.length < 3) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0].rumor!);
  return out;
}

export async function eat(store: GameStore, playerId: string, itemId: string, rng: Rng = Math.random) {
  if (await store.getActiveBattle(playerId)) throw new GameError("Use the Eat action in battle");
  const inv = await store.getInventory(playerId);
  if (!ITEMS[itemId] || !inv.some((i) => i.itemId === itemId && i.qty > 0)) throw new GameError("You don't have that item");
  const { player, skills, defs, unique } = await load(store, playerId);
  const d = derive(player, skills, defs, unique);
  const r = eatOutsideBattle(player.currentHp, d.maxHp, itemId, d, rng);
  player.currentHp = r.hp;
  await store.changeItem(playerId, itemId, -1);
  await store.savePlayer(player);
  await store.applyCounters(playerId, r.deltas);
  return { log: r.log, unlocks: await checkUnlocks(store, playerId) };
}

// ---------- Battles ----------

/**
 * Where on the field map the fight starts. "swamp" always fights in the poison
 * swamp, "grass" never does; leaving it out keeps the old random roll.
 */
export type Terrain = "grass" | "swamp";

export async function beginBattle(store: GameStore, playerId: string, zoneId: string, rng: Rng = Math.random, terrain?: Terrain) {
  if (await store.getActiveBattle(playerId)) throw new GameError("You're already in a battle");
  const zone = ZONES[zoneId];
  if (!zone || zone.kind === "town") throw new GameError("There's nothing to fight there");
  const { player, skills, defs, unique } = await load(store, playerId);
  if (player.currentHp <= 0) throw new GameError("Rest in town first");
  const d = derive(player, skills, defs, unique);
  const counters = await store.getCounters(playerId);

  let monsterId: string;
  let run: BattleState["run"] = null;
  let hazard: BattleState["hazard"] = null;
  if (zone.kind === "dungeon") {
    const attempts = player.dungeonAttempts[zone.id] ?? 0;
    player.dungeonAttempts = { ...player.dungeonAttempts, [zone.id]: attempts + 1 };
    await store.savePlayer(player);
    run = { dungeonId: zone.id, room: 0, totalRooms: zone.rooms!.length, firstAttempt: attempts === 0, directDamage: 0 };
    monsterId = zone.rooms![0];
  } else {
    const enc = zone.encounters!;
    let roll = rng() * enc.reduce((n, e) => n + e.weight, 0);
    monsterId = (enc.find((e) => (roll -= e.weight) < 0) ?? enc[0]).monsterId;
    if (zone.hazard) {
      if (terrain === "swamp") hazard = zone.hazard;
      else if (terrain === undefined && rng() < zone.hazard.chance) hazard = zone.hazard;
    }
  }

  const state = startBattle({
    id: randomUUID(),
    playerId,
    playerName: player.name,
    zoneId,
    kind: zone.kind === "dungeon" ? "dungeon" : "field",
    monster: MONSTERS[monsterId],
    derived: d,
    currentHp: player.currentHp,
    currentMp: player.currentMp,
    weapon: player.weapon,
    dodgeStreak: counters.dodge_streak ?? 0,
    hazard,
    run,
  });
  await store.saveBattle(state, true);
  // Entering a zone is an action batch too (location conditions).
  const unlocks = await checkUnlocks(store, playerId, { zone: zoneId });
  return { battle: publicBattle(state), unlocks };
}

export async function battleAction(store: GameStore, playerId: string, action: BattleAction, rng: Rng = Math.random) {
  const battle = await store.getActiveBattle(playerId);
  if (!battle) throw new GameError("You're not in a battle");
  const { player, skills, defs, unique } = await load(store, playerId);
  const d = derive(player, skills, defs, unique);
  const inventory = await store.getInventory(playerId);

  let next: BattleState;
  let consumed: string[];
  try {
    ({ state: next, consumed } = resolveTurn(battle, action, { derived: d, defs, inventory, rng }));
  } catch (e) {
    throw new GameError((e as Error).message);
  }
  for (const id of consumed) await store.changeItem(playerId, id, -1);

  if (!next.over) {
    await store.saveBattle(next, true);
    return { battle: publicBattle(next), unlocks: [] as UnlockNotice[], nextBattle: null, claimed: null as string | null };
  }

  // ----- The battle ended: settle it -----
  const deltas: CounterDeltas = next.deltas;
  player.currentHp = Math.max(0, next.player.hp);
  player.currentMp = next.player.mp;
  let claimed: string | null = null;
  let dungeonCleared = false;
  const extraLog: string[] = [];

  if (next.result === "win" && next.rewards) {
    const r = grantExp(player, next.rewards.exp);
    Object.assign(player, r.player);
    player.gold += next.rewards.gold;
    for (const id of next.rewards.drops) await store.changeItem(playerId, id, 1);
    if (r.levelsGained > 0) {
      const nd = derive(player, skills, defs, unique);
      player.currentHp = nd.maxHp;
      player.currentMp = nd.maxMp;
      extraLog.push(`Level up! You're now level ${player.level} and have ${player.freePoints} free stat points.`);
    }
    if (unique?.equipped) {
      unique.exp++;
      if (unique.exp >= 10 * unique.level && unique.level < 10) {
        unique.exp = 0;
        unique.level++;
        extraLog.push(`${unique.name} grows stronger! (level ${unique.level})`);
      }
      await store.saveUniqueItem(unique);
    }
    if (next.run) {
      const zone = ZONES[next.run.dungeonId];
      if (next.run.room + 1 >= next.run.totalRooms) {
        dungeonCleared = true;
        inc(deltas, "dungeons_cleared");
        inc(deltas, `cleared_${zone.id}`);
        extraLog.push(`You cleared ${zone.name}!`);
        // Unique item: first solo clear on the first attempt, once per server.
        if (next.run.firstAttempt && zone.uniqueItemId) {
          if (await store.claimUniqueItem(zone.uniqueItemId, playerId)) {
            claimed = zone.uniqueItemId;
            extraLog.push("Something stirs in the queen's remains... You claimed a one-of-a-kind item!");
          }
        }
      }
    }
  } else if (next.result === "loss") {
    player.currentHp = 0;
    player.gold = Math.floor(player.gold * 0.9);
    extraLog.push("You wake up in Thornvale, a little poorer. Rest to recover.");
  }

  next.log.push(...extraLog);
  await store.applyCounters(playerId, deltas);
  await store.savePlayer(player);
  await store.saveBattle(next, false);

  const unlocks = await checkUnlocks(store, playerId, { battle: summarize(next, dungeonCleared), zone: next.zoneId });

  // Dungeon: move straight on to the next room with whatever HP is left.
  let nextBattle = null;
  if (next.result === "win" && next.run && !dungeonCleared) {
    const fresh = await load(store, playerId);
    const nd = derive(fresh.player, fresh.skills, fresh.defs, fresh.unique);
    const counters = await store.getCounters(playerId);
    const room = next.run.room + 1;
    const state = startBattle({
      id: randomUUID(),
      playerId,
      playerName: fresh.player.name,
      zoneId: next.zoneId,
      kind: "dungeon",
      monster: MONSTERS[ZONES[next.run.dungeonId].rooms![room]],
      derived: nd,
      currentHp: fresh.player.currentHp,
      currentMp: fresh.player.currentMp,
      weapon: fresh.player.weapon,
      dodgeStreak: counters.dodge_streak ?? 0,
      hazard: null,
      run: { ...next.run, room },
    });
    // Keep the end of the previous room's log so the player sees what happened.
    state.log.unshift(...next.log.slice(-5), `— Deeper into ${ZONES[next.run.dungeonId].name} (room ${room + 1} of ${next.run.totalRooms}) —`);
    await store.saveBattle(state, true);
    nextBattle = publicBattle(state);
  }

  return { battle: publicBattle(next), unlocks, nextBattle, claimed };
}

function inc(deltas: CounterDeltas, key: string, n = 1) {
  if (n === 0) return;
  const cur = deltas[key];
  if (!cur) deltas[key] = { op: "inc", value: n };
  else cur.value += n;
}

// ---------- Live combat (side-view maps) ----------

/** Any old turn-based fight still open is closed quietly, so it never blocks the live game. */
async function closeOldBattle(store: GameStore, playerId: string) {
  const b = await store.getActiveBattle(playerId);
  if (b && !b.over) await store.saveBattle({ ...b, over: true, result: "fled" }, false);
}

const runKey = (dungeonId: string, k: "active" | "room" | "direct" | "first") => `run_${dungeonId}_${k}`;

/** Walking onto a map. Entering the dungeon starts a new attempt; leaving it ends the attempt. */
export async function liveEnter(store: GameStore, playerId: string, zoneId: string, now = Date.now()) {
  const zone = ZONES[zoneId];
  if (!zone) throw new GameError("Unknown place");
  await closeOldBattle(store, playerId);
  const player = await store.getPlayer(playerId);
  if (!player) throw new GameError("Character not found", 404);
  // A new map ends any fight: hits in a row and boss gauges start over.
  const deltas: CounterDeltas = { live_t: { op: "set", value: now }, hit_streak: { op: "set", value: 0 } };
  resetBossFight(deltas, await store.listSkillDefs());
  for (const z of Object.values(ZONES)) {
    if (z.kind === "dungeon" && z.id !== zoneId) deltas[runKey(z.id, "active")] = { op: "set", value: 0 };
  }
  let run: { room: number; totalRooms: number; firstAttempt: boolean } | null = null;
  if (zone.kind === "dungeon") {
    if (player.currentHp <= 0) throw new GameError("You're too hurt to go in. Rest at the inn first.");
    const attempts = player.dungeonAttempts[zone.id] ?? 0;
    player.dungeonAttempts = { ...player.dungeonAttempts, [zone.id]: attempts + 1 };
    await store.savePlayer(player);
    deltas[runKey(zone.id, "active")] = { op: "set", value: 1 };
    deltas[runKey(zone.id, "room")] = { op: "set", value: 0 };
    deltas[runKey(zone.id, "direct")] = { op: "set", value: 0 };
    deltas[runKey(zone.id, "first")] = { op: "set", value: attempts === 0 ? 1 : 0 };
    run = { room: 0, totalRooms: zone.rooms!.length, firstAttempt: attempts === 0 };
  }
  await store.applyCounters(playerId, deltas);
  const unlocks = zone.kind === "town" ? [] : await checkUnlocks(store, playerId, { zone: zoneId });
  return { run, unlocks };
}

/**
 * Settle what happened on the map since the last report: hits, damage taken,
 * items, and (for a kill) the rewards. Throws if the report is impossible.
 */
export async function liveReport(store: GameStore, playerId: string, report: LiveReport, rng: Rng = Math.random, now = Date.now()) {
  const zone = ZONES[report.zoneId];
  if (!zone) throw new GameError("Unknown place");
  const { player, skills, defs, unique } = await load(store, playerId);
  const d = derive(player, skills, defs, unique);
  const counters = await store.getCounters(playerId);
  const elapsedSec = Math.max(0, Math.min(900, (now - (counters.live_t ?? now - 60_000)) / 1000));
  const deltas: CounterDeltas = { live_t: { op: "set", value: now } };

  // ----- swings: fast enough? equipped skills? no impossible numbers? -----
  const ps = d.passive;
  const zoneMonsters = zoneMonsterIds(zone.id).map((id) => MONSTERS[id]).filter(Boolean);
  const bossMaxHp = Math.max(0, ...zoneMonsters.filter((m) => m.isBoss).map((m) => m.stats.HP));
  const plainMaxHp = Math.max(0, ...zoneMonsters.filter((m) => !m.isBoss).map((m) => m.stats.HP));
  // The strongest the player can be right now (Duelist's Oath on), so caps are never too tight.
  const atk = withDuelist(d, true);
  const active = new Map(d.activeSkills.map((s) => [s.id, s]));
  // Strikes that passive skills make on their own.
  const procs: Record<string, ActiveEffect | undefined> = { iron_riposte: ps.riposte, eye_of_the_storm: ps.storm };
  const specs = new Map<string, AttackSpec>();
  const specFor = (skillId?: string) => {
    const key = skillId ?? "";
    let s = specs.get(key);
    if (!s) {
      const proc = skillId ? procs[skillId] : undefined;
      const def = skillId && !proc ? active.get(skillId) : undefined;
      if (skillId && !proc && !def?.effect.active?.multiplier) throw new GameError("That skill isn't equipped");
      const eff = proc ?? def?.effect.active;
      s = attackSpec(player.weapon, atk, skillId && eff ? { name: def?.name ?? skillId, active: eff } : undefined);
      specs.set(key, s);
    }
    return s;
  };
  let physical = 0;
  let magic = 0;
  let crits = 0;
  let landed = 0;
  let landedCount = 0;
  let plainHits = 0;
  let riposteHits = 0;
  let stormHits = 0;
  let executes = 0;
  let streak = counters.hit_streak ?? 0;
  let bestStreak = 0;
  const waves = new Map<number, number>();
  const ultFired: { id: string; tier: 1 | 2 | 3; dmg: number }[] = [];
  for (const h of report.hits) {
    if (h.skillId === "vengeance_vault") {
      if (!ps.vault) throw new GameError("That skill isn't equipped");
      if (!h.miss) waves.set(h.wave ?? 0, Math.max(waves.get(h.wave ?? 0) ?? 0, h.dmg));
    } else if (h.ult) {
      const def = h.skillId ? active.get(h.skillId) : undefined;
      if (!def?.effect.active?.ultimate) throw new GameError("That skill isn't equipped");
      ultFired.push({ id: def.id, tier: h.ult, dmg: h.miss ? 0 : h.dmg });
    } else if (h.skillId && procs[h.skillId] !== undefined) {
      if (!procs[h.skillId]) throw new GameError("That skill isn't equipped");
      const cap = Math.ceil(maxHit(specFor(h.skillId), atk)) + 1;
      if (!h.miss && h.dmg > cap) throw new GameError("A hit was bigger than possible");
      if (h.skillId === "iron_riposte") riposteHits++;
      else stormHits++;
    } else {
      plainHits++;
      const spec = specFor(h.skillId);
      if (h.miss) continue;
      // Hits in a row can only grow one at a time (any drop is fine: you got hit).
      const st = h.streak ?? 0;
      if (st > streak + 1) throw new GameError("That run of hits doesn't add up");
      streak = st;
      bestStreak = Math.max(bestStreak, st + 1);
      if (h.execute) {
        if (!ps.blade_read) throw new GameError("That skill isn't equipped");
        executes++;
        if (h.dmg > plainMaxHp) throw new GameError("A hit was bigger than possible");
      } else {
        const boost = ps.hundred_cuts ? streakMult(st, ps.hundred_cuts.per_hit) : 1;
        const cap = Math.ceil(maxHit(spec, atk) * (h.counter ? PARRY_COUNTER_MULT : 1) * boost) + 1;
        if (h.dmg > cap) throw new GameError("A hit was bigger than possible");
      }
    }
    if (h.miss) continue;
    landed += h.dmg;
    landedCount++;
    const el = h.skillId && specs.get(h.skillId) ? specs.get(h.skillId)!.element : WEAPONS[player.weapon].element;
    if (el === "magic") magic += h.dmg;
    else physical += h.dmg;
    if (h.crit) crits++;
  }
  // Hundred Cuts swings can hit a crowd at once.
  const rate = MAX_HITS_PER_SEC * (ps.hundred_cuts ? 4 : 1);
  if (plainHits > rate * elapsedSec + 8) throw new GameError("Too many hits for the time that passed");
  if (report.hitsTaken > elapsedSec * 10 + 5) throw new GameError("Too many hits taken for the time that passed");
  if (riposteHits > report.parries) throw new GameError("More counters than parries");
  if (stormHits > report.hitsTaken * 30) throw new GameError("More counters than hits taken");
  if (report.guardStored > report.blockedDamage) throw new GameError("Stored more damage than you blocked");
  // Blade Read: one one-shot per 20 parries in a row. A few left over carry into the next report.
  const bladeAt = ps.blade_read?.execute_at ?? 20;
  const bank = (counters.blade_bank ?? 0) + report.parries;
  if (executes * bladeAt > bank) throw new GameError("Not enough parries for that");
  deltas.blade_bank = { op: "set", value: Math.min(bladeAt - 1, bank - executes * bladeAt) };
  // Vengeance Vault: shockwaves can only release what was stored.
  const vault = (ps.vault ? (counters.vault_store ?? 0) + report.guardStored : 0) - [...waves.values()].reduce((n, v) => n + v, 0);
  if (vault < 0) throw new GameError("Released more damage than you stored");
  deltas.vault_store = { op: "set", value: report.type === "death" ? 0 : vault };
  // Hits in a row
  if (report.hitStreak > streak + 1) throw new GameError("That run of hits doesn't add up");
  deltas.hit_streak = { op: "set", value: report.hitStreak };
  if (bestStreak) maxCounter(deltas, "hit_streak_best", bestStreak);

  // ----- the boss fight and its ultimates -----
  const bt = report.boss;
  if (bt.hits > report.hitsTaken || bt.parries > report.parries) throw new GameError("Boss fight counts don't add up");
  if (bt.parryDmg > bt.parries * (maxBossBlow(zoneMonsters) + 1)) throw new GameError("Parried more damage than possible");
  const bf = {
    hits: (counters.bf_hits ?? 0) + bt.hits,
    parries: (counters.bf_parries ?? 0) + bt.parries,
    parryDmg: (counters.bf_parry_dmg ?? 0) + bt.parryDmg,
  };
  if (bf.hits) maxCounter(deltas, "boss_fight_hits_best", bf.hits);
  if (bf.parryDmg) maxCounter(deltas, "boss_fight_parry_dmg_best", bf.parryDmg);
  let ultExpBonus = 1;
  for (const u of ultFired) {
    const spec = active.get(u.id)!.effect.active!.ultimate!;
    const source = spec.gauge === "boss_hits" ? bf.hits : bf.parries;
    const base = deltas[`bf_base_${u.id}`]?.value ?? counters[`bf_base_${u.id}`] ?? 0;
    if (bossMaxHp <= 0 || source - base < spec.tiers[u.tier - 1]) throw new GameError("That ultimate isn't charged yet");
    if (u.tier === 1) {
      if (deltas[`bf_half_${u.id}`]?.value || counters[`bf_half_${u.id}`]) throw new GameError("That ultimate's first tier was already used this fight");
      if (u.dmg > Math.ceil(bossMaxHp * 0.5) + 1) throw new GameError("A hit was bigger than possible");
      deltas[`bf_half_${u.id}`] = { op: "set", value: 1 };
      deltas[`bf_base_${u.id}`] = { op: "set", value: source };
    } else if (u.dmg > bossMaxHp) throw new GameError("A hit was bigger than possible");
    if (u.tier === 3) ultExpBonus = ULT_EXP_BONUS;
  }
  if (report.bossEnd || report.type === "death") resetBossFight(deltas, defs.values());
  else {
    deltas.bf_hits = { op: "set", value: bf.hits };
    deltas.bf_parries = { op: "set", value: bf.parries };
    deltas.bf_parry_dmg = { op: "set", value: bf.parryDmg };
  }

  // ----- skills and MP -----
  let mpSpent = 0;
  let skillHeal = 0;
  for (const [id, n] of Object.entries(report.skillUses)) {
    const def = active.get(id);
    if (!def?.effect.active) throw new GameError("That skill isn't equipped");
    const a = def.effect.active;
    mpSpent += (a.mp_cost ?? 0) * n;
    if (a.heal_pct) skillHeal += Math.round(d.maxHp * a.heal_pct) * n;
    inc(deltas, "skills_used", n);
    inc(deltas, `skill_used_${id}`, n);
  }
  const regen = d.passive.mp_regen * Math.floor((elapsedSec * 1000) / TICK_MS + 1);
  if (mpSpent > player.currentMp + regen + 1) throw new GameError("Not enough MP for those skills");

  // ----- items eaten -----
  const inv = new Map((await store.getInventory(playerId)).map((i) => [i.itemId, i.qty]));
  let itemHeal = 0;
  for (const id of report.itemsUsed) {
    const item = ITEMS[id];
    const have = inv.get(id) ?? 0;
    if (!item || have < 1) throw new GameError("You don't have that item");
    inv.set(id, have - 1);
    inc(deltas, "items_eaten");
    if (item.edible) itemHeal += item.heal ?? 0;
    else {
      inc(deltas, "inedible_eaten");
      inc(deltas, `ate_${id}`);
    }
  }

  // ----- damage taken, dodges, blocks, statuses -----
  const t = report.taken;
  const taken = t.enemy + t.hazard + t.poison + t.burn;
  inc(deltas, "damage_taken", taken);
  inc(deltas, "hazard_damage_taken", t.hazard);
  if (report.swampTicks > elapsedSec / (TICK_MS / 1000) + 2) throw new GameError("Too much time in the swamp");
  inc(deltas, "swamp_turns", report.swampTicks);
  inc(deltas, "hits_dodged", report.dodged);
  inc(deltas, "defend_used", report.blocks);
  inc(deltas, "parries", report.parries);
  if (player.weapon === "large_shield") inc(deltas, "perfect_blocks", report.parries);
  if (report.stormFights > elapsedSec / 5 + 1) throw new GameError("Too many fights for the time that passed");
  inc(deltas, "storm_fights_survived", report.stormFights);
  inc(deltas, "damage_blocked", report.blockedDamage);
  inc(deltas, "zero_damage_hits", report.zeroHits);
  inc(deltas, "attacks_made", report.hits.length);
  inc(deltas, "crits_landed", crits);
  inc(deltas, "physical_damage_dealt", physical);
  inc(deltas, "magic_damage_dealt", magic);
  maxCounter(deltas, "dodge_streak_best", Math.max(report.dodgeStreakBest, report.dodgeStreak));
  deltas.dodge_streak = { op: "set", value: report.dodgeStreak };
  for (const s of report.statuses) {
    inc(deltas, "statuses_received");
    const key = { poison: "times_poisoned", burn: "times_burned", paralysis: "times_paralyzed" }[s as string];
    if (key) inc(deltas, key);
    if (s === "poison") inc(deltas, "poisoned_since_death");
  }

  // ----- HP and MP: never more than the server allows -----
  const winHeal = report.type === "kill" ? Math.round(d.maxHp * d.passive.heal_on_win_pct) : 0;
  const hpCeiling = Math.min(d.maxHp, player.currentHp + itemHeal + skillHeal + winHeal);
  player.currentHp = report.type === "death" ? 0 : Math.max(0, Math.min(report.hp, hpCeiling));
  player.currentMp = Math.max(0, Math.min(report.mp, d.maxMp, player.currentMp - mpSpent + regen));
  if (itemHeal > 0 || skillHeal > 0) inc(deltas, "hp_healed", Math.max(0, Math.min(itemHeal + skillHeal + winHeal, d.maxHp)));

  const log: string[] = [];
  let rewards: { exp: number; gold: number; drops: string[] } | null = null;
  let levelUp = false;
  let claimed: string | null = null;
  let summary: BattleSummary | null = null;
  let run: { room: number; totalRooms: number; cleared: boolean } | null = null;

  if (report.type === "kill") {
    if (hpCeiling <= 0) throw new GameError("Rest in town first");
    const m = report.monsterId ? MONSTERS[report.monsterId] : undefined;
    if (!m) throw new GameError("Unknown monster");
    if (zone.kind === "town") throw new GameError("There's nothing to fight there");
    const direct = report.directToTarget ?? 0;
    if (direct > landed) throw new GameError("That monster took more damage than you dealt");
    if ((report.hitsOnTarget ?? 0) > report.hits.length) throw new GameError("More hits on the monster than swings");
    if (direct + (report.indirectToTarget ?? 0) < m.stats.HP) throw new GameError("That monster wasn't defeated yet");
    let dungeonCleared = false;
    let directRun = -1;
    let firstAttempt = false;
    if (zone.kind === "dungeon") {
      if (!counters[runKey(zone.id, "active")]) throw new GameError("Enter the dungeon first");
      const room = counters[runKey(zone.id, "room")] ?? 0;
      if (zone.rooms![room] !== m.id) throw new GameError("That monster isn't in this room");
      directRun = (counters[runKey(zone.id, "direct")] ?? 0) + direct;
      firstAttempt = counters[runKey(zone.id, "first")] === 1;
      deltas[runKey(zone.id, "room")] = { op: "set", value: room + 1 };
      deltas[runKey(zone.id, "direct")] = { op: "set", value: directRun };
      dungeonCleared = room + 1 >= zone.rooms!.length;
      if (dungeonCleared) deltas[runKey(zone.id, "active")] = { op: "set", value: 0 };
      run = { room: room + 1, totalRooms: zone.rooms!.length, cleared: dungeonCleared };
    } else if (!zone.encounters!.some((e) => e.monsterId === m.id)) {
      throw new GameError("That monster doesn't live here");
    }

    inc(deltas, "enemies_defeated");
    inc(deltas, `kills_${WEAPONS[player.weapon].fists ? "unarmed" : player.weapon}`);
    inc(deltas, `defeated_${m.id}`);
    inc(deltas, "battles_won");
    if (m.isBoss) inc(deltas, "bosses_defeated");
    if (m.isBoss && report.duel && player.weapon === "sword" && report.itemsUsed.length === 0) inc(deltas, "boss_duels_won");
    if (report.hitsOnTarget === 1) inc(deltas, "one_hit_kills");
    if (player.currentHp / d.maxHp < 0.1) inc(deltas, "low_hp_wins");

    const drops = m.drops.filter((dr) => rng() < dr.chance).map((dr) => dr.itemId);
    const exp = m.isBoss ? Math.round(m.exp * ultExpBonus) : m.exp;
    rewards = { exp, gold: m.gold, drops };
    const r = grantExp(player, exp);
    Object.assign(player, r.player);
    player.gold += m.gold;
    for (const id of drops) inv.set(id, (inv.get(id) ?? 0) + 1);
    if (r.levelsGained > 0) {
      levelUp = true;
      const nd = derive(player, skills, defs, unique);
      player.currentHp = nd.maxHp;
      player.currentMp = nd.maxMp;
      log.push(`Level up! You're now level ${player.level} and have ${player.freePoints} free stat points.`);
    }
    if (unique?.equipped) {
      unique.exp++;
      if (unique.exp >= 10 * unique.level && unique.level < 10) {
        unique.exp = 0;
        unique.level++;
        log.push(`${unique.name} grows stronger! (level ${unique.level})`);
      }
      await store.saveUniqueItem(unique);
    }
    if (dungeonCleared) {
      inc(deltas, "dungeons_cleared");
      inc(deltas, `cleared_${zone.id}`);
      log.push(`You cleared ${zone.name}!`);
      if (firstAttempt && zone.uniqueItemId && (await store.claimUniqueItem(zone.uniqueItemId, playerId))) {
        claimed = zone.uniqueItemId;
        log.push("Something stirs in the queen's remains... You claimed a one-of-a-kind item!");
      }
    }
    summary = {
      result: "win",
      kind: zone.kind === "dungeon" ? "dungeon" : "field",
      zone: zone.id,
      weapon: player.weapon,
      turns: Math.max(1, Math.round((report.fightMs ?? 0) / TICK_MS)),
      attacks_made: report.hitsOnTarget ?? 0,
      direct_damage_dealt: direct,
      damage_taken: taken,
      min_hp_pct: Math.round(report.minHpPct * 1000) / 1000,
      final_hp_pct: Math.round((player.currentHp / d.maxHp) * 1000) / 1000,
      enemy_id: m.id,
      enemy_type: m.type,
      enemy_is_boss: !!m.isBoss,
      in_hazard: report.inSwamp && !!zone.hazard && !d.passive.hazard_immunity.includes(zone.hazard.id),
      dungeon_cleared: dungeonCleared,
      dungeon_direct_damage: directRun,
      dungeon_first_attempt: firstAttempt,
    };
  } else if (report.type === "death") {
    player.currentHp = 0;
    player.gold = Math.floor(player.gold * 0.9);
    inc(deltas, "deaths");
    deltas.poisoned_since_death = { op: "set", value: 0 };
    if (zone.kind === "dungeon") deltas[runKey(zone.id, "active")] = { op: "set", value: 0 };
    log.push("You wake up in Thornvale, a little poorer. Rest at the inn to recover.");
    const m = report.monsterId ? MONSTERS[report.monsterId] : undefined;
    summary = {
      result: "loss",
      kind: zone.kind === "dungeon" ? "dungeon" : "field",
      zone: zone.id,
      weapon: player.weapon,
      damage_taken: taken,
      min_hp_pct: 0,
      final_hp_pct: 0,
      enemy_id: m?.id ?? "",
      enemy_type: m?.type ?? "",
      enemy_is_boss: !!m?.isBoss,
      in_hazard: report.inSwamp,
    };
  }

  // ----- mastery: the weapon in hand grows with use -----
  const mastery = growMastery(deltas, counters, player, ps.mastery_growth, {
    hits: landedCount,
    kills: report.type === "kill" ? 1 : 0,
    blocks: player.weapon === "large_shield" ? report.blocks : 0,
    skills: Object.values(report.skillUses).reduce((n, v) => n + v, 0),
  });
  if (mastery.levelUp) log.push(`${mastery.name} mastery reached level ${mastery.level}!`);

  // Save: items, counters, player. Items go one by one so the store keeps its own rules.
  const before = new Map((await store.getInventory(playerId)).map((i) => [i.itemId, i.qty]));
  for (const [id, qty] of inv) {
    const diff = qty - (before.get(id) ?? 0);
    if (diff !== 0) await store.changeItem(playerId, id, diff);
  }
  await store.applyCounters(playerId, deltas);
  await store.savePlayer(player);
  const unlocks = await checkUnlocks(store, playerId, { battle: summary, zone: zone.id });

  return {
    hp: player.currentHp,
    mp: player.currentMp,
    level: player.level,
    levelUp,
    rewards,
    claimed,
    run,
    log,
    unlocks,
    mastery,
  };
}

// ---------- helpers for live fights ----------

/** Monsters that can appear in a zone. */
function zoneMonsterIds(zoneId: string): string[] {
  const z = ZONES[zoneId];
  return [...(z?.encounters?.map((e) => e.monsterId) ?? []), ...(z?.rooms ?? [])];
}

/** The hardest blow any boss here could land, before defense (bounds parried damage). */
function maxBossBlow(monsters: (typeof MONSTERS)[string][]): number {
  let max = 0;
  for (const m of monsters) {
    if (!m.isBoss) continue;
    for (const a of m.attacks) max = Math.max(max, Math.ceil((a.element === "magic" ? m.stats.INT : m.stats.STR) * a.multiplier + (a.piercing ?? 0)));
  }
  return max;
}

/** A boss fight is over: clear its tallies and every ultimate gauge. */
function resetBossFight(deltas: CounterDeltas, defs: Iterable<SkillDefinition>) {
  for (const k of ["bf_hits", "bf_parries", "bf_parry_dmg"]) deltas[k] = { op: "set", value: 0 };
  for (const d of defs) {
    if (!d.effect.active?.ultimate) continue;
    deltas[`bf_base_${d.id}`] = { op: "set", value: 0 };
    deltas[`bf_half_${d.id}`] = { op: "set", value: 0 };
  }
}

/** Add mastery EXP for what the weapon in hand just did. Returns where that mastery stands. */
function growMastery(
  deltas: CounterDeltas,
  counters: Record<string, number>,
  player: Player,
  growth: number,
  did: { hits: number; kills: number; blocks: number; skills: number },
) {
  const id = WEAPON_MASTERY[player.weapon];
  const base = did.hits * MASTERY_XP.hit + did.kills * MASTERY_XP.kill + did.blocks * MASTERY_XP.block + did.skills * MASTERY_XP.skill;
  const gain = Math.round(base * masteryRate(player.classId, id, growth));
  const before = counters[masteryKey(id)] ?? 0;
  const lvBefore = masteryLevel(before);
  const level = masteryLevel(before + gain);
  if (gain > 0) inc(deltas, masteryKey(id), gain);
  if (level !== lvBefore) {
    deltas[`mlv_${id}`] = { op: "set", value: level };
    if (lvBefore < 20 && level >= 20) inc(deltas, "masteries_lv20");
  }
  return { id, name: MASTERIES.find((m) => m.id === id)!.name, level, gained: gain, levelUp: level > lvBefore };
}
