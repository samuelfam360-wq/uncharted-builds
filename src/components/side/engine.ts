// The live side-view game: movement, ladders, monsters, real-time combat and parry.
// No drawing and no React here. The page drives it with update() and reads its state.

import { WEAPONS } from "@/lib/game/constants";
import { ITEMS, MONSTERS, ZONES, type EnemyAttack } from "@/lib/game/data/world";
import {
  PARRY_COUNTER_MULT,
  PARRY_STUN_MS,
  PARRY_WINDOW_MS,
  TICK_MS,
  attackSpec,
  rollEnemyHit,
  rollHit,
  type AttackSpec,
  type Attacker,
  type LiveReport,
  type ReportHit,
} from "@/lib/game/live";
import {
  SIDE_MAPS,
  TILE,
  isLadder,
  isPlatform,
  isSolid,
  isSwamp,
  mapSize,
  tileAt,
  walkSpan,
  type NpcDef,
  type PortalDef,
  type SideMap,
  type SideMapId,
  type SignDef,
} from "@/lib/game/data/sidemaps";
import type { ActiveEffect, StatKey, StatusType, WeaponType } from "@/lib/game/types";
import { MONSTER_LOOKS } from "./sprites";
import { WEAPON_STYLE } from "./hero";

// ---------- tuning (feel) ----------
const GRAVITY = 2600;
const JUMP_SPEED = 960;
const RUN_SPEED = 270;
const CLIMB_SPEED = 210;
const MAX_FALL = 1300;
const HURT_INVULN_MS = 800;
const RESPAWN_MS = 7000;
export const PLAYER_W = 34;
export const PLAYER_H = 82;

/** How each weapon attacks: reach (melee) or projectile, and swing speed. */
export const WEAPON_FEEL: Record<WeaponType, { interval: number; reach: number; projectile?: { speed: number; range: number; kind: "arrow" | "bullet" | "magic" | "holy" | "star" } }> = {
  sword: { interval: 460, reach: 74 },
  daggers: { interval: 300, reach: 54 },
  lance: { interval: 620, reach: 116 },
  hammer: { interval: 760, reach: 80 },
  large_shield: { interval: 560, reach: 58 },
  strength_bracelet: { interval: 340, reach: 50 },
  unarmed: { interval: 360, reach: 48 },
  bow: { interval: 560, reach: 0, projectile: { speed: 950, range: 540, kind: "arrow" } },
  pistol: { interval: 460, reach: 0, projectile: { speed: 1300, range: 580, kind: "bullet" } },
  staff: { interval: 620, reach: 0, projectile: { speed: 720, range: 470, kind: "magic" } },
  tamer_wand: { interval: 600, reach: 0, projectile: { speed: 680, range: 430, kind: "star" } },
  healing_bracelet: { interval: 600, reach: 0, projectile: { speed: 680, range: 420, kind: "holy" } },
};

/** How each monster behaves. Numbers in world units (a tile is 64) and milliseconds. */
interface MonsterAI {
  speed: number;
  aggressive: number; // attacks on sight within this range; 0 = only after you hit it
  range: number; // melee reach in front of its body
  windup: number;
  recover: number;
  special?: Record<string, { windup: number; kind: "melee" | "area" | "spit" | "dash"; range: number }>;
}
const AI: Record<string, MonsterAI> = {
  green_slime: { speed: 55, aggressive: 0, range: 34, windup: 700, recover: 900 },
  horned_rabbit: { speed: 120, aggressive: 0, range: 36, windup: 480, recover: 800, special: { "Horn Charge": { windup: 760, kind: "dash", range: 150 } } },
  bog_toad: { speed: 70, aggressive: 0, range: 40, windup: 600, recover: 900, special: { "Venom Spit": { windup: 760, kind: "spit", range: 340 } } },
  thorn_wolf: { speed: 150, aggressive: 260, range: 46, windup: 520, recover: 750, special: { "Savage Bite": { windup: 800, kind: "melee", range: 56 } } },
  mire_bat: { speed: 130, aggressive: 380, range: 34, windup: 520, recover: 800, special: { Screech: { windup: 950, kind: "area", range: 190 } } },
  moss_golem: { speed: 40, aggressive: 320, range: 64, windup: 950, recover: 1100, special: { "Crushing Fist": { windup: 1150, kind: "melee", range: 84 } } },
  mirefang: {
    speed: 46,
    aggressive: 900,
    range: 90,
    windup: 650,
    recover: 900,
    special: { "Toxic Breath": { windup: 1150, kind: "area", range: 270 }, "Paralyzing Lash": { windup: 850, kind: "melee", range: 190 } },
  },
};

export type Rng = () => number;

export interface CombatInfo {
  stats: Record<StatKey, number>;
  passive: Attacker["passive"] & {
    reflect_pct: number;
    mp_regen: number;
    heal_on_win_pct: number;
    hazard_immunity: string[];
    dodge_invisibility?: number;
    pacifist?: boolean;
    poison_aura?: { chance: number; turns: number };
    revive_once?: boolean;
  };
  statusResist: Partial<Record<StatusType, number>>;
  poisonMult: number;
  immunities: StatusType[];
  skills: { id: string; name: string; active: ActiveEffect; usesPerBattle: number | null }[];
  dodgeStreak: number;
  dodgeStreakBest: number;
}

interface Status {
  until: number;
  nextTick: number;
}

export interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  onGround: boolean;
  onLadder: boolean;
  dropUntil: number;
  hp: number;
  mp: number;
  maxHp: number;
  maxMp: number;
  statuses: Partial<Record<StatusType, Status>>;
  pinnedUntil: number; // paralysis twitch
  invulnUntil: number;
  hurtUntil: number;
  controlLockUntil: number;
  attackStart: number;
  attackUntil: number;
  attackResolved: boolean;
  nextAttackAt: number;
  castStart: number;
  castUntil: number;
  blocking: boolean;
  blockStart: number;
  counterUntil: number;
  dead: boolean;
  diedAt: number;
  reviveUsed: boolean;
  invisibleUntil: number;
  skillReady: Record<string, number>;
  globalReady: number;
  inSwamp: boolean;
  swampNext: number;
  regenNext: number;
  walkT: number;
}

export interface Monster {
  uid: number;
  id: string;
  x: number;
  y: number;
  baseY: number;
  facing: 1 | -1;
  hp: number;
  maxHp: number;
  span: [number, number]; // world x range it may walk
  state: "patrol" | "chase" | "windup" | "recover" | "stunned" | "dead";
  stateUntil: number;
  attack: EnemyAttack | null;
  nextAttackAt: number;
  aggro: boolean;
  provoked: boolean;
  statuses: Partial<Record<StatusType, Status>>;
  flashUntil: number;
  showHpUntil: number;
  diedAt: number;
  spawnIndex: number; // field spawn it came from, or -1 for dungeon rooms
  walkT: number;
  dashUntil: number;
  patrolUntil: number;
  patrolDir: 1 | -1 | 0;
  fight: { start: number; direct: number; indirect: number; swings: number; inSwamp: boolean } | null;
  struckAt: number; // when its last blow landed (for the strike pose)
}

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  left: number; // distance left
  kind: "arrow" | "bullet" | "magic" | "holy" | "star" | "venom";
  fromPlayer: boolean;
  spec?: AttackSpec;
  skillId?: string;
  counter?: boolean;
  monsterUid?: number;
  attack?: EnemyAttack;
  dead?: boolean;
}

export interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  born: number;
  life: number;
}

export interface Fx {
  kind: "slash" | "burst" | "parry" | "spark" | "heal" | "area" | "level";
  x: number;
  y: number;
  r: number;
  born: number;
  life: number;
  facing: 1 | -1;
  color: string;
}

export type Nearby =
  | { kind: "npc"; npc: NpcDef }
  | { kind: "door"; building: SideMap["buildings"][number] }
  | { kind: "sign"; sign: SignDef }
  | { kind: "portal"; portal: PortalDef };

export interface EngineEvents {
  report(r: LiveReport): void; // send to the server (kill / death / sync)
  toast(text: string): void;
}

export interface HeldInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  attack: boolean;
  block: boolean;
}

export type Press = "jump" | "skill0" | "skill1" | "skill2" | "skill3" | "interact" | "potion";

const emptyAcc = () => ({
  hits: [] as ReportHit[],
  skillUses: {} as Record<string, number>,
  itemsUsed: [] as string[],
  taken: { enemy: 0, hazard: 0, poison: 0, burn: 0 },
  dodged: 0,
  blocks: 0,
  parries: 0,
  blockedDamage: 0,
  zeroHits: 0,
  statuses: [] as StatusType[],
  swampTicks: 0,
  minHpPct: 1,
  dirty: false,
});

export class Engine {
  map: SideMap;
  player: Player;
  monsters: Monster[] = [];
  projectiles: Projectile[] = [];
  texts: FloatText[] = [];
  fx: Fx[] = [];
  held: HeldInput = { left: false, right: false, up: false, down: false, attack: false, block: false };
  private presses: Press[] = [];
  combat: CombatInfo;
  weapon: WeaponType;
  bag: { itemId: string; qty: number }[] = [];
  run: { room: number; totalRooms: number; cleared: boolean } | null = null;
  now = 0;
  paused = false;
  dodgeStreak: number;
  dodgeStreakBest: number;
  private acc = emptyAcc();
  private uid = 1;
  private rng: Rng;
  private events: EngineEvents;
  private spawnTimers = new Map<number, number>();
  private pendingHits: { at: number; uid: number; spec: AttackSpec; skillId: string; counter: boolean }[] = [];

  constructor(opts: {
    mapId: SideMapId;
    x: number;
    row: number;
    combat: CombatInfo;
    weapon: WeaponType;
    hp: number;
    mp: number;
    maxHp: number;
    maxMp: number;
    bag: { itemId: string; qty: number }[];
    run?: Engine["run"];
    events: EngineEvents;
    rng?: Rng;
    now?: number;
  }) {
    this.rng = opts.rng ?? Math.random;
    this.events = opts.events;
    this.combat = opts.combat;
    this.weapon = opts.weapon;
    this.bag = opts.bag.map((b) => ({ ...b }));
    this.dodgeStreak = opts.combat.dodgeStreak;
    this.dodgeStreakBest = opts.combat.dodgeStreakBest;
    this.now = opts.now ?? 0;
    this.map = SIDE_MAPS[opts.mapId];
    this.player = this.freshPlayer(opts.x, opts.row, opts.hp, opts.mp, opts.maxHp, opts.maxMp);
    this.run = opts.run ?? null;
    this.spawnAll();
  }

  private freshPlayer(x: number, row: number, hp: number, mp: number, maxHp: number, maxMp: number): Player {
    return {
      x: x * TILE,
      y: row * TILE,
      vx: 0,
      vy: 0,
      facing: 1,
      onGround: true,
      onLadder: false,
      dropUntil: 0,
      hp,
      mp,
      maxHp,
      maxMp,
      statuses: {},
      pinnedUntil: 0,
      invulnUntil: 0,
      hurtUntil: 0,
      controlLockUntil: 0,
      attackStart: -1e9,
      attackUntil: 0,
      attackResolved: true,
      nextAttackAt: 0,
      castStart: -1e9,
      castUntil: 0,
      blocking: false,
      blockStart: 0,
      counterUntil: 0,
      dead: false,
      diedAt: 0,
      reviveUsed: false,
      invisibleUntil: 0,
      skillReady: {},
      globalReady: 0,
      inSwamp: false,
      swampNext: 0,
      regenNext: this.now + TICK_MS,
      walkT: 0,
    };
  }

  // ---------- map changes ----------

  /** Move to another map. The page sends a sync report first. */
  setMap(mapId: SideMapId, x: number, row: number, run: Engine["run"]) {
    const p = this.player;
    this.map = SIDE_MAPS[mapId];
    this.run = run;
    Object.assign(p, { x: x * TILE, y: row * TILE, vx: 0, vy: 0, onGround: true, onLadder: false, statuses: {}, dead: false, reviveUsed: false, blocking: false });
    this.projectiles = [];
    this.texts = [];
    this.fx = [];
    this.pendingHits = [];
    this.spawnTimers.clear();
    this.spawnAll();
  }

  private spawnAll() {
    this.monsters = [];
    this.map.spawns.forEach((_, i) => this.spawnField(i));
    this.spawnRoom();
  }

  private makeMonster(id: string, x: number, y: number, span: [number, number], spawnIndex: number): Monster {
    const def = MONSTERS[id];
    return {
      uid: this.uid++,
      id,
      x,
      y,
      baseY: y,
      facing: -1,
      hp: def.stats.HP,
      maxHp: def.stats.HP,
      span,
      state: "patrol",
      stateUntil: 0,
      attack: null,
      nextAttackAt: this.now + 800,
      aggro: false,
      provoked: false,
      statuses: {},
      flashUntil: 0,
      showHpUntil: 0,
      diedAt: 0,
      spawnIndex,
      walkT: Math.random() * 1000,
      dashUntil: 0,
      patrolUntil: 0,
      patrolDir: 0,
      fight: null,
      struckAt: -1e9,
    };
  }

  private spawnField(i: number) {
    const s = this.map.spawns[i];
    const [a, b] = walkSpan(this.map, s.x, s.row);
    const look = MONSTER_LOOKS[s.monsterId];
    const half = look.body.w / 2;
    const m = this.makeMonster(s.monsterId, s.x * TILE + TILE / 2, s.row * TILE, [a * TILE + half, b * TILE - half], i);
    this.monsters.push(m);
  }

  /** In the dungeon, the current room's monster appears once you walk in. */
  private spawnRoom() {
    if (!this.run || this.run.cleared) return;
    const room = this.map.rooms[this.run.room];
    if (!room || this.monsters.some((m) => m.spawnIndex === -1 - this.run!.room)) return;
    const p = this.player;
    if (p.x < room.x0 * TILE + 8) return;
    const id = ZONES[this.map.zoneId].rooms![this.run.room];
    const look = MONSTER_LOOKS[id];
    const half = look.body.w / 2;
    const y = look.flying ? room.spawnRow * TILE : room.spawnRow * TILE;
    const m = this.makeMonster(id, room.spawnX * TILE + TILE / 2, y, [room.x0 * TILE + half, (room.x1 + 1) * TILE - half], -1 - this.run.room);
    m.aggro = true;
    m.provoked = true;
    m.nextAttackAt = this.now + 1200;
    this.monsters.push(m);
    this.events.toast(MONSTERS[id].isBoss ? `${MONSTERS[id].name} awakens!` : `${MONSTERS[id].name} blocks the way!`);
  }

