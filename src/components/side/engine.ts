// The live side-view game: movement, ladders, monsters, real-time combat and parry.
// No drawing and no React here. The page drives it with update() and reads its state.

import { sfx } from "@/lib/sound";
import { WEAPONS } from "@/lib/game/constants";
import { ITEMS, MONSTERS, ZONES, type EnemyAttack } from "@/lib/game/data/world";
import {
  PARRY_COUNTER_MULT,
  CHARGE_FULL,
  CHARGE_MIN_SHARE,
  PARRY_STUN_MS,
  PARRY_WINDOW_MS,
  TICK_MS,
  attackSpec,
  rollEnemyHit,
  rollHit,
  streakMult,
  withDuelist,
  type AttackSpec,
  type BossTally,
  type HitMods,
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
import { damageFormula } from "@/lib/game/combat";
import type { ActiveEffect, PassiveEffect, StatKey, StatusType, WeaponType } from "@/lib/game/types";
import { MONSTER_LOOKS } from "./sprites";
import { PET_ATTACK_MS, TAME_CONDITIONS, TAME_HP_SHARE } from "@/lib/game/pets";
import { WEAPON_STYLE } from "./hero";

// ---------- tuning (feel) ----------
const GRAVITY = 2600;
const JUMP_SPEED = 960;
const RUN_SPEED = 270;
const CLIMB_SPEED = 210;
const MAX_FALL = 1300;
// Hundred Cuts reach: enemies "next to" the target, and "on screen".
const ADJACENT_REACH = 120;
const SCREEN_REACH_X = 680;
const SCREEN_REACH_Y = 400;
// Eye of the Storm strikes enemies this close around you.
const STORM_REACH = 260;
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

/** How long a skill waits before it can be used again. */
const cooldownMs = (s: { active: ActiveEffect; usesPerBattle: number | null }) =>
  s.active.cooldown_s ? s.active.cooldown_s * 1000 : s.usesPerBattle ? 15000 : 1500;

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
  } & Omit<PassiveEffect, keyof Attacker["passive"] | "reflect_pct" | "mp_regen" | "heal_on_win_pct" | "hazard_immunity" | "dodge_invisibility" | "pacifist" | "poison_aura" | "revive_once">;
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
  poisonFrom: string; // who poisoned you last (a monster id, or "" for the swamp or food)
  invisibleUntil: number;
  skillReady: Record<string, number>;
  globalReady: number;
  inSwamp: boolean;
  swampNext: number;
  regenNext: number;
  walkT: number;
  shield: number; // Soul Drain: HP beyond your max, soaks damage first
  runDist: number; // lance: how far you've run in one direction without stopping
  runDir: 0 | 1 | -1;
  runAt: number; // last time you were running
  chargeRun: number; // the run-up behind the attack in progress
  airAttack: boolean; // the attack in progress started in the air
  diving: boolean; // Sky Lance: falling fast toward a crash
}

export interface Monster {
  uid: number;
  /** Wolf's Scars: 1, or less while it is slowed inside your aura. */
  scarSlow?: number;
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
  fight: { start: number; direct: number; indirect: number; swings: number; inSwamp: boolean; pet: number } | null;
  struckAt: number; // when its last blow landed (for the strike pose)
  bleed: number; // Thousand Needles stacks
  bleedNext: number;
  defDown: number; // Armor Crusher: share of defense knocked off
  lastSkill?: string; // the skill behind the last hit it took
  escaped?: boolean; // you got away from it once (counted for Shadow Walk)
  lastCast?: number; // the spell cast behind the last magic hit it took
  lastZeroMp?: boolean; // that cast took your MP to exactly 0
  lastCharge?: number; // the last hit was a lance charge (share of a full run)
  lastAir?: boolean; // the last hit was a lance attack made in the air
  lastPet?: boolean; // the last hit was your pet's
  lastPetId?: string; // ...and which pet
  tame?: TameState; // progress toward its species' hidden taming condition, this fight
  foreseen?: EnemyAttack; // Beast Tongue: the attack it will use next, shown early
}

/** What happened in one monster's fight that its taming condition cares about. */
export interface TameState {
  ate: boolean; // you ate while it was next to you (Green Slime)
  hornRun: number; // its Horn Charges dodged in a row (Horned Rabbit)
  swampVenom: boolean; // its Venom Spit poisoned you in the swamp (Bog Toad)
  crowd: boolean; // another monster joined the fight (Thorn Wolf)
  items: boolean; // you ate during the fight (Thorn Wolf)
  otherWeapon: boolean; // you held something other than the tamer wand (Thorn Wolf)
  silencedAt: number; // its Screech silenced you, until this time (Mire Bat)
  fistBlocks: number; // its Crushing Fists you blocked (Moss Golem)
  hinted: boolean; // the "almost" hint was shown
  told: boolean; // the "not yet" hint was shown
}

/** Your pet that's out: it follows you and bites what you fight. */
export interface PetUnit {
  id: string;
  species: string;
  attacker: Attacker;
  x: number;
  y: number;
  facing: 1 | -1;
  nextAt: number;
  walkT: number;
  moving: boolean;
  struckAt: number;
  giantUntil?: number; // Primal Bond: it's giant until then
}

/** A Phantom Legion shadow clone. */
export interface Clone {
  x: number;
  y: number;
  facing: 1 | -1;
  until: number;
  nextAt: number;
}

/** One fight: from the first monster on you until none has been for a while. */
interface FightState {
  start: number;
  maxFoes: number;
  lastActive: number;
  kills: number;
  items: boolean;
  firstShotAt: number | null;
  dodgeRun: number; // dodges in a row this fight (Phantom Legion's unlock)
  phantomCounted: boolean;
  stolen: number[]; // Spell Thief: monsters whose spell you already took this fight
  graceUsed: boolean; // Grace Rebound fired this fight
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
  range?: number; // how far it could fly when shot
  monsterUid?: number;
  attack?: EnemyAttack;
  dead?: boolean;
  castId?: number; // a spell shot's cast number
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
  | { kind: "tame"; monster: Monster }
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
  swampMs: 0,
  minHpPct: 1,
  hitsTaken: 0,
  guardStored: 0,
  boss: { hits: 0, parries: 0, parryDmg: 0, dodges: 0, weaponHits: 0, dmg: 0, mp: 0, healed: 0, charges: 0, petHits: 0 } as BossTally,
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
  spellsTaken: 0,
  spellsAbsorbed: 0,
  lowHpHeals: 0,
  healed: 0,
  drained: 0,
  bloodUses: {} as Record<string, number>,
  dirty: false,
});

/** A fight: from the first monster on you until none has been for a while. */
const FIGHT_END_MS = 5000;
/** Sky Lance: most monsters one crash can hit. */
const SKY_LANCE_TARGETS = 10;
/** A lance run-up survives a pause this short (letting go of the arrow to attack). */
const RUN_GRACE_MS = 200;

/** Extra facts about one hit you make. */
interface HitOpts {
  castId?: number; // the spell cast it came from
  blood?: boolean; // Blood Sorcery cast
  chain?: boolean; // Chain Catastrophe explosion
  charge?: number; // lance charge, as a share of a full run
  air?: boolean; // lance attack made in the air
}
/** Eye of the Storm's unlock counts fights with this many monsters on you at once. */
export const STORM_FOES = 10;

