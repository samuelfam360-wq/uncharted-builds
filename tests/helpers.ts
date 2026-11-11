// Shared helpers for the live-fight tests.
import { Engine, type CombatInfo } from "../src/components/side/engine";
import type { LiveReport, ReportHit } from "../src/lib/game/live";
import * as game from "../src/lib/game/service";
import type { ClassId } from "../src/lib/game/types";
import { MemoryStore } from "../src/lib/store/memory";

export function seeded(seed = 7) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export const blank = (zoneId: string, extra: Partial<LiveReport> = {}): LiveReport => ({
  type: "sync",
  zoneId,
  hits: [],
  skillUses: {},
  itemsUsed: [],
  taken: { enemy: 0, hazard: 0, poison: 0, burn: 0 },
  dodged: 0,
  dodgeStreak: 0,
  dodgeStreakBest: 0,
  blocks: 0,
  parries: 0,
  blockedDamage: 0,
  zeroHits: 0,
  statuses: [],
  swampTicks: 0,
  inSwamp: false,
  minHpPct: 1,
  hp: 30,
  mp: 0,
  hitsTaken: 0,
  hitStreak: 0,
  guardStored: 0,
  boss: { hits: 0, parries: 0, parryDmg: 0, dodges: 0, weaponHits: 0, dmg: 0 },
  bossEnd: false,
  stormFights: 0,
  phantomFights: 0,
  escapes: 0,
  stunsDealt: 0,
  combos7: 0,
  cleanFights: 0,
  quickDraws: 0,
  farHits: 0,
  markedRuns: 0,
  ...extra,
});

export async function newPlayer(classId: ClassId = "swordsman", stats: Record<string, number> = { STR: 3, HP: 2 }) {
  const store = new MemoryStore();
  const p = await game.createCharacter(store, { name: "Rin", classId, stats });
  return { store, p };
}

export async function give(store: MemoryStore, playerId: string, ...ids: string[]) {
  for (const id of ids) await store.grantSkill(playerId, id, { status: "owned", equipped: true, stage: 1, evolvesFrom: null });
}

export const hit = (dmg: number, extra: Partial<ReportHit> = {}): ReportHit => ({ dmg, crit: false, miss: false, ...extra });

// ---------- the browser engine ----------

export async function engineSetup(mapId: "mirewood_fields" | "hollow_of_the_mire", skills: string[], classId: ClassId = "swordsman", rng = seeded(11)) {
  const { store, p } = await newPlayer(classId, classId === "tanker" ? { VIT: 3, HP: 2 } : { STR: 3, HP: 2 });
  await give(store, p.id, ...skills);
  await game.liveEnter(store, p.id, mapId, 0);
  const st = await game.getState(store, p.id);
  const reports: LiveReport[] = [];
  const toasts: string[] = [];
  const e = new Engine({
    mapId,
    x: 4,
    row: mapId === "mirewood_fields" ? 11 : 9,
    combat: st.combat as CombatInfo,
    weapon: st.player.weapon,
    hp: st.player.currentHp,
    mp: st.player.currentMp,
    maxHp: st.derived.maxHp,
    maxMp: st.derived.maxMp,
    bag: st.inventory,
    events: { report: (r) => reports.push(r), toast: (t) => toasts.push(t) },
    rng,
    now: 0,
  });
  let now = 0;
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 16) e.update(16, (now += 16));
  };
  return { store, p, e, reports, toasts, run, clock: () => now };
}

/** Put a monster right in front of the player and make it attack now. */
export function faceOff(e: Engine, id: string) {
  const m = e.monsters.find((x) => x.id === id && x.state !== "dead")!;
  e.player.x = m.x - 70;
  e.player.y = m.y;
  e.player.facing = 1;
  m.span = [m.x, m.x];
  m.aggro = true;
  m.provoked = true;
  m.nextAttackAt = 0;
  return m;
}

export async function parryOnce(e: Engine, run: (ms: number) => void, m: ReturnType<typeof faceOff>) {
  m.nextAttackAt = 0;
  for (let i = 0; i < 200 && m.state !== "windup"; i++) run(16);
  while (e.now < m.stateUntil - 100) run(16);
  e.held.block = true;
  run(150);
  e.held.block = false;
  run(16);
}