  /** Server confirmed a dungeon kill: open the gate. */
  setRun(run: Engine["run"]) {
    this.run = run;
    if (run?.cleared) this.events.toast("The way out is open.");
  }

  // ---------- collision ----------

  gateClosedAt(col: number): boolean {
    if (!this.run) return false;
    return this.map.rooms.some((r, i) => r.gateX === col && i >= this.run!.room);
  }

  solidAt(col: number, row: number): boolean {
    if (isSolid(tileAt(this.map, col, row))) return true;
    if (this.map.gateTop && row >= this.map.gateTop && this.gateClosedAt(col) && !isSolid(tileAt(this.map, col, row))) return true;
    return false;
  }

  // ---------- input ----------

  press(p: Press) {
    if (!this.paused) this.presses.push(p);
  }

  // ---------- main loop ----------

  update(dtMs: number, now: number) {
    this.now = now;
    if (this.paused) return;
    const steps = Math.max(1, Math.ceil(dtMs / 17));
    const dt = Math.min(dtMs, 60) / 1000 / steps;
    for (let i = 0; i < steps; i++) this.step(dt);
    const presses = this.presses;
    this.presses = [];
    for (const p of presses) this.handlePress(p);
    this.updateCombat();
    this.texts = this.texts.filter((t) => now - t.born < t.life);
    this.fx = this.fx.filter((f) => now - f.born < f.life);
  }

  private canAct() {
    const p = this.player;
    const st = p.statuses;
    return !p.dead && !st.stun && !st.freeze && this.now >= p.pinnedUntil;
  }

  private step(dt: number) {
    const p = this.player;
    const now = this.now;
    const h = this.held;
    if (p.dead) return;
    const act = this.canAct() && now >= p.controlLockUntil;
    const slowed = !!p.statuses.slow;
    let speed = RUN_SPEED + Math.min(90, this.combat.stats.AGI * 1.2);
    if (slowed) speed *= 0.5;
    if (p.inSwamp) speed *= 0.6;
    const dir = act ? (h.right ? 1 : 0) - (h.left ? 1 : 0) : 0;

    // blocking: stand still and raise your guard
    const wantBlock = act && h.block && !p.onLadder;
    if (wantBlock && !p.blocking) p.blockStart = now;
    p.blocking = wantBlock;

    // ladders
    const cx = Math.floor(p.x / TILE);
    const midRow = Math.floor((p.y - PLAYER_H / 2) / TILE);
    const feetRow = Math.floor((p.y - 1) / TILE);
    const ladderHere = isLadder(tileAt(this.map, cx, midRow)) || isLadder(tileAt(this.map, cx, feetRow));
    const ladderBelow = isLadder(tileAt(this.map, cx, Math.floor(p.y / TILE) + 1)) && p.onGround;
    if (!p.onLadder && act && !p.blocking) {
      const nearCenter = Math.abs(p.x - (cx * TILE + TILE / 2)) < 22;
      if (nearCenter && ((h.up && ladderHere) || (h.down && p.onGround && ladderBelow))) {
        p.onLadder = true;
        p.x = cx * TILE + TILE / 2;
        p.vx = 0;
        p.vy = 0;
        if (h.down && !ladderHere) p.y += 2;
      }
    }

    if (p.onLadder) {
      p.vx = 0;
      p.vy = act ? ((h.down ? 1 : 0) - (h.up ? 1 : 0)) * CLIMB_SPEED * (slowed ? 0.5 : 1) : 0;
      p.y += p.vy * dt;
      if (p.vy !== 0) p.walkT += dt * 1000;
      if (p.vy > 0 && this.solidAt(cx, Math.floor(p.y / TILE))) {
        // reached the ground
        p.y = Math.floor(p.y / TILE) * TILE;
        p.onLadder = false;
        p.onGround = true;
        return;
      }
      if (!this.ladderAt(cx, p.y)) {
        if (p.vy < 0) {
          // climbed out of the top: stand on the platform
          p.y = (Math.floor((p.y - 1) / TILE) + 1) * TILE;
          p.onGround = true;
        }
        p.onLadder = false;
      }
      return;
    }

    // walking
    const attackingOnGround = p.onGround && now < p.attackUntil;
    if (now >= p.controlLockUntil) p.vx = p.blocking || attackingOnGround || p.castUntil > now ? 0 : dir * speed;
    if (dir !== 0 && now >= p.attackUntil && !p.blocking) p.facing = dir as 1 | -1;
    if (p.vx !== 0 && p.onGround) p.walkT += dt * 1000;

    p.vy = Math.min(MAX_FALL, p.vy + GRAVITY * dt);
    this.moveX(p, p.vx * dt);
    this.moveY(p, p.vy * dt);
    // swamp
    const lowRow = Math.floor((p.y - 8) / TILE);
    p.inSwamp = isSwamp(tileAt(this.map, Math.floor((p.x - 10) / TILE), lowRow)) || isSwamp(tileAt(this.map, Math.floor((p.x + 10) / TILE), lowRow));
    // keep inside the map
    const { w } = mapSize(this.map);
    p.x = Math.max(PLAYER_W / 2, Math.min(w - PLAYER_W / 2, p.x));
  }

  /** Is the player (feet at y) still on a ladder? The platform tile at a ladder's top counts. */
  private ladderAt(col: number, y: number) {
    const feetRow = Math.floor((y - 1) / TILE);
    const t = tileAt(this.map, col, feetRow);
    return isLadder(t) || (isPlatform(t) && isLadder(tileAt(this.map, col, feetRow + 1)));
  }

  private moveX(p: Player, dx: number) {
    if (dx === 0) return;
    const nx = p.x + dx;
    const edge = dx > 0 ? nx + PLAYER_W / 2 : nx - PLAYER_W / 2;
    const col = Math.floor(edge / TILE);
    const r0 = Math.floor((p.y - PLAYER_H + 2) / TILE);
    const r1 = Math.floor((p.y - 2) / TILE);
    for (let r = r0; r <= r1; r++) {
      if (this.solidAt(col, r)) {
        p.x = dx > 0 ? col * TILE - PLAYER_W / 2 - 0.01 : (col + 1) * TILE + PLAYER_W / 2 + 0.01;
        p.vx = 0;
        return;
      }
    }
    p.x = nx;
  }