export interface BossFight {
  uid: number; // the boss
  hits: number; // boss attacks survived
  parries: number; // boss attacks parried
  dodges: number; // boss attacks dodged
  weaponHits: number; // your hits that landed on it
  mp: number; // MP you spent on skills
  healed: number; // HP you healed or drained
  charges: number; // lance charges that hit it
  petHits: number; // your pet's bites that landed on it
  others: boolean; // another monster joined in
  items: boolean; // you ate something
  gauges: Record<string, { base: number; half: boolean }>;
}

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
  /** The weapon in hand is the Horn Rabbit one (only changes how it looks; its STR is already in the stats). */
  horn = false;
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
  private pendingHits: { at: number; uid: number; spec: AttackSpec; skillId: string; counter: boolean; castId: number; blood: boolean }[] = [];
  /** Landed hits in a row without being hit (Hundred Cuts). */
  hitStreak = 0;
  /** Parries in a row without being hit (Blade Read). */
  parryChain = 0;
  private bladeReady = false;
  /** Damage stored by Vengeance Vault. */
  vaultStore = 0;
  private waveId = 1;
  private fight: FightState | null = null;
  clones: Clone[] = [];
  pets: PetUnit[] = [];
  /** The first pet out (most players have one). */
  get pet(): PetUnit | null {
    return this.pets[0] ?? null;
  }
  /** Silent Finish: stealth kills in a row. */
  stealthChain = 0;
  /** Seven Strikes: hits in the current combo. */
  private combo = 0;
  private comboAt = 0;
  /** Marked Prey: the marked monster, and hits in a row on it. */
  markedUid: number | null = null;
  private markRun = 0;
  bossFight: BossFight | null = null;
  /** Each spell cast (skill or staff shot) gets a number, so kills can be traced to it. */
  private castSeq = 0;
  private drainCarry = 0;
  private zeroCasts = new Set<number>();

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
      poisonFrom: "",
      invisibleUntil: 0,
      skillReady: {},
      globalReady: 0,
      inSwamp: false,
      swampNext: 0,
      regenNext: this.now + TICK_MS,
      walkT: 0,
      shield: 0,
      runDist: 0,
      runDir: 0,
      runAt: 0,
      chargeRun: 0,
      airAttack: false,
      diving: false,
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
    this.clones = [];
    this.pets.forEach((pt, i) => Object.assign(pt, { x: p.x - 50 - i * 40, y: p.y, nextAt: 0 }));
    this.spawnTimers.clear();
    this.endFight(false);
    this.spawnAll();
  }

  /** Send a pet out beside you (null: none). */
  setPet(info: { id?: string; species: string; attacker: Attacker } | null) {
    this.setPets(info ? [{ id: info.id ?? "pet", species: info.species, attacker: info.attacker }] : []);
  }

  /** The pets out beside you: ones already out keep their place. */
  setPets(list: { id: string; species: string; attacker: Attacker }[]) {
    const p = this.player;
    this.pets = list.map((info, i) => {
      const had = this.pets.find((x) => x.id === info.id && x.species === info.species);
      if (had) return Object.assign(had, { attacker: info.attacker });
      return { id: info.id, species: info.species, attacker: info.attacker, x: p.x - p.facing * (50 + i * 40), y: p.y, facing: p.facing, nextAt: 0, walkT: 0, moving: false, struckAt: -1e9 };
    });
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
      bleed: 0,
      bleedNext: 0,
      defDown: 0,
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
    this.updateCombat(Math.min(dtMs, 60));
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
    if (!wantBlock && p.blocking) {
      p.blocking = false;
      this.releaseVault();
    }
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
      p.diving = false;
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
    if (p.vx !== 0 && p.onGround) {
      const before = Math.floor(p.walkT / 300);
      p.walkT += dt * 1000;
      if (Math.floor(p.walkT / 300) !== before) sfx("step");
    }

    p.vy = Math.min(MAX_FALL, p.vy + GRAVITY * dt);
    const x0 = p.x;
    const grounded = p.onGround;
    this.moveX(p, p.vx * dt);
    // lance: how far you've actually run in one direction (a long run-up turns the next attack into a charge)
    if (this.weapon === "lance") {
      const moved = p.x - x0;
      const d = moved > 0.01 ? 1 : moved < -0.01 ? -1 : 0;
      if (d !== 0 && grounded) {
        if (d !== p.runDir) p.runDist = 0;
        p.runDir = d;
        p.runDist += Math.abs(moved);
        p.runAt = now;
      } else if (grounded && now - p.runAt > RUN_GRACE_MS && now >= p.attackUntil) {
        // stopped for a moment: the run-up is lost
        p.runDist = 0;
        p.runDir = 0;
      }
    } else p.runDist = 0;
    this.moveY(p, p.vy * dt);
    if (p.diving && p.onGround) {
      p.diving = false;
      this.crash();
    }
    // swamp
    const lowRow = Math.floor((p.y - 8) / TILE);
    p.inSwamp = isSwamp(tileAt(this.map, Math.floor((p.x - 10) / TILE), lowRow)) || isSwamp(tileAt(this.map, Math.floor((p.x + 10) / TILE), lowRow));
    if (p.inSwamp) {
      // time in the swamp (a boss egg you carry hatches from it): sent every few seconds
      const before = this.acc.swampMs;
      this.acc.swampMs += dt * 1000;
      if (Math.floor(this.acc.swampMs / 5000) > Math.floor(before / 5000)) this.acc.dirty = true;
    }
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
    const t = this.tameTarget();
    if (t) return { kind: "tame", monster: t };
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
      sfx("jump");
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
    this.acc.itemsUsed.push(item.id);
    const heal = this.healPlayer(item.heal ?? 0, "food");
    sfx("eat");
    this.acc.dirty = true;
    if (this.bossFight) this.bossFight.items = true;
    if (this.fight) this.fight.items = true;
    for (const m of this.monsters) {
      if (m.state === "dead" || !m.fight) continue;
      const t = this.tameOf(m);
      t.items = true;
      if (Math.abs(m.x - p.x) < 160 && Math.abs(m.y - p.y) < 120) t.ate = true;
    }
    this.text(p.x, p.y - PLAYER_H - 10, `+${heal}`, "#5fd36a", 26);
    this.fxAdd("heal", p.x, p.y - PLAYER_H / 2, 40, 600, "#5fd36a");
  }

  get skillSlots() {
    return this.combat.skills.slice(0, 4);
  }

  skillState(i: number): { ready: boolean; cdLeft: number; cdTotal: number; enoughMp: boolean; gauge?: { value: number; tier: number; next: number | null } } | null {
    const s = this.skillSlots[i];
    if (!s) return null;
    const ready = this.player.skillReady[s.id] ?? 0;
    const total = cooldownMs(s);
    const gauge = s.active.ultimate ? this.gauge(s.id, s.active) : undefined;
    return {
      ready: this.now >= ready && this.now >= this.player.globalReady && (!gauge || gauge.tier > 0),
      cdLeft: Math.max(0, ready - this.now),
      cdTotal: total,
      enoughMp: this.player.mp >= (s.active.mp_cost ?? 0),
      gauge,
    };
  }

  /** An ultimate's gauge in the boss fight going on (0 outside one), and the best tier it can fire at now. */
  gauge(id: string, a: ActiveEffect): { value: number; tier: number; next: number | null } {
    const u = a.ultimate!;
    const bf = this.bossFight;
    if (!bf) return { value: 0, tier: 0, next: u.tiers[0] };
    const g = bf.gauges[id] ?? { base: 0, half: false };
    const value = this.gaugeSource(u.gauge) - g.base;
    let tier = 0;
    for (let t = 3; t >= 1; t--) {
      if (value >= u.tiers[t - 1] && !(t === 1 && g.half)) {
        tier = t;
        break;
      }
    }
    const next = u.tiers.find((x, k) => x > value && !(k === 0 && g.half)) ?? null;
    return { value, tier, next };
  }

  private gaugeSource(g: NonNullable<ActiveEffect["ultimate"]>["gauge"]) {
    const bf = this.bossFight;
    if (!bf) return 0;
    return {
      boss_hits: bf.hits,
      boss_parries: bf.parries,
      boss_dodges: bf.dodges,
      boss_weapon_hits: bf.weaponHits,
      boss_mp_spent: bf.mp,
      boss_healed: bf.healed,
      boss_charges: bf.charges,
      boss_pet_hits: bf.petHits,
    }[g];
  }

  /** Fire an ultimate at the boss: 50% of its HP at the first tier, a full kill above. */
  private fireUltimate(s: { id: string; name: string; active: ActiveEffect }) {
    const p = this.player;
    const bf = this.bossFight;
    const boss = bf && this.monsters.find((m) => m.uid === bf.uid && m.state !== "dead");
    if (!bf || !boss) return void this.events.toast(`${s.name} only works in a boss fight.`);
    const { tier, next } = this.gauge(s.id, s.active);
    if (tier === 0) return void this.events.toast(next ? `${s.name} isn't charged yet (${next} needed).` : `${s.name} is spent for this fight.`);
    const u = s.active.ultimate!;
    // Primal Bond: your pet strikes, so it has to be out
    const giant = u.gauge === "boss_pet_hits" ? this.pet : null;
    if (u.gauge === "boss_pet_hits" && !giant) return void this.events.toast(`${s.name} needs your pet out.`);
    if (this.now < (p.skillReady[s.id] ?? 0) || this.now < p.globalReady) return;
    p.skillReady[s.id] = this.now + 1500;
    p.globalReady = this.now + 600;
    p.castStart = this.now;
    p.castUntil = this.now + 420;
    this.acc.skillUses[s.id] = (this.acc.skillUses[s.id] ?? 0) + 1;
    this.acc.dirty = true;
    if (tier === 1) bf.gauges[s.id] = { base: this.gaugeSource(u.gauge), half: true };
    const dmg = tier === 1 ? Math.min(Math.ceil(boss.maxHp * 0.5), Math.ceil(boss.hp)) : Math.ceil(boss.hp);
    this.text(p.x, p.y - PLAYER_H - 30, `${s.name.toUpperCase()}!`, "#ffd34d", 30);
    if (giant) {
      // your pet turns giant beside the boss and strikes
      const side = p.x <= boss.x ? -1 : 1;
      giant.x = boss.x + side * (MONSTER_LOOKS[boss.id].body.w / 2 + 40);
      giant.y = boss.y;
      giant.facing = side === -1 ? 1 : -1;
      giant.struckAt = this.now;
      giant.giantUntil = this.now + 1200;
      giant.nextAt = this.now + 1200;
    }
    this.fxAdd("area", boss.x, boss.y - MONSTER_LOOKS[boss.id].body.h / 2, 160, 700, "#ffd34d");
    if (tier === 3 && u.field) {
      // the top tier also finishes every other monster on screen
      for (const m of this.monsters) {
        if (m === boss || m.state === "dead" || Math.abs(m.x - p.x) > SCREEN_REACH_X || Math.abs(m.y - p.y) > SCREEN_REACH_Y) continue;
        this.fxAdd("burst", m.x, m.y - MONSTER_LOOKS[m.id].body.h / 2, 60, 600, "#ffd34d");
        this.applyHit(m, { skillId: s.id, dmg: Math.ceil(m.hp), crit: true, miss: false, ult: 3 });
      }
    }
    this.applyHit(boss, { skillId: s.id, dmg, crit: true, miss: false, ult: tier as 1 | 2 | 3 });
  }

  private castSkill(i: number) {
    const s = this.skillSlots[i];
    const p = this.player;
    if (!s || !this.canAct() || p.onLadder) return;
    if (p.statuses.silence) return this.events.toast("You're silenced!");
    if (s.active.ultimate) return this.fireUltimate(s);
    const a = s.active;
    const cost = a.mp_cost ?? 0;
    const bs = this.combat.passive.blood_sorcery;
    // Blood Sorcery: at 0 MP, an attack skill is paid with HP instead
    const blood = cost > p.mp && !!bs && p.mp < 1 && !!a.multiplier;
    if (cost > p.mp && !blood) return this.events.toast("Not enough MP.");
    if (this.now < (p.skillReady[s.id] ?? 0) || this.now < p.globalReady) return;
    const castId = ++this.castSeq;
    sfx("cast");
    if (blood) {
      const hpCost = Math.ceil(p.maxHp * bs!.hp_per_mp * cost);
      if (p.hp <= hpCost) return this.events.toast("Not enough HP to cast with blood.");
      p.hp -= hpCost;
      this.acc.bloodUses[s.id] = (this.acc.bloodUses[s.id] ?? 0) + 1;
      this.text(p.x, p.y - PLAYER_H - 48, "BLOOD SORCERY", "#ff3b5c", 18);
    } else {
      p.mp -= cost;
      if (cost > 0 && Math.round(p.mp) === 0) this.zeroCasts.add(castId);
      if (cost > 0 && this.bossFight) {
        this.bossFight.mp += cost;
        this.acc.boss.mp += cost;
      }
    }
    if (a.hp_cost_pct) p.hp = Math.max(1, p.hp - Math.round(p.maxHp * a.hp_cost_pct));
    p.skillReady[s.id] = this.now + cooldownMs(s);
    p.globalReady = this.now + 600;
    p.castStart = this.now;
    p.castUntil = this.now + 420;
    this.acc.skillUses[s.id] = (this.acc.skillUses[s.id] ?? 0) + 1;
    this.acc.dirty = true;
    this.text(p.x, p.y - PLAYER_H - 24, s.name, "#bfe3ff", 18);
    if (a.shadow_walk) {
      // vanish, then appear behind the nearest monster you can see
      const target = this.monsters
        .filter((m) => m.state !== "dead" && Math.abs(m.x - p.x) < 640 && Math.abs(m.y - p.y) < 300)
        .sort((x, y) => Math.abs(x.x - p.x) - Math.abs(y.x - p.x))[0];
      this.hide(a.shadow_walk.invisible_s * 1000);
      if (target) {
        const behind = -target.facing;
        p.x = Math.max(target.span[0] - 200, Math.min(target.span[1] + 200, target.x + behind * (MONSTER_LOOKS[target.id].body.w / 2 + 30)));
        p.y = target.y;
        p.vy = 0;
        p.facing = (target.x >= p.x ? 1 : -1) as 1 | -1;
      }
      this.fxAdd("burst", p.x, p.y - PLAYER_H / 2, 40, 400, "#8a7bff");
    }
    // Quake Slam: Ground Slam knocks down everything nearby
    const qs = this.combat.passive.quake_slam;
    if (qs && s.id === "ground_slam") {
      this.fxAdd("area", p.x, p.y - 10, qs.reach, 500, "#d9a85b");
      for (const m of this.monsters) {
        if (m.state === "dead" || Math.abs(m.x - p.x) > qs.reach || Math.abs(m.y - p.y) > 160) continue;
        m.state = "stunned";
        m.stateUntil = this.now + qs.stun_ms + (this.combat.passive.ringing_blow?.extra_ms ?? 0);
        this.acc.stunsDealt++;
        this.engage(m);
      }
    }
    if (a.heal_pct) {
      const heal = this.healPlayer(Math.round(p.maxHp * a.heal_pct), "skill");
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
        this.pendingHits.push({ at: this.now + 140 + k * 110, uid: m.uid, spec, skillId: s.id, counter: counter && j === 0 && k === 0, castId, blood });
      }
    });
    if (counter && chosen.length) p.counterUntil = 0;
  }

  /** Alive monsters ahead of the player, nearest first. */
  /**
   * Where a shot should fly: the middle of the nearest live monster in front of you
   * that the shot can reach in a straight line (no walls or floors in the way).
   * Monsters below or above you count, as long as the shot doesn't have to go
   * steeper than about 60 degrees. Null when there is nothing to aim at.
   */
  private aimAt(x: number, y: number, range: number): { x: number; y: number } | null {
    const p = this.player;
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const m of this.monsters) {
      if (m.state === "dead") continue;
      const b = MONSTER_LOOKS[m.id].body;
      const tx = m.x;
      const ty = m.y - b.h / 2;
      const dx = (tx - x) * p.facing;
      if (dx < -b.w / 2) continue; // behind you
      const dy = ty - y;
      if (Math.abs(dy) > Math.max(dx, 0) * 1.8 + 40) continue; // too steep
      const d = Math.hypot(tx - x, dy);
      if (d > range || d >= bestD) continue;
      if (!this.clearShot(x, y, tx, ty)) continue;
      best = { x: tx, y: ty };
      bestD = d;
    }
    return best;
  }

  /** True when nothing solid sits on the straight line between two points. */
  private clearShot(x0: number, y0: number, x1: number, y1: number): boolean {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (TILE / 4));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.solidAt(Math.floor((x0 + (x1 - x0) * t) / TILE), Math.floor((y0 + (y1 - y0) * t) / TILE))) return false;
    }
    return true;
  }

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

  private updateCombat(dtMs: number) {
    const p = this.player;
    const now = this.now;
    // the normal attack: hold to keep swinging
    if (this.held.attack && this.canAct() && !p.blocking && !p.onLadder && now >= p.nextAttackAt && now >= p.castUntil) {
      const feel = WEAPON_FEEL[this.weapon];
      p.attackStart = now;
      p.attackUntil = now + Math.min(feel.interval - 40, 360);
      p.attackResolved = false;
      sfx(feel.projectile ? "shoot" : "swing");
      // a lance attack after a long run is a charge; one in the air is a jump attack
      p.chargeRun = this.weapon === "lance" && p.onGround ? p.runDist : 0;
      p.runDist = 0;
      p.airAttack = !p.onGround;
      if (p.airAttack && this.combat.passive.sky_lance && !p.onLadder) {
        p.diving = true;
        p.vy = MAX_FALL;
      }
      const dm = this.combat.passive.dead_mans_hand;
      p.nextAttackAt = now + (dm && p.hp / p.maxHp < dm.below ? feel.interval / dm.rate : feel.interval);
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
        if (m && m.state !== "dead") this.hitMonster(m, h.spec, h.skillId, h.counter, 1, { castId: h.castId, blood: h.blood });
      }
    }
    this.updateProjectiles();
    this.updateMonsters();
    this.updatePlayerStatus();
    this.updateRespawns();
    this.updateClones();
    this.pets.forEach((pt, i) => this.updatePet(pt, i, dtMs));
    this.tameHints();
    this.updateFight();
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
      const range = pr.range * (this.combat.passive.hawk_line?.range ?? 1);
      const x = p.x + p.facing * 30;
      const y = p.y - 46;
      // Aim at the nearest monster in front, even one lower or higher than you
      const aim = this.aimAt(x, y, range);
      const len = aim ? Math.hypot(aim.x - x, aim.y - y) || 1 : 1;
      this.projectiles.push({
        x,
        y,
        vx: aim ? ((aim.x - x) / len) * pr.speed : p.facing * pr.speed,
        vy: aim ? ((aim.y - y) / len) * pr.speed : 0,
        left: range,
        range,
        kind: pr.kind,
        fromPlayer: true,
        spec,
        counter,
        castId: spec.element === "magic" ? ++this.castSeq : undefined,
      });
      return;
    }
    const target = this.monstersInFront(feel.reach + 20, 10, 40)[0];
    const style = WEAPON_STYLE[this.weapon];
    this.fxAdd("slash", p.x + p.facing * (feel.reach / 2 + 10), p.y - 44, feel.reach, 220, style === "swing" ? "#ffffff" : "#ffe9b0");
    // Swings at thin air don't count as attacks; only swings at a monster do.
    if (!target) return;
    const run = this.hitStreak;
    const share = this.weapon === "lance" ? Math.min(1, p.chargeRun / CHARGE_FULL) : 0;
    const charge = share >= CHARGE_MIN_SHARE ? share : undefined;
    if (charge) this.text(p.x, p.y - PLAYER_H - 30, share >= 1 ? "COMET CHARGE!" : "CHARGE!", "#ffb347", share >= 1 ? 22 : 18);
    this.hitMonster(target, spec, undefined, counter, 1, { charge, air: this.weapon === "lance" && p.airAttack });
    // Hundred Cuts: a long run of hits also cuts the enemies next to the target, then everything on screen.
    const hc = this.combat.passive.hundred_cuts;
    if (!hc || run < hc.adjacent_at) return;
    const extra = this.monsters.filter((m) => {
      if (m === target || m.state === "dead") return false;
      if (run >= hc.screen_at) return Math.abs(m.x - p.x) <= SCREEN_REACH_X && Math.abs(m.y - p.y) <= SCREEN_REACH_Y;
      return Math.abs(m.x - target.x) <= ADJACENT_REACH && Math.abs(m.y - target.y) <= 90;
    });
    for (const m of extra) this.hitMonster(m, spec, undefined, false);
  }

  private defenderOf(m: Monster) {
    const s = MONSTERS[m.id].stats;
    return { VIT: s.VIT, INT: s.INT, AGI: m.statuses.slow ? Math.floor(s.AGI / 2) : s.AGI };
  }

  /** How many monsters are fighting you right now. */
  private foesOnYou() {
    return this.monsters.filter((m) => m.state !== "dead" && m.aggro).length;
  }

  /** A swing or skill hit you made: rolls it with your skills' bonuses, then lands it. */
  private hitMonster(m: Monster, spec: AttackSpec, skillId: string | undefined, counter: boolean, extraMult = 1, opts: HitOpts = {}) {
    const p = this.player;
    const ps = this.combat.passive;
    const isBoss = !!MONSTERS[m.id].isBoss;
    const attacker = withDuelist(this.combat, this.foesOnYou() <= 1);
    const mods: HitMods = { mult: extraMult };
    // Blood Sorcery and Comet Charge
    if (opts.blood && ps.blood_sorcery) mods.mult! *= ps.blood_sorcery.mult;
    if (opts.charge !== undefined && ps.comet_charge) mods.mult! *= 1 + (ps.comet_charge.max_mult - 1) * opts.charge;
    let execute = false;
    // Silent Finish: the first hit on a monster that hasn't noticed you
    const sf = ps.silent_finish;
    const stealth = sf && !isBoss && !m.aggro && !m.provoked ? Math.min(sf.chain_max, sf.mult + this.stealthChain) : 0;
    if (stealth) mods.mult! *= stealth;
    // Blade Read: the hit after a parry
    if (this.bladeReady && ps.blade_read) {
      this.bladeReady = false;
      mods.sure = true;
      mods.crit = true;
      if (this.parryChain >= ps.blade_read.pierce_at) mods.ignoreDef = true;
      if (this.parryChain >= ps.blade_read.execute_at && !isBoss) {
        execute = true;
        this.parryChain = 0;
      }
    }
    // Quick Draw: the first shot of the fight
    const f = this.ensureFight();
    if (f.firstShotAt === null) {
      f.firstShotAt = this.now;
      if (ps.quick_draw) mods.crit = true;
    }
    // Marked Prey: never miss the marked target
    if (ps.marked_prey && this.markedUid === m.uid) mods.sure = true;
    // Armor Crusher and Ringing Blow
    if (ps.armor_crusher) mods.defMult = 1 - m.defDown;
    if (ps.ringing_blow && (m.state === "stunned" || m.statuses.stun)) mods.mult! *= ps.ringing_blow.dmg_mult;
    // Seven Strikes: the 7th hit of a fists combo
    const fists = WEAPONS[this.weapon].fists;
    if (fists && this.now - this.comboAt > (ps.seven_strikes?.gap_ms ?? 1000)) this.combo = 0;
    const seventh = fists && this.combo + 1 === (ps.seven_strikes?.every ?? 7);
    if (seventh && ps.seven_strikes) mods.mult! *= ps.seven_strikes.mult;
    const run = this.hitStreak;
    if (ps.hundred_cuts) mods.mult! *= streakMult(run, ps.hundred_cuts.per_hit);
    const r = rollHit(this.rng, spec, attacker, this.defenderOf(m), p.hp / p.maxHp, mods);
    let dmg = r.dmg;
    if (!r.miss && counter) dmg = Math.round(dmg * PARRY_COUNTER_MULT);
    // Spellblade: sword hits carry extra magic damage
    if (!r.miss && ps.spellblade && this.weapon === "sword" && !skillId) dmg += Math.ceil(this.combat.stats.INT * ps.spellblade.int_mult);
    // Horn Rabbit Weapons: extra damage on the monsters it names
    const bane = ps.foe_bane && !execute && ps.foe_bane.monsters.includes(m.id) ? ps.foe_bane.mult : 0;
    if (!r.miss && bane) dmg = Math.floor(dmg * bane);
    if (execute) dmg = Math.max(1, Math.ceil(m.hp));
    const hit: ReportHit = { dmg: r.miss ? 0 : dmg, crit: r.crit, miss: r.miss };
    if (!r.miss && bane) hit.foe = m.id;
    if (skillId) hit.skillId = skillId;
    if (counter && !r.miss && !execute) hit.counter = true;
    if (!r.miss) {
      hit.streak = run;
      this.hitStreak = run + 1;
      if (stealth) hit.stealth = stealth;
      if (seventh && ps.seven_strikes) hit.combo7 = true;
    }
    if (execute) {
      hit.execute = true;
      this.text(p.x, p.y - PLAYER_H - 30, "BLADE READ!", "#7fe0ff", 24);
    }
    if (opts.blood && ps.blood_sorcery) hit.blood = true;
    if (opts.chain) hit.chain = true;
    if (opts.charge !== undefined) hit.charge = opts.charge;
    if (!r.miss) {
      // what kind of blow this was, in case it's the killing one
      m.lastCast = spec.element === "magic" ? opts.castId : undefined;
      m.lastZeroMp = opts.castId !== undefined && this.zeroCasts.has(opts.castId);
      m.lastCharge = opts.charge;
      m.lastAir = !!opts.air;
    }
    // combo and mark bookkeeping
    if (fists) {
      if (r.miss) this.combo = 0;
      else {
        this.combo++;
        this.comboAt = this.now;
        if (this.combo >= 7) {
          this.combo = 0;
          this.acc.combos7++;
          if (hit.combo7) this.text(m.x, m.y - MONSTER_LOOKS[m.id].body.h - 40, "SEVEN STRIKES!", "#ffd34d", 20);
        }
      }
    }
    if (this.weapon === "bow") {
      if (r.miss || this.markedUid !== m.uid) this.markRun = 0;
      if (!r.miss && ++this.markRun >= 100) {
        this.markRun = 0;
        this.acc.markedRuns++;
      }
      this.markedUid = m.uid;
    }
    if (!r.miss && isBoss && this.bossFight?.uid === m.uid) {
      this.bossFight.weaponHits++;
      this.acc.boss.weaponHits++;
      this.acc.boss.dmg += dmg;
      if (opts.charge !== undefined) {
        this.bossFight.charges++;
        this.acc.boss.charges++;
      }
    }
    this.applyHit(m, hit, spec.status);
    if (r.miss) return;
    // Soul Drain: a share of the damage comes back as HP, and any extra becomes a shield
    // (Life Palm: unarmed hits heal you too, with no shield)
    const sd = ps.soul_drain;
    const pct = (sd?.pct ?? 0) + (ps.life_palm ? ps.life_palm.pct : 0);
    if (pct > 0 && !p.dead) {
      // fractions carry over, so small hits still drain over time
      const raw = dmg * pct + this.drainCarry;
      const drain = Math.floor(raw);
      this.drainCarry = raw - drain;
      const over = drain - this.healPlayer(drain, "drain");
      if (over > 0 && sd) p.shield = Math.min(Math.round(p.maxHp * sd.max_shield), p.shield + over);
    }
    // Chain Catastrophe: an enemy your spell kills explodes into the same spell
    const cc = ps.chain_catastrophe;
    if (cc && m.state === "dead" && spec.element === "magic") {
      const cy = m.y - MONSTER_LOOKS[m.id].body.h / 2;
      this.fxAdd("area", m.x, cy, cc.radius, 450, "#c792ff");
      this.text(m.x, cy - 40, "CHAIN!", "#c792ff", 18);
      const near = this.monsters.filter((x) => x.state !== "dead" && Math.abs(x.x - m.x) <= cc.radius && Math.abs(x.y - m.y) <= cc.radius);
      for (const x of near) if (x.state !== "dead") this.hitMonster(x, spec, skillId, false, 1, { castId: opts.castId, chain: true });
    }
    if (ps.armor_crusher) m.defDown = Math.min(ps.armor_crusher.max, m.defDown + ps.armor_crusher.per_hit);
    // Thousand Needles: crits stack bleeding
    const tn = ps.thousand_needles;
    if (tn && r.crit && m.state !== "dead") {
      m.bleed++;
      if (!m.bleedNext) m.bleedNext = this.now + TICK_MS;
      if (m.bleed >= tn.stacks) {
        m.bleed = 0;
        this.text(m.x, m.y - MONSTER_LOOKS[m.id].body.h - 40, "THOUSAND NEEDLES!", "#ff4f6d", 20);
        this.indirectDamage(m, isBoss ? Math.ceil(m.maxHp * tn.boss_pct) : Math.ceil(m.hp), "", "#ff4f6d");
      }
    }
    // Silent Finish: a stealth kill keeps you hidden and grows the chain
    if (stealth) {
      if (m.state === "dead") {
        this.stealthChain = Math.min(sf!.chain_max - sf!.mult, this.stealthChain + 1);
        this.hide(sf!.hide_s * 1000);
        this.text(p.x, p.y - PLAYER_H - 30, `SILENT FINISH x${stealth}`, "#c792ff", 20);
      } else this.stealthChain = 0;
    }
  }

  /** Turn invisible: field monsters lose track of you. */
  private hide(ms: number) {
    this.player.invisibleUntil = Math.max(this.player.invisibleUntil, this.now + ms);
    for (const x of this.monsters) if (x.spawnIndex >= 0) x.aggro = false;
  }

  /** Phantom Legion's clones swing at the nearest monster that's fighting you. */
  private updateClones() {
    const pl = this.combat.passive.phantom_legion;
    this.clones = this.clones.filter((c) => this.now < c.until && !this.player.dead);
    if (!pl) return;
    const feel = WEAPON_FEEL[this.weapon];
    for (const c of this.clones) {
      if (this.now < c.nextAt) continue;
      const target = this.monsters
        .filter((m) => m.state !== "dead" && m.aggro && Math.abs(m.x - c.x) < 500 && Math.abs(m.y - c.y) < 200)
        .sort((a, b) => Math.abs(a.x - c.x) - Math.abs(b.x - c.x))[0];
      if (!target) continue;
      c.nextAt = this.now + feel.interval;
      c.facing = target.x >= c.x ? 1 : -1;
      c.x = target.x - c.facing * (MONSTER_LOOKS[target.id].body.w / 2 + 24);
      c.y = target.y;
      const spec = attackSpec(this.weapon, this.combat);
      const r = rollHit(this.rng, spec, this.combat, this.defenderOf(target), this.player.hp / this.player.maxHp);
      this.fxAdd("slash", c.x + c.facing * 30, c.y - 44, 40, 200, "#8a7bff");
      this.applyHit(target, { skillId: "phantom_legion", dmg: r.miss ? 0 : Math.max(1, Math.round(r.dmg * pl.pct)), crit: r.crit, miss: r.miss });
    }
  }

  // ---------- pets and taming ----------

  /** Your pet follows you, and bites the nearest monster you're fighting. */
  private updatePet(pet: PetUnit, slot: number, dtMs: number) {
    const p = this.player;
    const target = p.dead
      ? undefined
      : this.monsters
          // a monster ready to tame is left alone, so you can tame it instead of your pet finishing it
          .filter((m) => m.state !== "dead" && (m.fight || m.aggro) && !this.readyToTame(m) && Math.abs(m.x - p.x) < 450 && Math.abs(m.y - p.y) < 220)
          .sort((a, b) => Math.abs(a.x - pet.x) - Math.abs(b.x - pet.x))[0];
    const step = (420 * dtMs) / 1000;
    let goalX: number;
    let goalY: number;
    if (target) {
      const side = pet.x <= target.x ? -1 : 1;
      goalX = target.x + side * (MONSTER_LOOKS[target.id].body.w / 2 + 22);
      goalY = target.y;
    } else {
      goalX = p.x - p.facing * (56 + slot * 44);
      goalY = p.y;
    }
    const dx = goalX - pet.x;
    pet.moving = Math.abs(dx) > 2;
    if (pet.moving) {
      pet.x += Math.sign(dx) * Math.min(Math.abs(dx), step);
      pet.facing = dx > 0 ? 1 : -1;
      pet.walkT += dtMs;
    }
    pet.y += (goalY - pet.y) * Math.min(1, dtMs / 120);
    // too far behind (a ladder, a jump): catch up at once
    if (Math.abs(pet.x - p.x) > 700 || Math.abs(pet.y - p.y) > 300) Object.assign(pet, { x: p.x - p.facing * (56 + slot * 44), y: p.y });
    if (!target || this.now < pet.nextAt) return;
    if (Math.abs(target.x - pet.x) > MONSTER_LOOKS[target.id].body.w / 2 + 40 || Math.abs(target.y - pet.y) > 60) return;
    pet.nextAt = this.now + PET_ATTACK_MS;
    pet.struckAt = this.now;
    pet.facing = target.x >= pet.x ? 1 : -1;
    const spec = attackSpec("unarmed", pet.attacker);
    const r = rollHit(this.rng, spec, pet.attacker, this.defenderOf(target), 1);
    // a monster whose taming condition you've met: your pet weakens it but never finishes it
    const hold = this.tameable(target);
    if (hold && target.hp <= 1) return;
    const dmg = r.miss ? 0 : hold ? Math.min(r.dmg, Math.ceil(target.hp) - 1) : r.dmg;
    this.applyHit(target, { pet: true, dmg, crit: r.crit, miss: r.miss }, undefined, pet.id);
  }

  private tameOf(m: Monster): TameState {
    if (!m.tame) m.tame = { ate: false, hornRun: 0, swampVenom: false, crowd: false, items: false, otherWeapon: false, silencedAt: 0, fistBlocks: 0, hinted: false, told: false };
    return m.tame;
  }

  /** How far a monster's hidden taming condition is, from 0 to 1 (1 = met). */
  tameProgress(m: Monster): number {
    const t = this.tameOf(m);
    switch (m.id) {
      case "green_slime":
        return t.ate ? 1 : 0;
      case "horned_rabbit":
        return Math.min(1, t.hornRun / TAME_CONDITIONS.horned_rabbit.goal);
      case "bog_toad":
        return t.swampVenom ? 1 : 0;
      case "thorn_wolf":
        return !t.crowd && !t.items && !t.otherWeapon ? 1 : 0;
      case "mire_bat":
        return this.now < t.silencedAt && this.player.statuses.silence ? 1 : 0;
      case "moss_golem":
        return Math.min(1, t.fistBlocks / TAME_CONDITIONS.moss_golem.goal);
      default:
        return 0;
    }
  }

  /** Its hidden condition is met and you hold the tamer wand: it could be tamed once it's weak enough. */
  tameable(m: Monster): boolean {
    if (this.player.dead || this.weapon !== "tamer_wand") return false;
    if (m.state === "dead" || !m.fight || MONSTERS[m.id].isBoss || !TAME_CONDITIONS[m.id]) return false;
    return this.tameProgress(m) >= 1;
  }

  /** Ready to tame: tameable and weak enough. */
  readyToTame(m: Monster): boolean {
    return this.tameable(m) && m.hp / m.maxHp < TAME_HP_SHARE;
  }

  /** A monster close by that you could tame right now. */
  tameTarget(): Monster | null {
    const p = this.player;
    for (const m of this.monsters) {
      if (!this.readyToTame(m)) continue;
      if (Math.abs(m.x - p.x) > 260 || Math.abs(m.y - p.y) > 160) continue;
      return m;
    }
    return null;
  }

  /** Weak enough to tame but the condition isn't met: a nudge once per fight, and a hint when you're close. */
  private tameHints() {
    if (this.weapon !== "tamer_wand") return;
    for (const m of this.monsters) {
      if (m.state === "dead" || !m.fight || MONSTERS[m.id].isBoss || !TAME_CONDITIONS[m.id]) continue;
      if (m.hp / m.maxHp >= TAME_HP_SHARE) continue;
      const t = this.tameOf(m);
      const pr = this.tameProgress(m);
      const top = m.y - MONSTER_LOOKS[m.id].body.h - 70;
      if (pr >= 1) {
        if (!t.hinted) {
          t.hinted = true;
          this.text(m.x, top, "It looks at you... (Tame!)", "#9fe39f", 18);
        }
      } else if (pr >= 0.8 && !t.hinted) {
        t.hinted = true;
        this.text(m.x, top, `Almost... ${TAME_CONDITIONS[m.id].text}`, "#ffe08a", 16);
      } else if (!t.told) {
        t.told = true;
        this.text(m.x, top, "It won't come with you... yet", "#c8c8d0", 16);
      }
    }
  }

  /** Tame a monster: it leaves the fight and joins you (the server adds the pet). */
  tame(m: Monster) {
    if (this.tameTarget() !== m) return false;
    const f = m.fight!;
    m.state = "dead";
    m.diedAt = this.now;
    m.hp = 0;
    if (m.spawnIndex >= 0) this.spawnTimers.set(m.spawnIndex, this.now + RESPAWN_MS);
    this.fxAdd("heal", m.x, m.y - MONSTER_LOOKS[m.id].body.h / 2, 50, 700, "#9fe39f");
    this.text(m.x, m.y - MONSTER_LOOKS[m.id].body.h - 20, "TAMED!", "#9fe39f", 28);
    sfx("tame");
    if (this.fight) this.fight.kills++;
    const t = this.tameOf(m);
    this.emit("tame", {
      monsterId: m.id,
      directToTarget: f.direct,
      indirectToTarget: f.indirect,
      petToTarget: f.pet,
      hitsOnTarget: f.swings,
      fightMs: this.now - f.start,
      inSwamp: f.inSwamp,
      duel: m.id === "thorn_wolf" ? !t.crowd && !t.items && !t.otherWeapon : undefined,
    });
    return true;
  }

  private ensureFight(): FightState {
    if (!this.fight)
      this.fight = {
        start: this.now,
        maxFoes: 0,
        lastActive: this.now,
        kills: 0,
        items: false,
        firstShotAt: null,
        dodgeRun: 0,
        phantomCounted: false,
        stolen: [],
        graceUsed: false,
      };
    return this.fight;
  }

  /**
   * Heal the player. Skill and food heals can trigger Grace Rebound; everything
   * healed in a boss fight charges Judgment of Mercy. Returns the HP actually gained.
   */
  private healPlayer(amount: number, kind: "skill" | "food" | "regen" | "drain"): number {
    const p = this.player;
    if (p.dead || amount <= 0) return 0;
    if (kind === "skill" || kind === "food") {
      if (p.hp / p.maxHp < 0.05) this.acc.lowHpHeals++;
      const gr = this.combat.passive.grace_rebound;
      if (gr && p.hp / p.maxHp < gr.below) {
        const f = this.ensureFight();
        if (!f.graceUsed) {
          f.graceUsed = true;
          amount = Math.round(amount * gr.mult);
          this.text(p.x, p.y - PLAYER_H - 40, "GRACE REBOUND!", "#fff3b0", 20);
        }
      }
    }
    const heal = Math.max(0, Math.min(p.maxHp - p.hp, amount));
    p.hp += heal;
    if (kind === "drain") this.acc.drained += heal;
    else this.acc.healed += heal;
    if (this.bossFight && heal > 0) {
      this.bossFight.healed += heal;
      this.acc.boss.healed += heal;
    }
    if (heal > 0) this.acc.dirty = true;
    return heal;
  }

  /** Sky Lance: the dive lands and hits everything nearby. */
  private crash() {
    const p = this.player;
    const sl = this.combat.passive.sky_lance;
    if (!sl || p.dead) return;
    this.fxAdd("area", p.x, p.y - 10, sl.reach, 500, "#ffb347");
    this.text(p.x, p.y - PLAYER_H - 30, "SKY LANCE!", "#ffb347", 22);
    const spec = attackSpec(this.weapon, this.combat);
    const near = this.monsters
      .filter((m) => m.state !== "dead" && Math.abs(m.x - p.x) <= sl.reach + MONSTER_LOOKS[m.id].body.w / 2 && Math.abs(m.y - p.y) <= 120)
      .sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))
      .slice(0, SKY_LANCE_TARGETS);
    for (const m of near) if (m.state !== "dead") this.hitMonster(m, spec, "sky_lance", false, 1, { air: true });
  }

  /** A strike a passive skill makes on its own (Iron Riposte, Eye of the Storm). Doesn't count toward hits in a row. */
  private procHit(m: Monster, id: string, eff: ActiveEffect) {
    const p = this.player;
    const spec = attackSpec(this.weapon, this.combat, { name: id, active: eff });
    const r = rollHit(this.rng, spec, withDuelist(this.combat, this.foesOnYou() <= 1), this.defenderOf(m), p.hp / p.maxHp);
    this.applyHit(m, { skillId: id, dmg: r.miss ? 0 : r.dmg, crit: r.crit, miss: r.miss }, spec.status);
  }

  /** Put a finished hit on a monster and into the report. */
  private applyHit(m: Monster, hit: ReportHit, status?: AttackSpec["status"], petId?: string) {
    const p = this.player;
    this.acc.hits.push(hit);
    if (!hit.miss) {
      m.lastSkill = hit.pet ? undefined : hit.skillId;
      m.lastPet = !!hit.pet;
      m.lastPetId = petId;
    }
    this.acc.dirty = true;
    this.engage(m);
    m.fight!.swings++;
    if (hit.pet && !hit.miss && this.bossFight?.uid === m.uid) {
      this.bossFight.petHits++;
      this.acc.boss.petHits = (this.acc.boss.petHits ?? 0) + 1;
    }
    const top = m.y - MONSTER_LOOKS[m.id].body.h;
    if (hit.miss) {
      this.text(m.x, top - 8, "MISS", "#c8c8d0", 22);
      return;
    }
    const dmg = hit.dmg;
    const big = hit.crit || hit.counter || hit.execute || hit.ult;
    m.hp -= dmg;
    if (hit.pet) m.fight!.pet += dmg;
    else m.fight!.direct += dmg;
    m.flashUntil = this.now + 120;
    m.showHpUntil = this.now + 4000;
    sfx(big ? "crit" : "hit");
    this.text(m.x, top - 8, `${dmg}`, big ? "#ff4f6d" : "#ffb347", big ? 34 : 28, hit.crit ? "!" : "");
    this.fxAdd("spark", m.x - p.facing * 6, top + MONSTER_LOOKS[m.id].body.h / 2, 18, 200, hit.crit ? "#ff4f6d" : "#ffe08a");
    if (m.state !== "windup" || !MONSTERS[m.id].isBoss) {
      // a little knockback
      const nx = m.x + p.facing * 10;
      m.x = Math.max(m.span[0], Math.min(m.span[1], nx));
    }
    if (status && this.rng() < status.chance) this.addMonsterStatus(m, status.type, status.turns);
    if (m.hp <= 0) this.killMonster(m);
  }

  /** Vengeance Vault: letting go of block releases everything stored as one piercing shockwave. */
  private releaseVault() {
    const p = this.player;
    const stored = Math.floor(this.vaultStore);
    if (!this.combat.passive.vault || stored <= 0 || p.dead) return;
    const targets = this.monstersInFront(300, 80, 200);
    if (!targets.length) return; // nothing in reach: keep it for later
    this.vaultStore = 0;
    const wave = this.waveId++;
    this.text(p.x, p.y - PLAYER_H - 30, "VENGEANCE VAULT!", "#ffd34d", 22);
    this.fxAdd("area", p.x + p.facing * 140, p.y - PLAYER_H / 2, 170, 500, "#ffd34d");
    for (const m of targets) this.applyHit(m, { skillId: "vengeance_vault", dmg: stored, crit: false, miss: false, wave });
  }

  private engage(m: Monster) {
    m.provoked = true;
    m.aggro = true;
    if (!m.fight) m.fight = { start: this.now, direct: 0, indirect: 0, swings: 0, inSwamp: this.player.inSwamp, pet: 0 };
    if (this.foesOnYou() > 1) for (const x of this.monsters) if (x.fight && x.state !== "dead") this.tameOf(x).crowd = true;
    if (this.weapon !== "tamer_wand") this.tameOf(m).otherWeapon = true;
    this.ensureFight();
    if (MONSTERS[m.id].isBoss) {
      if (!this.bossFight)
        this.bossFight = {
          uid: m.uid,
          hits: 0,
          parries: 0,
          dodges: 0,
          weaponHits: 0,
          mp: 0,
          healed: 0,
          charges: 0,
          petHits: 0,
          others: this.foesOnYou() > 1,
          items: false,
          gauges: {},
        };
    } else if (this.bossFight) this.bossFight.others = true;
  }

  /** Track fights: they end once no monster has been on you for a while. */
  private updateFight() {
    const foes = this.player.dead ? 0 : this.foesOnYou();
    if (foes > 0) {
      const f = this.ensureFight();
      f.maxFoes = Math.max(f.maxFoes, foes);
      f.lastActive = this.now;
      if (this.bossFight && foes > 1) this.bossFight.others = true;
    } else if (this.fight && this.now - this.fight.lastActive >= FIGHT_END_MS) this.endFight(true);
  }
  /** A fight is over: the run of hits starts again, and so does any boss fight. */
  private endFight(survived: boolean) {
    const f = this.fight;
    if (survived && f && !this.player.dead) {
      if (f.maxFoes >= STORM_FOES) this.acc.stormFights++;
      if (f.kills > 0 && !f.items) this.acc.cleanFights++;
      if (f.kills > 0 && f.firstShotAt !== null && f.firstShotAt - f.start <= 1000) this.acc.quickDraws++;
      // got away: something you fought is still alive (each monster counts once)
      const fled = this.monsters.filter((m) => m.state !== "dead" && m.fight && !m.escaped);
      if (fled.length) this.acc.escapes++;
      for (const m of fled) m.escaped = true;
      this.acc.dirty = true;
    }
    this.fight = null;
    this.player.shield = 0;
    this.stealthChain = 0;
    this.combo = 0;
    this.hitStreak = 0;
    this.parryChain = 0;
    this.bladeReady = false;
    if (this.bossFight) {
      this.bossFight = null;
      this.acc.bossEnd = true;
      this.acc.dirty = true;
    }
  }

  private addMonsterStatus(m: Monster, type: StatusType, turns: number) {
    const cur = m.statuses[type];
    let until = this.now + turns * TICK_MS;
    if (type === "stun") {
      until += this.combat.passive.ringing_blow?.extra_ms ?? 0;
      this.acc.stunsDealt++;
    }
    if (cur) cur.until = Math.max(cur.until, until);
    else m.statuses[type] = { until, nextTick: this.now + TICK_MS };
    this.text(m.x, m.y - MONSTER_LOOKS[m.id].body.h - 70, type.toUpperCase(), "#c792ff", 16);
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
    sfx("defeat");
    m.state = "dead";
    m.diedAt = this.now;
    m.hp = 0;
    const f = m.fight ?? { start: this.now, direct: 0, indirect: 0, swings: 0, inSwamp: false, pet: 0 };
    if (this.combat.passive.heal_on_win_pct && !p.dead) {
      const heal = this.healPlayer(Math.round(p.maxHp * this.combat.passive.heal_on_win_pct), "regen");
      if (heal > 0) this.text(p.x, p.y - PLAYER_H - 4, `+${heal}`, "#5fd36a", 24);
    }
    this.fxAdd("burst", m.x, m.y - MONSTER_LOOKS[m.id].body.h / 2, 50, 450, "#fff3b0");
    if (m.spawnIndex >= 0) this.spawnTimers.set(m.spawnIndex, this.now + RESPAWN_MS);
    const bf = this.bossFight;
    let duel: boolean | undefined;
    if (bf && bf.uid === m.uid) {
      duel = !bf.others && !bf.items;
      this.bossFight = null;
      this.acc.bossEnd = true;
    }
    if (this.fight) this.fight.kills++;
    this.emit("kill", {
      duel,
      killSkill: m.lastSkill,
      killCast: m.lastCast,
      zeroMpKill: m.lastZeroMp || undefined,
      chargeKill: m.lastCharge !== undefined && m.lastCharge >= 1 ? true : undefined,
      jumpKill: m.lastAir || undefined,
      petToTarget: f.pet,
      petKill: m.lastPet || undefined,
      petKillId: m.lastPet ? m.lastPetId : undefined,
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
          // a little forgiving at the top, so a level shot still clips short monsters
          return Math.abs(x.x - pr.x) < b.w / 2 + 6 && pr.y <= x.y + 4 && pr.y >= x.y - Math.max(b.h, 50) - 4;
        });
        if (m) {
          pr.dead = true;
          // how far it flew: Hawk Line hits harder far away, and far hits count toward it
          const share = pr.range ? Math.min(1, (pr.range - pr.left) / pr.range) : 0;
          if (this.weapon === "bow" && share >= 0.8) this.acc.farHits++;
          const hl = this.combat.passive.hawk_line;
          this.hitMonster(m, pr.spec!, pr.skillId, !!pr.counter, hl ? 1 + (hl.max_mult - 1) * share : 1, { castId: pr.castId });
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
      // Thousand Needles bleeding: 1% of max HP per stack, every tick
      const tn = this.combat.passive.thousand_needles;
      if (m.bleed > 0 && now >= m.bleedNext) {
        m.bleedNext = now + TICK_MS;
        if (tn) this.indirectDamage(m, Math.max(1, Math.round(m.maxHp * tn.tick_pct * m.bleed)), "", "#ff4f6d");
        else m.bleed = 0;
      }
      if ((m.state as Monster["state"]) === "dead") continue; // poison may have just finished it
      if (m.fight && p.inSwamp) m.fight.inSwamp = true;
      const frozen = !!(m.statuses.stun || m.statuses.freeze);
      // Wolf's Scars: monsters near you move slower
      const scars = this.combat.passive.scar_aura;
      const scarred = scars && !p.dead && Math.hypot(p.x - m.x, p.y - m.y) <= scars.radius ? 1 - scars.slow : 1;
      // ...and everything else they do is slower too: wind-ups, lunges, and the wait between attacks
      m.scarSlow = scarred;
      const speed = ai.speed * (m.statuses.slow ? 0.5 : 1) * scarred;
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
          m.x = Math.max(m.span[0], Math.min(m.span[1], m.x + m.facing * 420 * scarred * dt));
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
        // Beast Tongue: you know its next attack a moment before it starts
        const tongue = this.combat.passive.beast_tongue;
        if (tongue && !m.foreseen && !p.dead && now >= m.nextAttackAt - tongue.early_ms) {
          m.foreseen = this.foresee(m);
          if (m.foreseen) this.text(m.x, m.y - look.body.h - 70, `${m.foreseen.name} next!`, "#9fe8c0", 16);
        }
        if (now >= m.nextAttackAt && !p.dead) {
          let choice: EnemyAttack | null;
          if (m.foreseen) {
            // it does what you were told, once it can reach you (or gives up after a while)
            const ok = this.canUse(m, m.foreseen, Math.abs(dx), vertOk, inMelee);
            choice = ok ? m.foreseen : now - m.nextAttackAt > 2000 ? this.pickAttack(m, Math.abs(dx), vertOk, inMelee) : null;
            if (choice) m.foreseen = undefined;
          } else choice = this.pickAttack(m, Math.abs(dx), vertOk, inMelee);
          if (choice) {
            const sp = ai.special?.[choice.name];
            m.attack = choice;
            m.state = "windup";
            m.stateUntil = now + (sp ? sp.windup : ai.windup) / scarred;
            if (sp) this.text(m.x, m.y - look.body.h - 70, `${choice.name}!`, "#ffd34d", 18);
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

  /** Whether the monster can use this attack from where it is. */
  private canUse(m: Monster, a: EnemyAttack, dist: number, vertOk: boolean, inMelee: boolean): boolean {
    // silenced monsters can't use magic or status attacks
    if (m.statuses.silence && (a.element === "magic" || a.status)) return false;
    const sp = this.aiOf(m).special?.[a.name];
    const look = MONSTER_LOOKS[m.id];
    if (!sp) return inMelee;
    if (sp.kind === "area") return dist <= sp.range && Math.abs(this.player.y - m.y) < sp.range;
    if (sp.kind === "spit") return dist <= sp.range && vertOk;
    if (sp.kind === "dash") return dist <= sp.range + look.body.w / 2 && vertOk;
    return dist <= look.body.w / 2 + PLAYER_W / 2 + sp.range && vertOk;
  }

  /** Beast Tongue: decide the monster's next attack ahead of time (any it may use). */
  private foresee(m: Monster): EnemyAttack | undefined {
    let pool = MONSTERS[m.id].attacks;
    if (m.statuses.silence) pool = pool.filter((a) => a.element !== "magic" && !a.status);
    if (!pool.length) return undefined;
    const total = pool.reduce((n, a) => n + a.weight, 0);
    let roll = this.rng() * total;
    return pool.find((a) => (roll -= a.weight) < 0) ?? pool[0];
  }

  /** Choose an attack the monster can reach from where it is. */
  private pickAttack(m: Monster, dist: number, vertOk: boolean, inMelee: boolean): EnemyAttack | null {
    const def = MONSTERS[m.id];
    const pool = def.attacks.filter((a) => this.canUse(m, a, dist, vertOk, inMelee));
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
    const slow = m.scarSlow ?? 1; // Wolf's Scars
    m.stateUntil = this.now + ai.recover / slow;
    m.nextAttackAt = this.now + (ai.recover + 300 + Math.random() * 600) / slow;
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
    // Green Slime's Mercy: its blows just bounce off your slime coat
    if (this.combat.passive.slime_mercy?.monsters.includes(m.id)) {
      p.invulnUntil = this.now + HURT_INVULN_MS;
      this.text(p.x, p.y - PLAYER_H - 10, "BOING!", "#7be08a", 24);
      sfx("block");
      return;
    }
    // PARRY: block pressed just before the blow
    const isBoss = !!MONSTERS[m.id].isBoss;
    const es = MONSTERS[m.id].stats;
    if (p.blocking && this.now - p.blockStart <= PARRY_WINDOW_MS) {
      acc.parries++;
      acc.blocks++;
      if (m.id === "moss_golem" && atk.name === "Crushing Fist") this.tameOf(m).fistBlocks++;
      this.parryChain++;
      if (this.combat.passive.blade_read) this.bladeReady = true;
      if (isBoss && this.bossFight) {
        // what the parried blow would have done (Parry Emperor's unlock)
        const atkStat = atk.element === "magic" ? es.INT : es.STR;
        const def = atk.element === "magic" ? this.combat.stats.INT : this.combat.stats.VIT + (WEAPONS[this.weapon].defenseBonus ?? 0);
        this.bossFight.parries++;
        acc.boss.parries++;
        acc.boss.parryDmg += damageFormula(atkStat, atk.multiplier, def, atk.piercing);
      }
      if (this.combat.passive.riposte) this.procHit(m, "iron_riposte", this.combat.passive.riposte);
      m.state = "stunned";
      m.stateUntil = this.now + PARRY_STUN_MS * (MONSTERS[m.id].isBoss ? 0.6 : 1) + (this.combat.passive.ringing_blow?.extra_ms ?? 0);
      acc.stunsDealt++;
      p.counterUntil = this.now + 1600;
      p.blockStart = -1e9; // one parry per press
      this.text(p.x, p.y - PLAYER_H - 16, "PARRY!", "#7fe0ff", 30);
      sfx("parry");
      this.fxAdd("parry", p.x + p.facing * 24, p.y - 46, 36, 380, "#7fe0ff");
      return;
    }
    // Spell Thief: each enemy's first spell in a fight is absorbed and cast back
    const thief = this.combat.passive.spell_thief;
    if (thief && atk.element === "magic") {
      const f = this.ensureFight();
      if (!f.stolen.includes(m.uid)) {
        f.stolen.push(m.uid);
        acc.spellsAbsorbed++;
        const raw = damageFormula(es.INT, atk.multiplier, this.combat.stats.INT, atk.piercing);
        this.text(p.x, p.y - PLAYER_H - 30, "SPELL THIEF!", "#9fd4ff", 22);
        this.fxAdd("burst", p.x, p.y - PLAYER_H / 2, 46, 450, "#9fd4ff");
        this.applyHit(m, { skillId: "spell_thief", dmg: Math.max(1, Math.round(raw * thief.mult)), crit: false, miss: false });
        return;
      }
    }
    const pAgi = p.statuses.slow ? Math.floor(this.combat.stats.AGI / 2) : this.combat.stats.AGI;
    const r = rollEnemyHit(this.rng, atk, { STR: es.STR, INT: es.INT, DEX: es.DEX }, { VIT: this.combat.stats.VIT, INT: this.combat.stats.INT, AGI: pAgi }, this.weapon, p.blocking);
    if (m.id === "horned_rabbit" && atk.name === "Horn Charge") {
      const t = this.tameOf(m);
      t.hornRun = r.miss ? t.hornRun + 1 : 0;
    }
    if (r.miss) {
      acc.dodged++;
      const f = this.ensureFight();
      f.dodgeRun++;
      if (f.dodgeRun >= 50 && !f.phantomCounted) {
        f.phantomCounted = true;
        acc.phantomFights++;
      }
      if (isBoss && this.bossFight) {
        this.bossFight.dodges++;
        acc.boss.dodges++;
      }
      const pl = this.combat.passive.phantom_legion;
      if (pl && this.clones.length < pl.max) {
        this.clones.push({ x: p.x - p.facing * 40, y: p.y, facing: p.facing, until: this.now + pl.life_s * 1000, nextAt: this.now + 250 });
        this.text(p.x, p.y - PLAYER_H - 30, "PHANTOM!", "#8a7bff", 16);
      }
      this.dodgeStreak++;
      this.dodgeStreakBest = Math.max(this.dodgeStreakBest, this.dodgeStreak);
      this.text(p.x, p.y - PLAYER_H - 10, "MISS", "#c8c8d0", 24);
      sfx("miss");
      if (this.combat.passive.dodge_invisibility) {
        p.invisibleUntil = this.now + this.combat.passive.dodge_invisibility * TICK_MS;
        for (const x of this.monsters) if (x.spawnIndex >= 0) x.aggro = false;
      }
      return;
    }
    this.dodgeStreak = 0;
    // you got hit: runs of hits, parries, dodges and stealth kills start over
    const unstoppable = this.charging();
    if (!unstoppable) p.runDist = 0;
    this.hitStreak = 0;
    this.stealthChain = 0;
    if (this.fight) this.fight.dodgeRun = 0;
    this.parryChain = 0;
    this.bladeReady = false;
    if (p.blocking) {
      acc.blocks++;
      if (m.id === "moss_golem" && atk.name === "Crushing Fist") this.tameOf(m).fistBlocks++;
    }
    acc.blockedDamage += r.blocked;
    // Iron Sanctuary: blocking heals part of what your guard soaked
    const sanct = this.combat.passive.iron_sanctuary;
    if (p.blocking && sanct && r.blocked > 0) {
      const heal = this.healPlayer(Math.floor(r.blocked * sanct.pct), "regen");
      if (heal > 0) this.text(p.x, p.y - PLAYER_H - 40, `+${heal}`, "#5fd36a", 20);
    }
    if (p.blocking && this.combat.passive.vault) {
      this.vaultStore += r.blocked;
      acc.guardStored += r.blocked;
    }
    if (r.dmg === 0) {
      acc.zeroHits++;
      this.text(p.x, p.y - PLAYER_H - 10, "0", "#c8c8d0", 26);
    } else {
      this.hurtPlayer(r.dmg, "enemy", m);
      if (p.dead) return;
      if (atk.element === "magic") acc.spellsTaken++;
      // knockback (Iron Momentum: not while charging)
      if (!p.blocking && !unstoppable) {
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
    acc.hitsTaken++;
    if (isBoss && this.bossFight) {
      this.bossFight.hits++;
      acc.boss.hits++;
    }
    // Eye of the Storm: strike back at everything around you
    const storm = this.combat.passive.storm;
    if (storm) {
      for (const x of this.monsters) {
        if (x.state !== "dead" && x.aggro && Math.abs(x.x - p.x) <= STORM_REACH && Math.abs(x.y - p.y) <= STORM_REACH) this.procHit(x, "eye_of_the_storm", storm);
      }
    }
    if (atk.status && this.addPlayerStatus(atk.status)) {
      if (atk.status.type === "poison") p.poisonFrom = m.id;
      const t = this.tameOf(m);
      if (atk.status.type === "poison" && atk.name === "Venom Spit" && p.inSwamp) t.swampVenom = true;
      if (atk.status.type === "silence") t.silencedAt = p.statuses.silence?.until ?? 0;
    }
    const aura = this.combat.passive.poison_aura;
    if (aura && atk.element === "physical" && !atk.area && m.state !== "dead" && this.rng() < aura.chance) this.addMonsterStatus(m, "poison", aura.turns);
    void look;
  }

  private hurtPlayer(dmg: number, source: "enemy" | "hazard" | "poison" | "burn", m?: Monster, poisonTick = false) {
    const p = this.player;
    if (dmg <= 0 || p.dead) return;
    this.acc.taken[source] += dmg;
    if (p.shield > 0) {
      const soak = Math.min(p.shield, dmg);
      p.shield -= soak;
      dmg -= soak;
      if (dmg <= 0) {
        this.acc.dirty = true;
        if (source === "enemy") p.invulnUntil = this.now + HURT_INVULN_MS;
        return void this.text(p.x, p.y - PLAYER_H - 10, "SHIELD", "#fff3b0", 20);
      }
    }
    p.hp -= dmg;
    this.acc.dirty = true;
    if (source === "enemy") {
      sfx(p.blocking ? "block" : "hurt");
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
    if (p.hp <= 0) this.die(m, poisonTick);
  }

  /** Iron Momentum: mid-charge, you can't be stunned or knocked back. */
  private charging() {
    return !!this.combat.passive.iron_momentum && this.player.onGround && this.player.runDist >= CHARGE_FULL * CHARGE_MIN_SHARE;
  }

  /** Returns true when the status took hold. */
  private addPlayerStatus(spec: { type: StatusType; chance: number; turns: number }): boolean {
    const p = this.player;
    if (this.rng() >= spec.chance) return false;
    if (spec.type === "stun" && this.charging()) return void this.text(p.x, p.y - PLAYER_H - 34, "Unstoppable", "#ffb347", 16), false;
    if (this.combat.immunities.includes(spec.type)) return void this.text(p.x, p.y - PLAYER_H - 34, `Immune to ${spec.type}`, "#bfe3ff", 16), false;
    if (this.rng() < (this.combat.statusResist[spec.type] ?? 0)) return void this.text(p.x, p.y - PLAYER_H - 34, "Resisted", "#bfe3ff", 16), false;
    this.acc.statuses.push(spec.type);
    const until = this.now + spec.turns * TICK_MS;
    const cur = p.statuses[spec.type];
    if (cur) cur.until = Math.max(cur.until, until);
    else p.statuses[spec.type] = { until, nextTick: this.now + TICK_MS };
    this.text(p.x, p.y - PLAYER_H - 34, spec.type.toUpperCase(), "#c792ff", 18);
    return true;
  }

  private updatePlayerStatus() {
    const p = this.player;
    const now = this.now;
    if (p.dead) return;
    for (const [type, st] of Object.entries(p.statuses) as [StatusType, Status][]) {
      if (now >= st.nextTick) {
        st.nextTick += TICK_MS;
        if (type === "poison") this.hurtPlayer(Math.max(1, Math.round(p.maxHp * 0.05 * this.combat.poisonMult)), "poison", undefined, true);
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
        if (!p.dead && hazard.status && this.addPlayerStatus(hazard.status) && hazard.status.type === "poison") p.poisonFrom = "";
      }
    } else p.swampNext = 0;
    // MP regen from skills
    if (now >= p.regenNext) {
      p.regenNext = now + TICK_MS;
      if (this.combat.passive.mp_regen) p.mp = Math.min(p.maxMp, p.mp + this.combat.passive.mp_regen);
      const bc = this.combat.passive.breath_control;
      if (bc && this.fight) {
        this.healPlayer(Math.ceil(p.maxHp * bc.hp_pct), "regen");
        p.mp = Math.min(p.maxMp, p.mp + bc.mp);
      }
    }
  }

  private die(m?: Monster, byPoison = false) {
    const p = this.player;
    p.dead = true;
    p.diedAt = this.now;
    sfx("die");
    p.hp = 0;
    p.onLadder = false;
    p.blocking = false;
    this.pendingHits = [];
    this.vaultStore = 0;
    this.clones = [];
    this.endFight(false);
    for (const x of this.monsters) {
      x.aggro = false;
      if (x.state !== "dead") x.state = "patrol";
    }
    // poison that finishes you counts against whoever poisoned you
    if (byPoison) this.emit("death", { monsterId: p.poisonFrom || undefined, deathBy: "poison" });
    else this.emit("death", { monsterId: m?.id });
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
      swampMs: Math.round(a.swampMs),
      hitsTaken: a.hitsTaken,
      hitStreak: this.hitStreak,
      guardStored: a.guardStored,
      boss: a.boss,
      bossEnd: a.bossEnd,
      stormFights: a.stormFights,
      phantomFights: a.phantomFights,
      escapes: a.escapes,
      stunsDealt: a.stunsDealt,
      combos7: a.combos7,
      cleanFights: a.cleanFights,
      quickDraws: a.quickDraws,
      farHits: a.farHits,
      markedRuns: a.markedRuns,
      spellsTaken: a.spellsTaken,
      spellsAbsorbed: a.spellsAbsorbed,
      lowHpHeals: a.lowHpHeals,
      healed: a.healed,
      drained: a.drained,
      bloodUses: a.bloodUses,
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
    if (r.levelUp) sfx("levelup");
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
