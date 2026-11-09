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
  type CreateCharacterInput,
} from "./character";
import { eatOutsideBattle, resolveTurn, startBattle, summarize, type BattleAction, type BattleState, type Rng } from "./combat";
import { ITEMS, MONSTERS, ZONES } from "./data/world";
import { findUnlocks, type BattleSummary } from "./rules";
import type { CounterDeltas, Player, PlayerSkill, SkillDefinition, Stats, UniqueItem, WeaponType } from "./types";
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
  const [inventory, battle] = await Promise.all([store.getInventory(playerId), store.getActiveBattle(playerId)]);
  return {
    player,
    derived: { stats: d.stats, maxHp: d.maxHp, maxMp: d.maxMp, immunities: [...d.immunities] },
    expToNext: expToNext(player.level),
    slots: slotUsage(player, skills, defs),
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
        };
      }),
    inventory: inventory.map((i) => ({ ...i, name: ITEMS[i.itemId]?.name ?? i.itemId, description: ITEMS[i.itemId]?.description ?? "", edible: ITEMS[i.itemId]?.edible ?? false })),
    uniqueItem: unique,
    battle: battle ? publicBattle(battle) : null,
    zones: Object.values(ZONES).map((z) => ({ id: z.id, name: z.name, kind: z.kind, description: z.description })),
    weapons: Object.values(WEAPONS).map((w) => ({ ...w, owned: player.ownedWeapons.includes(w.type) })),
    weaponPrice: WEAPON_PRICE,
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
  if (!WEAPONS[weapon]) throw new GameError("Unknown weapon");
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

export async function beginBattle(store: GameStore, playerId: string, zoneId: string, rng: Rng = Math.random) {
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
    if (zone.hazard && rng() < zone.hazard.chance) hazard = zone.hazard;
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
  const cur = deltas[key];
  if (!cur) deltas[key] = { op: "inc", value: n };
  else cur.value += n;
}