  private moveY(p: Player, dy: number) {
    const c0 = Math.floor((p.x - PLAYER_W / 2 + 2) / TILE);
    const c1 = Math.floor((p.x + PLAYER_W / 2 - 2) / TILE);
    const ny = p.y + dy;
    p.onGround = false;
    if (dy > 0) {
      const prevRow = Math.floor((p.y - 0.01) / TILE);
      const row = Math.floor(ny / TILE);
      for (let r = prevRow + 1; r <= row; r++) {
        for (let c = c0; c <= c1; c++) {
          const t = tileAt(this.map, c, r);
          const platform = isPlatform(t) && this.now >= p.dropUntil;
          if (this.solidAt(c, r) || platform) {
            p.y = r * TILE;
            p.vy = 0;
            p.onGround = true;
            return;
          }
        }
      }
      p.y = ny;
      return;
    }
    if (dy < 0) {
      const headRow = Math.floor((ny - PLAYER_H) / TILE);
      for (let c = c0; c <= c1; c++) {
        if (this.solidAt(c, headRow)) {
          p.y = (headRow + 1) * TILE + PLAYER_H;
          p.vy = 0;
          return;
        }
      }
      p.y = ny;
    }
  }

  /** What the player could talk to or use right now. */
  nearby(): Nearby | null {
    const p = this.player;
    if (p.dead || p.onLadder) return null;
    const onRow = (row: number) => Math.abs(p.y - row * TILE) < 6;
    for (const portal of this.map.portals) {
      if (portal.kind === "dungeon_exit" && !this.run?.cleared) continue;
      if (Math.abs(p.x - portal.x * TILE) < 80 && onRow(portal.row)) return { kind: "portal", portal };
    }
    for (const npc of this.map.npcs) if (Math.abs(p.x - npc.x * TILE) < 64 && onRow(npc.row)) return { kind: "npc", npc };
    const ground = this.map.id === "thornvale" ? 9 : -1;
    for (const b of this.map.buildings) {
      if (Math.abs(p.x - (b.doorX * TILE + TILE / 2)) < 40 && onRow(ground)) return { kind: "door", building: b };
    }
    for (const s of this.map.signs) if (Math.abs(p.x - s.x * TILE) < 48 && onRow(s.row)) return { kind: "sign", sign: s };
    return null;
  }

  // ---------- presses: jump, skills, potion ----------

  private handlePress(k: Press) {
    const p = this.player;
    if (p.dead) return;
    if (k === "jump") {
      if (!this.canAct() || p.blocking) return;
      if (p.onLadder) {
        const dir = (this.held.right ? 1 : 0) - (this.held.left ? 1 : 0);
        if (dir !== 0) {
          p.onLadder = false;
          p.vy = -JUMP_SPEED * 0.6;
          p.vx = dir * RUN_SPEED;
          p.facing = dir as 1 | -1;
          p.controlLockUntil = this.now + 120;
        }
        return;
      }
      if (!p.onGround) return;
      if (this.held.down && this.onPlatformOnly()) {
        p.dropUntil = this.now + 260;
        p.y += 2;
        p.onGround = false;
        return;
      }
      p.vy = -JUMP_SPEED;
      p.onGround = false;
      return;
    }
    if (k === "potion") return void this.eatBest();
    if (k.startsWith("skill")) return void this.castSkill(Number(k.slice(5)));
  }

  private onPlatformOnly() {
    const p = this.player;
    const row = Math.floor(p.y / TILE);
    const c0 = Math.floor((p.x - PLAYER_W / 2 + 2) / TILE);
    const c1 = Math.floor((p.x + PLAYER_W / 2 - 2) / TILE);
    let platform = false;
    for (let c = c0; c <= c1; c++) {
      if (this.solidAt(c, row)) return false;
      if (isPlatform(tileAt(this.map, c, row))) platform = true;
    }
    return platform;
  }

  /** Eat the best healing food in the bag. */
  eatBest() {
    const p = this.player;
    const food = this.bag
      .filter((b) => b.qty > 0 && ITEMS[b.itemId]?.edible)
      .sort((a, b) => (ITEMS[b.itemId].heal ?? 0) - (ITEMS[a.itemId].heal ?? 0))[0];
    if (!food) return this.events.toast("No food in your bag.");
    if (p.hp >= p.maxHp) return this.events.toast("You're already at full HP.");
    food.qty--;
    const item = ITEMS[food.itemId];
    const heal = Math.min(p.maxHp - p.hp, item.heal ?? 0);
    p.hp += heal;
    this.acc.itemsUsed.push(item.id);
    this.acc.dirty = true;
    this.text(p.x, p.y - PLAYER_H - 10, `+${heal}`, "#5fd36a", 26);
    this.fxAdd("heal", p.x, p.y - PLAYER_H / 2, 40, 600, "#5fd36a");
  }

  get skillSlots() {
    return this.combat.skills.slice(0, 4);
  }

  skillState(i: number): { ready: boolean; cdLeft: number; cdTotal: number; enoughMp: boolean } | null {
    const s = this.skillSlots[i];
    if (!s) return null;
    const ready = this.player.skillReady[s.id] ?? 0;
    const total = s.usesPerBattle ? 15000 : 1500;
    return {
      ready: this.now >= ready && this.now >= this.player.globalReady,
      cdLeft: Math.max(0, ready - this.now),
      cdTotal: total,
      enoughMp: this.player.mp >= (s.active.mp_cost ?? 0),
    };
  }

  private castSkill(i: number) {
    const s = this.skillSlots[i];
    const p = this.player;
    if (!s || !this.canAct() || p.onLadder) return;
    if (p.statuses.silence) return this.events.toast("You're silenced!");
    const a = s.active;
    if ((a.mp_cost ?? 0) > p.mp) return this.events.toast("Not enough MP.");
    if (this.now < (p.skillReady[s.id] ?? 0) || this.now < p.globalReady) return;
    p.mp -= a.mp_cost ?? 0;
    if (a.hp_cost_pct) p.hp = Math.max(1, p.hp - Math.round(p.maxHp * a.hp_cost_pct));
    p.skillReady[s.id] = this.now + (s.usesPerBattle ? 15000 : 1500);
    p.globalReady = this.now + 600;
    p.castStart = this.now;
    p.castUntil = this.now + 420;
    this.acc.skillUses[s.id] = (this.acc.skillUses[s.id] ?? 0) + 1;
    this.acc.dirty = true;
    this.text(p.x, p.y - PLAYER_H - 24, s.name, "#bfe3ff", 18);
    if (a.heal_pct) {
      const heal = Math.min(p.maxHp - p.hp, Math.round(p.maxHp * a.heal_pct));
      p.hp += heal;
      this.text(p.x, p.y - PLAYER_H - 4, `+${heal}`, "#5fd36a", 26);
      this.fxAdd("heal", p.x, p.y - PLAYER_H / 2, 50, 700, "#5fd36a");
    }
    if (a.cleanse) p.statuses = {};
    if (!a.multiplier) return;
    const spec = attackSpec(this.weapon, this.combat, { name: s.name, active: a });
    const feel = WEAPON_FEEL[this.weapon];
    const reachFront = spec.area ? 280 : feel.projectile ? feel.projectile.range : feel.reach + 70;
    const targets = this.monstersInFront(reachFront, spec.area ? 60 : 0, spec.area ? 170 : 110);
    const chosen = spec.area ? targets : targets.slice(0, 1);
    if (spec.area) this.fxAdd("area", p.x + p.facing * 120, p.y - PLAYER_H / 2, 150, 450, "#9fd4ff");
    const counter = this.now < p.counterUntil;
    chosen.forEach((m, j) => {
      for (let k = 0; k < spec.hits; k++) {
        this.pendingHits.push({ at: this.now + 140 + k * 110, uid: m.uid, spec, skillId: s.id, counter: counter && j === 0 && k === 0 });
      }
    });
    if (counter && chosen.length) p.counterUntil = 0;
  }

  /** Alive monsters ahead of the player, nearest first. */
  private monstersInFront(front: number, back: number, height: number): Monster[] {
    const p = this.player;
    const top = p.y - PLAYER_H - height / 2 + PLAYER_H / 2;
    return this.monsters
      .filter((m) => m.state !== "dead")
      .filter((m) => {
        const b = MONSTER_LOOKS[m.id].body;
        const dx = (m.x - p.x) * p.facing;
        const ahead = dx + b.w / 2 >= -back && dx - b.w / 2 <= front;
        const my0 = m.y - b.h;
        const vert = m.y >= top && my0 <= p.y + 10 && m.y >= p.y - PLAYER_H - height / 2 && my0 <= p.y + height / 2;
        return ahead && vert;
      })
      .sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x));
  }

  // ---------- combat ----------

  private updateCombat() {
    const p = this.player;
    const now = this.now;
    // the normal attack: hold to keep swinging
    if (this.held.attack && this.canAct() && !p.blocking && !p.onLadder && now >= p.nextAttackAt && now >= p.castUntil) {
      const feel = WEAPON_FEEL[this.weapon];
      p.attackStart = now;
      p.attackUntil = now + Math.min(feel.interval - 40, 360);
      p.attackResolved = false;
      p.nextAttackAt = now + feel.interval;
    }
    if (!p.attackResolved && now >= p.attackStart + (WEAPON_FEEL[this.weapon].projectile ? 110 : 150)) {
      p.attackResolved = true;
      this.resolveAttack();
    }
    // queued skill hits
    if (this.pendingHits.length) {
      const due = this.pendingHits.filter((h) => now >= h.at);
      this.pendingHits = this.pendingHits.filter((h) => now < h.at);
      for (const h of due) {
        const m = this.monsters.find((x) => x.uid === h.uid);
        if (m && m.state !== "dead") this.hitMonster(m, h.spec, h.skillId, h.counter);
      }
    }
    this.updateProjectiles();
    this.updateMonsters();
    this.updatePlayerStatus();
    this.updateRespawns();
    if (this.run) this.spawnRoom();
  }

  private resolveAttack() {
    const p = this.player;
    const feel = WEAPON_FEEL[this.weapon];
    const spec = attackSpec(this.weapon, this.combat);
    const counter = this.now < p.counterUntil;
    if (counter) p.counterUntil = 0;
    if (feel.projectile) {
      const pr = feel.projectile;
      this.projectiles.push({
        x: p.x + p.facing * 30,
        y: p.y - 46,
        vx: p.facing * pr.speed,
        vy: 0,
        left: pr.range,
        kind: pr.kind,
        fromPlayer: true,
        spec,
        counter,
      });
      return;
    }
    const target = this.monstersInFront(feel.reach + 20, 10, 40)[0];
    const style = WEAPON_STYLE[this.weapon];
    this.fxAdd("slash", p.x + p.facing * (feel.reach / 2 + 10), p.y - 44, feel.reach, 220, style === "swing" ? "#ffffff" : "#ffe9b0");
    // Swings at thin air don't count as attacks; only swings at a monster do.
    if (target) this.hitMonster(target, spec, undefined, counter);
  }

  private defenderOf(m: Monster) {
    const s = MONSTERS[m.id].stats;
    return { VIT: s.VIT, INT: s.INT, AGI: m.statuses.slow ? Math.floor(s.AGI / 2) : s.AGI };
  }

  private hitMonster(m: Monster, spec: AttackSpec, skillId: string | undefined, counter: boolean) {
    const p = this.player;
    const r = rollHit(this.rng, spec, this.combat, this.defenderOf(m), p.hp / p.maxHp);
    let dmg = r.dmg;
    if (!r.miss && counter) dmg = Math.round(dmg * PARRY_COUNTER_MULT);
    const hit: ReportHit = { dmg: r.miss ? 0 : dmg, crit: r.crit, miss: r.miss };
    if (skillId) hit.skillId = skillId;
    if (counter && !r.miss) hit.counter = true;
    this.acc.hits.push(hit);
    this.acc.dirty = true;
    this.engage(m);
    m.fight!.swings++;
    const top = m.y - MONSTER_LOOKS[m.id].body.h;
    if (r.miss) {
      this.text(m.x, top - 8, "MISS", "#c8c8d0", 22);
      return;
    }
    m.hp -= dmg;
    m.fight!.direct += dmg;
    m.flashUntil = this.now + 120;
    m.showHpUntil = this.now + 4000;
    this.text(m.x, top - 8, `${dmg}`, r.crit || counter ? "#ff4f6d" : "#ffb347", r.crit || counter ? 34 : 28, r.crit ? "!" : "");
    this.fxAdd("spark", m.x - p.facing * 6, top + MONSTER_LOOKS[m.id].body.h / 2, 18, 200, r.crit ? "#ff4f6d" : "#ffe08a");
    if (m.state !== "windup" || !MONSTERS[m.id].isBoss) {
      // a little knockback
      const nx = m.x + p.facing * 10;
      m.x = Math.max(m.span[0], Math.min(m.span[1], nx));
    }
    if (spec.status && this.rng() < spec.status.chance) this.addMonsterStatus(m, spec.status.type, spec.status.turns);
    if (m.hp <= 0) this.killMonster(m);
  }

  private engage(m: Monster) {
    m.provoked = true;
    m.aggro = true;
    if (!m.fight) m.fight = { start: this.now, direct: 0, indirect: 0, swings: 0, inSwamp: this.player.inSwamp };
  }

  private addMonsterStatus(m: Monster, type: StatusType, turns: number) {
    const cur = m.statuses[type];
    const until = this.now + turns * TICK_MS;
    if (cur) cur.until = Math.max(cur.until, until);
    else m.statuses[type] = { until, nextTick: this.now + TICK_MS };
    this.text(m.x, m.y - MONSTER_LOOKS[m.id].body.h - 30, type.toUpperCase(), "#c792ff", 16);
  }

  private indirectDamage(m: Monster, dmg: number, label: string, color: string) {
    if (m.state === "dead" || dmg <= 0) return;
    this.engage(m);
    m.hp -= dmg;
    m.fight!.indirect += dmg;
    m.showHpUntil = this.now + 4000;
    this.text(m.x, m.y - MONSTER_LOOKS[m.id].body.h - 8, `${dmg}`, color, 22, label);
    if (m.hp <= 0) this.killMonster(m);
  }

  private killMonster(m: Monster) {
    const p = this.player;
    m.state = "dead";
    m.diedAt = this.now;
    m.hp = 0;
    const f = m.fight ?? { start: this.now, direct: 0, indirect: 0, swings: 0, inSwamp: false };
    if (this.combat.passive.heal_on_win_pct && !p.dead) {
      const heal = Math.min(p.maxHp - p.hp, Math.round(p.maxHp * this.combat.passive.heal_on_win_pct));
      if (heal > 0) {
        p.hp += heal;
        this.text(p.x, p.y - PLAYER_H - 4, `+${heal}`, "#5fd36a", 24);
      }
    }
    this.fxAdd("burst", m.x, m.y - MONSTER_LOOKS[m.id].body.h / 2, 50, 450, "#fff3b0");
    if (m.spawnIndex >= 0) this.spawnTimers.set(m.spawnIndex, this.now + RESPAWN_MS);
    this.emit("kill", {
      monsterId: m.id,
      directToTarget: f.direct,
      indirectToTarget: f.indirect,
      hitsOnTarget: f.swings,
      fightMs: this.now - f.start,
      inSwamp: f.inSwamp,
    });
  }

  private updateRespawns() {
    for (const [i, at] of this.spawnTimers) {
      if (this.now < at) continue;
      this.spawnTimers.delete(i);
      this.monsters = this.monsters.filter((m) => !(m.spawnIndex === i && m.state === "dead"));
      this.spawnField(i);
    }
    // dungeon corpses fade
    this.monsters = this.monsters.filter((m) => !(m.state === "dead" && m.spawnIndex < 0 && this.now - m.diedAt > 1500));
  }

  private updateProjectiles() {
    const dt = 1 / 60;
    for (const pr of this.projectiles) {
      const step = Math.hypot(pr.vx, pr.vy) * dt;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.left -= step;
      if (pr.left <= 0 || this.solidAt(Math.floor(pr.x / TILE), Math.floor(pr.y / TILE))) {
        pr.dead = true;
        continue;
      }
      if (pr.fromPlayer) {
        const m = this.monsters.find((x) => {
          if (x.state === "dead") return false;
          const b = MONSTER_LOOKS[x.id].body;
          return Math.abs(x.x - pr.x) < b.w / 2 + 6 && pr.y <= x.y + 4 && pr.y >= x.y - b.h - 4;
        });
        if (m) {
          pr.dead = true;
          this.hitMonster(m, pr.spec!, pr.skillId, !!pr.counter);
        }
      } else {
        const p = this.player;
        if (!p.dead && Math.abs(p.x - pr.x) < PLAYER_W / 2 + 6 && pr.y <= p.y && pr.y >= p.y - PLAYER_H) {
          pr.dead = true;
          const m = this.monsters.find((x) => x.uid === pr.monsterUid);
          if (m) this.enemyStrikesPlayer(m, pr.attack!);
        }
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  private aiOf(m: Monster) {
    return AI[m.id];
  }

  private updateMonsters() {
    const p = this.player;
    const now = this.now;
    const dt = 1 / 60;
    for (const m of this.monsters) {
      if (m.state === "dead") continue;
      const ai = this.aiOf(m);
      const look = MONSTER_LOOKS[m.id];
      const def = MONSTERS[m.id];
      // statuses tick
      for (const [type, st] of Object.entries(m.statuses) as [StatusType, Status][]) {
        if (now >= st.nextTick) {
          st.nextTick += TICK_MS;
          if (type === "poison") this.indirectDamage(m, Math.max(1, Math.round(m.maxHp * 0.05)), "", "#b77cff");
          if (type === "burn") this.indirectDamage(m, Math.max(1, Math.round(4 + m.maxHp * 0.03)), "", "#ff8a3d");
        }
        if (now >= st.until) delete m.statuses[type];
      }
      if ((m.state as Monster["state"]) === "dead") continue; // poison may have just finished it
      if (m.fight && p.inSwamp) m.fight.inSwamp = true;
      const frozen = !!(m.statuses.stun || m.statuses.freeze);
      const speed = ai.speed * (m.statuses.slow ? 0.5 : 1);
      const dx = p.x - m.x;
      const dy = p.y - m.y;
      const playerHidden = p.dead || now < p.invisibleUntil;

      // who's angry
      if (!m.aggro && !playerHidden && ai.aggressive > 0 && !this.combat.passive.pacifist && Math.abs(dx) < ai.aggressive && Math.abs(dy) < 140) m.aggro = true;
      if (playerHidden && m.spawnIndex >= 0) m.aggro = false;
      if (m.aggro && m.spawnIndex >= 0 && (Math.abs(dx) > 700 || Math.abs(dy) > 260)) m.aggro = false;
      if (this.combat.passive.pacifist && !m.provoked) m.aggro = false;

      if (m.state === "stunned") {
        if (now >= m.stateUntil) m.state = m.aggro ? "chase" : "patrol";
        continue;
      }
      if (frozen) continue;

      if (m.state === "windup") {
        if (now >= m.stateUntil) this.monsterStrike(m);
        continue;
      }
      if (m.state === "recover") {
        if (now < m.dashUntil) {
          m.x = Math.max(m.span[0], Math.min(m.span[1], m.x + m.facing * 420 * dt));
        }
        if (now >= m.stateUntil) m.state = m.aggro ? "chase" : "patrol";
        continue;
      }

      if (m.aggro && !playerHidden) {
        m.state = "chase";
        m.facing = dx >= 0 ? 1 : -1;
        const reach = look.body.w / 2 + PLAYER_W / 2 + ai.range;
        const flying = !!look.flying;
        if (flying) {
          // hover towards the player's chest
          const tx = p.x - m.facing * (reach - 10);
          const ty = p.y - 30;
          m.x += Math.sign(tx - m.x) * Math.min(Math.abs(tx - m.x), speed * dt);
          m.y += Math.sign(ty - m.y) * Math.min(Math.abs(ty - m.y), speed * 0.8 * dt);
          m.x = Math.max(m.span[0], Math.min(m.span[1], m.x));
        } else if (Math.abs(dx) > reach - 6) {
          m.x = Math.max(m.span[0], Math.min(m.span[1], m.x + m.facing * speed * dt));
          m.walkT += dt * 1000;
        }
        const vertOk = flying ? Math.abs(p.y - 30 - m.y) < 70 : Math.abs(dy) < 70;
        const inMelee = Math.abs(dx) <= reach && vertOk;
        if (now >= m.nextAttackAt && !p.dead) {
          const choice = this.pickAttack(m, Math.abs(dx), vertOk, inMelee);
          if (choice) {
            const sp = ai.special?.[choice.name];
            m.attack = choice;
            m.state = "windup";
            m.stateUntil = now + (sp ? sp.windup : ai.windup);
            if (sp) this.text(m.x, m.y - look.body.h - 30, `${choice.name}!`, "#ffd34d", 18);
          }
        }
      } else {
        // wander on its ledge
        m.state = "patrol";
        if (now >= m.patrolUntil) {
          m.patrolUntil = now + 1200 + Math.random() * 2200;
          m.patrolDir = Math.random() < 0.35 ? 0 : Math.random() < 0.5 ? -1 : 1;
        }
        if (m.patrolDir !== 0) {
          m.facing = m.patrolDir;
          const nx = m.x + m.patrolDir * speed * 0.6 * dt;
          if (nx <= m.span[0] || nx >= m.span[1]) m.patrolDir = (m.patrolDir * -1) as 1 | -1;
          m.x = Math.max(m.span[0], Math.min(m.span[1], nx));
          m.walkT += dt * 1000;
        }
        if (look.flying) m.y = m.baseY + Math.sin(now / 400 + m.uid) * 12;
      }
      void def;
    }
  }

  /** Choose an attack the monster can reach from where it is. */
  private pickAttack(m: Monster, dist: number, vertOk: boolean, inMelee: boolean): EnemyAttack | null {
    const def = MONSTERS[m.id];
    const ai = this.aiOf(m);
    const look = MONSTER_LOOKS[m.id];
    let pool = def.attacks.filter((a) => {
      const sp = ai.special?.[a.name];
      if (!sp) return inMelee;
      if (sp.kind === "area") return dist <= sp.range && Math.abs(this.player.y - m.y) < sp.range;
      if (sp.kind === "spit") return dist <= sp.range && vertOk;
      if (sp.kind === "dash") return dist <= sp.range + look.body.w / 2 && vertOk;
      return dist <= look.body.w / 2 + PLAYER_W / 2 + sp.range && vertOk;
    });
    // silenced monsters can't use magic or status attacks
    if (m.statuses.silence) pool = pool.filter((a) => a.element !== "magic" && !a.status);
    if (!pool.length) return null;
    const total = pool.reduce((n, a) => n + a.weight, 0);
    let roll = this.rng() * total;
    return pool.find((a) => (roll -= a.weight) < 0) ?? pool[0];
  }

  /** The end of a wind-up: the blow lands now, or a projectile flies. */
  private monsterStrike(m: Monster) {
    const ai = this.aiOf(m);
    const atk = m.attack!;
    const sp = ai.special?.[atk.name];
    const look = MONSTER_LOOKS[m.id];
    const p = this.player;
    m.state = "recover";
    m.struckAt = this.now;
    m.stateUntil = this.now + ai.recover;
    m.nextAttackAt = this.now + ai.recover + 300 + Math.random() * 600;
    // paralysis: half the time the blow never comes
    if (m.statuses.paralysis && this.rng() < 0.5) {
      this.text(m.x, m.y - look.body.h - 10, "...", "#c8c8d0", 20);
      return;
    }
    if (sp?.kind === "spit") {
      const dir = p.x >= m.x ? 1 : -1;
      this.projectiles.push({ x: m.x + dir * look.body.w * 0.4, y: m.y - look.body.h * 0.6, vx: dir * 520, vy: 0, left: sp.range + 40, kind: "venom", fromPlayer: false, monsterUid: m.uid, attack: atk });
      return;
    }
    if (sp?.kind === "area") {
      this.fxAdd("area", m.x, m.y - look.body.h / 2, sp.range, 500, m.id === "mire_bat" ? "#d9b3ff" : "#8fe36f");
      if (Math.hypot(p.x - m.x, p.y - PLAYER_H / 2 - (m.y - look.body.h / 2)) <= sp.range + PLAYER_W / 2) this.enemyStrikesPlayer(m, atk);
      return;
    }
    let range = ai.range;
    if (sp?.kind === "dash") {
      m.dashUntil = this.now + 260;
      range = sp.range;
    } else if (sp) range = sp.range;
    const dx = (p.x - m.x) * m.facing;
    const reach = look.body.w / 2 + PLAYER_W / 2 + range;
    const vert = look.flying ? Math.abs(p.y - 30 - m.y) < 80 : Math.abs(p.y - m.y) < 80;
    this.fxAdd("slash", m.x + m.facing * (look.body.w / 2 + 20), m.y - look.body.h / 2, 40, 180, "#ff9a9a");
    if (dx > -look.body.w / 2 && dx <= reach && vert) this.enemyStrikesPlayer(m, atk);
  }

  /** A monster's blow reaches the player: parry, block, dodge, or take it. */
  private enemyStrikesPlayer(m: Monster, atk: EnemyAttack) {
    const p = this.player;
    if (p.dead || this.now < p.invulnUntil) return;
    if (this.combat.passive.pacifist && !m.provoked) return;
    this.engage(m);
    const acc = this.acc;
    acc.dirty = true;
    const look = MONSTER_LOOKS[m.id];
    // PARRY: block pressed just before the blow
    if (p.blocking && this.now - p.blockStart <= PARRY_WINDOW_MS) {
      acc.parries++;
      acc.blocks++;
      m.state = "stunned";
      m.stateUntil = this.now + PARRY_STUN_MS * (MONSTERS[m.id].isBoss ? 0.6 : 1);
      p.counterUntil = this.now + 1600;
      p.blockStart = -1e9; // one parry per press
      this.text(p.x, p.y - PLAYER_H - 16, "PARRY!", "#7fe0ff", 30);
      this.fxAdd("parry", p.x + p.facing * 24, p.y - 46, 36, 380, "#7fe0ff");
      return;
    }
    const pAgi = p.statuses.slow ? Math.floor(this.combat.stats.AGI / 2) : this.combat.stats.AGI;
    const es = MONSTERS[m.id].stats;
    const r = rollEnemyHit(this.rng, atk, { STR: es.STR, INT: es.INT, DEX: es.DEX }, { VIT: this.combat.stats.VIT, INT: this.combat.stats.INT, AGI: pAgi }, this.weapon, p.blocking);
    if (r.miss) {
      acc.dodged++;
      this.dodgeStreak++;
      this.dodgeStreakBest = Math.max(this.dodgeStreakBest, this.dodgeStreak);
      this.text(p.x, p.y - PLAYER_H - 10, "MISS", "#c8c8d0", 24);
      if (this.combat.passive.dodge_invisibility) {
        p.invisibleUntil = this.now + this.combat.passive.dodge_invisibility * TICK_MS;
        for (const x of this.monsters) if (x.spawnIndex >= 0) x.aggro = false;
      }
      return;
    }
    this.dodgeStreak = 0;
    if (p.blocking) acc.blocks++;
    acc.blockedDamage += r.blocked;
    if (r.dmg === 0) {
      acc.zeroHits++;
      this.text(p.x, p.y - PLAYER_H - 10, "0", "#c8c8d0", 26);
    } else {
      this.hurtPlayer(r.dmg, "enemy", m);
      if (p.dead) return;
      // knockback
      if (!p.blocking) {
        const away = p.x >= m.x ? 1 : -1;
        p.vx = away * 300;
        p.vy = -320;
        p.onGround = false;
        p.onLadder = false;
        p.controlLockUntil = this.now + 260;
      }
      if (this.combat.passive.reflect_pct > 0) {
        const back = Math.max(1, Math.round(r.dmg * this.combat.passive.reflect_pct));
        this.indirectDamage(m, back, "", "#9be37a");
      }
    }
    if (atk.status) this.addPlayerStatus(atk.status);
    const aura = this.combat.passive.poison_aura;
    if (aura && atk.element === "physical" && !atk.area && m.state !== "dead" && this.rng() < aura.chance) this.addMonsterStatus(m, "poison", aura.turns);
    void look;
  }

  private hurtPlayer(dmg: number, source: "enemy" | "hazard" | "poison" | "burn", m?: Monster) {
    const p = this.player;
    if (dmg <= 0 || p.dead) return;
    p.hp -= dmg;
    this.acc.taken[source] += dmg;
    this.acc.dirty = true;
    if (source === "enemy") {
      p.invulnUntil = this.now + HURT_INVULN_MS;
      p.hurtUntil = this.now + 300;
    }
    this.text(p.x, p.y - PLAYER_H - 10, `${dmg}`, source === "enemy" ? "#b469ff" : source === "hazard" ? "#7fd36a" : "#c792ff", source === "enemy" ? 30 : 22);
    if (p.hp <= 0 && this.combat.passive.revive_once && !p.reviveUsed) {
      p.hp = 1;
      p.reviveUsed = true;
      this.text(p.x, p.y - PLAYER_H - 40, "You refuse to fall!", "#ffd34d", 20);
    }
    this.acc.minHpPct = Math.min(this.acc.minHpPct, Math.max(0, p.hp) / p.maxHp);
    if (p.hp <= 0) this.die(m);
  }

  private addPlayerStatus(spec: { type: StatusType; chance: number; turns: number }) {
    const p = this.player;
    if (this.rng() >= spec.chance) return;
    if (this.combat.immunities.includes(spec.type)) return void this.text(p.x, p.y - PLAYER_H - 34, `Immune to ${spec.type}`, "#bfe3ff", 16);
    if (this.rng() < (this.combat.statusResist[spec.type] ?? 0)) return void this.text(p.x, p.y - PLAYER_H - 34, "Resisted", "#bfe3ff", 16);
    this.acc.statuses.push(spec.type);
    const until = this.now + spec.turns * TICK_MS;
    const cur = p.statuses[spec.type];
    if (cur) cur.until = Math.max(cur.until, until);
    else p.statuses[spec.type] = { until, nextTick: this.now + TICK_MS };
    this.text(p.x, p.y - PLAYER_H - 34, spec.type.toUpperCase(), "#c792ff", 18);
  }

  private updatePlayerStatus() {
    const p = this.player;
    const now = this.now;
    if (p.dead) return;
    for (const [type, st] of Object.entries(p.statuses) as [StatusType, Status][]) {
      if (now >= st.nextTick) {
        st.nextTick += TICK_MS;
        if (type === "poison") this.hurtPlayer(Math.max(1, Math.round(p.maxHp * 0.05 * this.combat.poisonMult)), "poison");
        if (type === "burn") this.hurtPlayer(Math.max(1, Math.round(4 + p.maxHp * 0.03)), "burn");
        if (type === "paralysis" && this.rng() < 0.5) p.pinnedUntil = now + 800;
        if (p.dead) return;
      }
      if (now >= st.until) delete p.statuses[type];
    }
    // the swamp
    const hazard = ZONES[this.map.zoneId].hazard;
    if (p.inSwamp && hazard && !this.combat.passive.hazard_immunity.includes(hazard.id)) {
      if (p.swampNext === 0) p.swampNext = now + TICK_MS;
      if (now >= p.swampNext) {
        p.swampNext = now + TICK_MS;
        this.acc.swampTicks++;
        this.hurtPlayer(hazard.damage, "hazard");
        if (!p.dead && hazard.status) this.addPlayerStatus(hazard.status);
      }
    } else p.swampNext = 0;
    // MP regen from skills
    if (now >= p.regenNext) {
      p.regenNext = now + TICK_MS;
      if (this.combat.passive.mp_regen) p.mp = Math.min(p.maxMp, p.mp + this.combat.passive.mp_regen);
    }
  }

  private die(m?: Monster) {
    const p = this.player;
    p.dead = true;
    p.diedAt = this.now;
    p.hp = 0;
    p.onLadder = false;
    p.blocking = false;
    this.pendingHits = [];
    for (const x of this.monsters) {
      x.aggro = false;
      if (x.state !== "dead") x.state = "patrol";
    }
    this.emit("death", { monsterId: m?.id });
  }

  // ---------- reports ----------

  /** Build a report from everything since the last one and hand it to the page. */
  private emit(type: LiveReport["type"], extra: Partial<LiveReport> = {}) {
    const a = this.acc;
    const p = this.player;
    const r: LiveReport = {
      type,
      zoneId: this.map.zoneId,
      hits: a.hits,
      skillUses: a.skillUses,
      itemsUsed: a.itemsUsed,
      taken: a.taken,
      dodged: a.dodged,
      dodgeStreak: this.dodgeStreak,
      dodgeStreakBest: this.dodgeStreakBest,
      blocks: a.blocks,
      parries: a.parries,
      blockedDamage: a.blockedDamage,
      zeroHits: a.zeroHits,
      statuses: a.statuses,
      swampTicks: a.swampTicks,
      inSwamp: false,
      minHpPct: Math.min(a.minHpPct, Math.max(0, p.hp) / p.maxHp),
      hp: Math.max(0, Math.round(p.hp)),
      mp: Math.max(0, Math.round(p.mp)),
      ...extra,
    };
    this.acc = emptyAcc();
    this.events.report(r);
  }

  /** Anything not yet sent (used before leaving a map, opening the menu, or every few seconds). */
  flush(force = false) {
    if (this.acc.dirty || force || this.acc.hits.length) this.emit("sync");
  }

  get hasUnsent() {
    return this.acc.dirty || this.acc.hits.length > 0;
  }

  get unsentHits() {
    return this.acc.hits.length;
  }

  /** The server's answer to a report. Fixes HP if the server allowed less than we showed. */
  applyServer(sent: LiveReport, r: { hp: number; mp: number; levelUp: boolean; run: Engine["run"] | null }) {
    const p = this.player;
    if (r.hp < sent.hp && !p.dead) p.hp = Math.max(1, p.hp - (sent.hp - r.hp));
    if (r.mp < sent.mp) p.mp = Math.max(0, p.mp - (sent.mp - r.mp));
    if (r.run) this.setRun(r.run);
  }

  /** New numbers from the server (after levelling up, resting, spending points, changing skills). */
  setStats(c: CombatInfo, weapon: WeaponType, maxHp: number, maxMp: number, hp?: number, mp?: number, bag?: Engine["bag"]) {
    this.combat = c;
    this.weapon = weapon;
    const p = this.player;
    p.maxHp = maxHp;
    p.maxMp = maxMp;
    if (hp !== undefined) p.hp = Math.min(maxHp, hp);
    if (mp !== undefined) p.mp = Math.min(maxMp, mp);
    p.hp = Math.min(p.hp, maxHp);
    p.mp = Math.min(p.mp, maxMp);
    if (bag) this.bag = bag.map((b) => ({ ...b }));
  }

  /** Wake up somewhere (after falling in a fight). */
  respawn(mapId: SideMapId, x: number, row: number, hp: number, mp: number) {
    this.setMap(mapId, x, row, null);
    this.player.hp = hp;
    this.player.mp = mp;
  }

  // ---------- effects ----------

  private text(x: number, y: number, text: string, color: string, size: number, suffix = "") {
    // stack numbers that pop at the same spot
    const near = this.texts.filter((t) => Math.abs(t.x - x) < 30 && this.now - t.born < 250).length;
    this.texts.push({ x, y: y - near * 26, text: text + suffix, color, size, born: this.now, life: 1000 });
  }

  private fxAdd(kind: Fx["kind"], x: number, y: number, r: number, life: number, color: string) {
    this.fx.push({ kind, x, y, r, born: this.now, life, facing: this.player.facing, color });
  }
}

export { WEAPONS };
