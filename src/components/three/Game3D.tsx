"use client";

import { setMusic, soundState } from "@/lib/sound";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client";
import { ITEMS, MONSTERS, ZONES } from "@/lib/game/data/world";
import { INN3D, MAPS3D, START3D, type Map3DId, type Portal3D } from "@/lib/game/data/maps3d";
import type { LiveReport } from "@/lib/game/live";
import { attackerFromPetStats } from "@/lib/game/pets";
import type { UnlockNotice, getState } from "@/lib/game/service";
import type { InputBus } from "../world/input";
import TextBox, { type Dialog } from "../world/TextBox";
import { Engine3D, type CombatInfo, type Nearby, type Press } from "./engine3d";
import { lookFor, type Look } from "../side/hero";
import type { SkillButton } from "../side/TouchControls";
import { World3D } from "./scene";
import TouchControls3D from "./TouchControls3D";
import { HintStrip } from "@/components/world/HintStrip";

type GameState = Awaited<ReturnType<typeof getState>>;

interface LiveResult {
  hp: number;
  mp: number;
  level: number;
  levelUp: boolean;
  rewards: { exp: number; gold: number; drops: string[] } | null;
  claimed: string | null;
  run: { room: number; totalRooms: number; cleared: boolean } | null;
  log: string[];
  unlocks: UnlockNotice[];
  tamed: { name: string } | null;
  egg: string | null;
}

/** How long you see yourself fall before waking at the inn. */
const RESPAWN_DELAY_MS = 700;

type EnterResult = { run: { room: number; totalRooms: number; firstAttempt: boolean } | null; unlocks: UnlockNotice[] };
/** What waits to reach the server, in order: reports, and "I walked onto a new map" between them. */
type QueueItem = { r: LiveReport } | { call: { path: string; body: unknown }; done: (res: unknown, err?: Error) => void };

interface Toast {
  id: number;
  text: string;
  color: string;
}

const SAVE_KEY = (id: string) => `ub-3d-${id}`;

/** The pets that are out, as the game screen needs them. */
function petsOf(st: GameState) {
  return st.pets
    .filter((x) => x.active)
    .slice(0, st.summonLimit)
    .map((p) => ({ id: p.id, species: p.species, attacker: attackerFromPetStats(p.stats) }));
}

function loadSpot(playerId: string): { map: Map3DId; x: number; z: number } {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY(playerId)) ?? "null");
    if (s && MAPS3D[s.map as Map3DId] && typeof s.x === "number" && typeof s.z === "number") {
      // A dungeon attempt never survives a reload: start outside the cave.
      if (s.map === "hollow_of_the_mire") return { map: "mirewood_fields", x: 71, z: 30 };
      const m = MAPS3D[s.map as Map3DId];
      if (s.x > 0 && s.x < m.w && s.z > 0 && s.z < m.d) return s;
    }
  } catch {
    // no saved spot
  }
  return { ...START3D };
}

function shortName(name: string) {
  const words = name.split(/\s+/);
  return words.length > 1 ? words.map((w) => w[0]).join("").slice(0, 3).toUpperCase() : name.slice(0, 5);
}

/** Every key binding for PC in one place. Walking keys are read each frame. */
const MOVE_KEYS: Record<string, "f" | "b" | "l" | "r"> = {
  w: "f",
  W: "f",
  ArrowUp: "f",
  s: "b",
  S: "b",
  ArrowDown: "b",
  a: "l",
  A: "l",
  ArrowLeft: "l",
  d: "r",
  D: "r",
  ArrowRight: "r",
};
const KEYS: Record<string, { held?: "attack" | "block"; press?: Press | "menu" }> = {
  " ": { press: "jump" },
  j: { held: "attack" },
  J: { held: "attack" },
  k: { held: "block" },
  K: { held: "block" },
  "1": { press: "skill0" },
  "2": { press: "skill1" },
  "3": { press: "skill2" },
  "4": { press: "skill3" },
  q: { press: "potion" },
  Q: { press: "potion" },
  e: { press: "interact" },
  E: { press: "interact" },
  f: { press: "interact" },
  F: { press: "interact" },
  Enter: { press: "interact" },
  m: { press: "menu" },
  M: { press: "menu" },
  Tab: { press: "menu" },
};

/** Mouse look speed (radians per pixel). */
const LOOK_SPEED = 0.0042;

export default function Game3D({
  state,
  bus,
  paused,
  refresh,
  onMenu,
  onShop,
  onUnlocks,
  onError,
  registerSync,
  onSwitchView,
}: {
  state: GameState;
  bus: InputBus;
  paused: boolean;
  refresh: () => Promise<GameState | undefined>;
  onMenu: () => void;
  onShop: () => void;
  onUnlocks: (u: UnlockNotice[]) => void;
  onError: (msg: string) => void;
  /** Lets the page send everything before opening the menu or shop, and take the server's HP after. */
  registerSync: (fns: { flush: () => Promise<void>; adopt: () => void }) => void;
  /** Go back to the 2D side view. */
  onSwitchView?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine3D | null>(null);
  const worldRef = useRef<World3D | null>(null);
  const [engine, setEngine] = useState<Engine3D | null>(null);
  const [ready, setReady] = useState(false);
  const [artError, setArtError] = useState<string | null>(null);
  /** Keys held for walking, the phone joystick, and the mouse buttons. */
  const moveKeys = useRef(new Set<"f" | "b" | "l" | "r">());
  const stick = useRef({ x: 0, y: 0 });
  const mouse = useRef({ attack: false, block: false });
  /** What right click does: -1 the normal attack, or a skill slot (picked with the mouse wheel). */
  const [attackSel, setAttackSel] = useState(-1);
  const attackSelRef = useRef(-1);
  attackSelRef.current = attackSel;
  const [locked, setLocked] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [dialogKey, setDialogKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [portraitTip, setPortraitTip] = useState(false);
  const queue = useRef<QueueItem[]>([]);
  const sending = useRef(false);
  const waiters = useRef<(() => void)[]>([]);
  const adoptNext = useRef(true);
  const stateRef = useRef(state);
  stateRef.current = state;
  const toastId = useRef(1);
  const pausedRef = useRef(paused);
  pausedRef.current = paused || !!dialog || busy;

  const { player } = state;
  const look: Look = useMemo(() => lookFor(player.appearance, player.classId), [player.appearance, player.classId]);
  const npcLooks = useMemo(() => {
    const out: Record<string, Look> = {};
    for (const m of Object.values(MAPS3D))
      for (const n of m.npcs)
        out[n.id] = { skin: n.look.skin, hair: n.look.hair, shirt: n.look.shirt, eyes: "#5a4030", hairStyle: n.look.hairStyle, female: n.look.female, build: "Average", body: n.look.body };
    return out;
  }, []);

  const toast = useCallback((text: string, color = "#ffffff") => {
    const id = toastId.current++;
    setToasts((t) => [...t.slice(-5), { id, text, color }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  const say = useCallback((d: Dialog) => {
    setDialog(d);
    setDialogKey((k) => k + 1);
  }, []);

  // ---------- talking to the server ----------

  const pump = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    while (queue.current.length) {
      const item = queue.current[0];
      if ("call" in item) {
        // a new map, a rest at the inn: the server learns of it in order, the player already moved on
        try {
          const res = await api<unknown>(item.call.path, item.call.body);
          queue.current.shift();
          item.done(res);
        } catch (e) {
          const status = (e as { status?: number }).status;
          if (status && status < 500) {
            queue.current.shift();
            item.done(null, e as Error);
          } else {
            sending.current = false;
            setTimeout(() => void pump(), 2500);
            return;
          }
        }
        continue;
      }
      try {
        const res = await api<LiveResult>("/api/live", item.r);
        queue.current.shift();
        engineRef.current?.applyServer(item.r, res);
        if (res.rewards) {
          toast(`+${res.rewards.exp} EXP`, "#ffe066");
          toast(`+${res.rewards.gold} gold`, "#ffd34d");
          for (const d of res.rewards.drops) toast(`Picked up ${ITEMS[d]?.name ?? d}`, "#bfe3ff");
        }
        for (const line of res.log) toast(line, "#ffffff");
        if (res.levelUp) adoptNext.current = true;
        if (res.unlocks.length) onUnlocks(res.unlocks);
        if (res.rewards || res.levelUp || res.unlocks.length || res.tamed || res.egg || item.r.type === "death") await refresh();
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status && status < 500) {
          // the server refused it: drop it and take the server's numbers
          queue.current.shift();
          onError((e as Error).message);
          adoptNext.current = true;
          await refresh();
        } else {
          sending.current = false;
          setTimeout(() => void pump(), 2500);
          return;
        }
      }
    }
    sending.current = false;
    const w = waiters.current;
    waiters.current = [];
    w.forEach((f) => f());
  }, [onError, onUnlocks, refresh, toast]);

  const send = useCallback(
    (r: LiveReport) => {
      queue.current.push({ r });
      void pump();
    },
    [pump],
  );

  /** Send a call to the server after everything sent before it, without waiting for it. */
  const queueCall = useCallback(
    <T,>(path: string, body: unknown) =>
      new Promise<T>((resolve, reject) => {
        engineRef.current?.flush();
        queue.current.push({ call: { path, body }, done: (res, err) => (err ? reject(err) : resolve(res as T)) });
        void pump();
      }),
    [pump],
  );
  /** Tell the server about a new map. */
  const enterZone = useCallback((zoneId: string) => queueCall<EnterResult>("/api/live", { type: "enter", zoneId }), [queueCall]);

  /** Send what's waiting, in the background (opening the menu or shop doesn't wait for it). */
  const sendNow = useCallback(() => {
    engineRef.current?.flush();
    void pump();
  }, [pump]);

  /** Send everything not yet sent and wait until the server has it. */
  const flush = useCallback(async () => {
    engineRef.current?.flush();
    if (!sending.current && !queue.current.length) return;
    await new Promise<void>((res) => {
      waiters.current.push(res);
      void pump();
    });
  }, [pump]);

  useEffect(() => {
    registerSync({ flush, adopt: () => (adoptNext.current = true) });
  }, [flush, registerSync]);

  // ---------- start ----------

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(async () => {
        if (cancelled) return;
        const st = stateRef.current;
        let spot = loadSpot(st.player.id);
        if (st.player.currentHp <= 0) spot = { ...INN3D };
        const zone = MAPS3D[spot.map].zoneId;
        // the game starts at once; the server hears where you are first, in order
        queueCall("/api/live", { type: "enter", zoneId: zone }).catch((err: Error) => onError(err.message));
        const e = new Engine3D({
          mapId: spot.map,
          x: spot.x,
          z: spot.z,
          combat: st.combat as CombatInfo,
          weapon: st.player.weapon,
          hp: st.player.currentHp,
          mp: st.player.currentMp,
          maxHp: st.derived.maxHp,
          maxMp: st.derived.maxMp,
          bag: st.inventory,
          events: { report: (r) => send(r), toast: (t) => toast(t) },
          now: performance.now(),
        });
        e.setPets(petsOf(st));
        e.horn = !!st.hornWeapon?.equipped;
        // the 3D view
        if (!canvasRef.current || !overlayRef.current) throw new Error("No screen to draw on");
        try {
          worldRef.current = new World3D(canvasRef.current, overlayRef.current);
        } catch {
          throw new Error("Your browser can't show 3D (WebGL is off)");
        }
        worldRef.current.camYaw = e.player.yaw;
        engineRef.current = e;
        setEngine(e);
        // for local play-testing only
        if (process.env.NODE_ENV !== "production") (window as unknown as { __ub3d?: unknown }).__ub3d = { engine: e, world: worldRef.current, sound: soundState };
        adoptNext.current = false;
        setReady(true);
        setBanner(ZONES[zone].name);
        if (st.player.currentHp <= 0) say({ lines: ["You're back in Thornvale, badly hurt.", "Rest at the inn (the door on the left) to recover."] });
      })
      .catch((err) => setArtError((err as Error).message));
    return () => {
      cancelled = true;
      worldRef.current?.dispose();
      worldRef.current = null;
    };
    // start once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // new numbers from the server: stats, weapon, skills, bag (and HP when it should win)
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    const quiet = !sending.current && !queue.current.length && !e.hasUnsent;
    const adopt = adoptNext.current && quiet;
    e.setStats(
      state.combat as CombatInfo,
      state.player.weapon,
      state.derived.maxHp,
      state.derived.maxMp,
      adopt ? state.player.currentHp : undefined,
      adopt ? state.player.currentMp : undefined,
      quiet ? state.inventory : undefined,
    );
    e.horn = !!state.hornWeapon?.equipped;
    e.setPets(petsOf(state));
    if (adopt) adoptNext.current = false;
  }, [state]);

  // a new Tamer hasn't picked a first pet yet: say where to do it, once per visit
  const petHint = useRef(false);
  useEffect(() => {
    if (!ready || petHint.current || !state.firstPetChoices?.length) return;
    petHint.current = true;
    say({ lines: ["As a Tamer, you start with a pet of your own.", "Open the menu to choose your first pet."] });
  }, [ready, state.firstPetChoices, say]);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 2200);
    return () => clearTimeout(t);
  }, [banner]);

  // phones held upright get a hint
  useEffect(() => {
    const check = () => setPortraitTip(window.innerHeight > window.innerWidth * 1.15 && matchMedia("(pointer: coarse)").matches);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // ---------- travelling ----------

  const savePos = useCallback(() => {
    const e = engineRef.current;
    if (!e || !e.player.onGround || e.player.dead) return;
    try {
      localStorage.setItem(SAVE_KEY(stateRef.current.player.id), JSON.stringify({ map: e.map.id, x: e.player.x / 64, z: e.player.z / 64 }));
    } catch {
      // storage may be blocked
    }
  }, []);

  const travel = useCallback(
    (to: Map3DId, x: number, z: number) => {
      const e = engineRef.current;
      if (!e) return false;
      const zone = ZONES[MAPS3D[to].zoneId];
      if (zone.kind === "dungeon" && e.player.hp <= 0) {
        say({ lines: ["You're too hurt to go in. Rest at the inn first."] });
        return false;
      }
      // walk straight onto the new map; the server hears about it in order, in the background
      const entering = enterZone(zone.id);
      e.setMap(to, x, z, zone.kind === "dungeon" ? { room: 0, totalRooms: zone.rooms!.length, cleared: false } : null);
      if (worldRef.current) worldRef.current.camYaw = e.player.yaw;
      setBanner(zone.name);
      savePos();
      entering
        .then((res) => {
          if (res.unlocks.length) onUnlocks(res.unlocks);
          if (res.run) void refresh();
        })
        .catch((err: Error) => say({ lines: [err.message] }));
      return true;
    },
    [enterZone, onUnlocks, refresh, savePos, say],
  );

  const rest = useCallback(() => {
    // rested at once; the server does the same in the background, in order
    const e = engineRef.current;
    if (e) {
      e.player.hp = e.player.maxHp;
      e.player.mp = e.player.maxMp;
    }
    say({ lines: ["You feel rested."] });
    queueCall("/api/town", { action: "rest" })
      .then(() => {
        adoptNext.current = true;
        void refresh();
      })
      .catch((err: Error) => say({ lines: [err.message] }));
  }, [queueCall, refresh, say]);

  const enterPortal = useCallback(
    (p: Portal3D) => {
      const e = engineRef.current!;
      const hp = e.player.hp;
      if (p.kind === "cave") {
        const z = ZONES.hollow_of_the_mire;
        const tries = stateRef.current.player.dungeonAttempts[z.id] ?? 0;
        return say({
          lines: [
            z.name,
            z.description,
            tries === 0 ? "Your first attempt. Legends say the Hollow rewards those who clear it alone on their first try." : `Attempts so far: ${tries}. Go in?`,
          ],
          choices: [
            { label: "Enter", run: () => void travel("hollow_of_the_mire", p.toX, p.toZ) },
            { label: "Leave", run: () => {} },
          ],
        });
      }
      if (p.kind === "dungeon_exit") return void travel("mirewood_fields", p.toX, p.toZ);
      if (e.run && !e.run.cleared) {
        return say({
          lines: ["Leave the Hollow? This attempt ends, and the next time counts as a new attempt."],
          choices: [
            { label: "Leave", run: () => void travel(p.to!, p.toX, p.toZ) },
            { label: "Stay", run: () => {} },
          ],
        });
      }
      if (e.map.id === "thornvale" && hp <= 0) return say({ lines: ["You're too hurt to leave town. Rest at the inn first."] });
      void travel(p.to!, p.toX, p.toZ);
    },
    [say, travel],
  );

  const interact = useCallback(
    async (n: Nearby) => {
      if (n.kind === "tame") return void engineRef.current?.tame(n.monster);
      if (n.kind === "portal") return enterPortal(n.portal);
      if (n.kind === "sign") {
        const z = ZONES[n.sign.zoneId];
        return say({ lines: [z.name, z.description] });
      }
      if (n.kind === "door") {
        if (n.building.kind === "house") return say({ lines: ["The door is locked."] });
        if (n.building.kind === "shop") {
          sendNow();
          return onShop();
        }
        return say({
          lines: ["Welcome to the inn! Rest here to restore your HP and MP?"],
          choices: [
            { label: "Rest", run: () => void rest() },
            { label: "Leave", run: () => {} },
          ],
        });
      }
      // a villager shares rumors
      setBusy(true);
      try {
        const r = await api<{ rumors?: string[] }>("/api/town", { action: "rumors" });
        const lines = r.rumors?.length ? r.rumors.map((s) => `“${s}”`) : ["“Nothing new to tell you.”"];
        say({ lines });
      } catch (err) {
        say({ lines: [(err as Error).message] });
      } finally {
        setBusy(false);
      }
    },
    [sendNow, onShop, rest, say, enterPortal],
  );

  const openMenu = useCallback(() => {
    sendNow();
    onMenu();
  }, [sendNow, onMenu]);

  // ---------- keyboard and mouse (PC) ----------

  /** Skill slots right click can use: ones that hit something. */
  const attackSkills = useCallback(() => {
    const e = engineRef.current;
    if (!e) return [] as number[];
    return e.skillSlots.map((s, i) => (s.active.multiplier || s.active.ultimate ? i : -1)).filter((i) => i >= 0);
  }, []);

  useEffect(() => {
    const typing = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    };
    const down = (ev: KeyboardEvent) => {
      const e = engineRef.current;
      if (!e || typing(ev) || ev.metaKey) return;
      const mv = MOVE_KEYS[ev.key];
      const k = KEYS[ev.key];
      if (!mv && !k) return;
      if (pausedRef.current) return; // dialogs and menus use the same keys
      ev.preventDefault();
      if (mv) {
        moveKeys.current.add(mv);
        return;
      }
      if (k!.held) e.held[k!.held] = true;
      if (k!.press && !ev.repeat) {
        if (k!.press === "menu") {
          document.exitPointerLock?.();
          return void openMenu();
        }
        if (k!.press === "interact") {
          const n = e.nearby();
          if (n) {
            if (n.kind !== "tame") document.exitPointerLock?.();
            void interact(n);
          }
          return;
        }
        e.press(k!.press);
      }
    };
    const up = (ev: KeyboardEvent) => {
      const e = engineRef.current;
      const mv = MOVE_KEYS[ev.key];
      if (mv) moveKeys.current.delete(mv);
      const k = KEYS[ev.key];
      if (e && k?.held) e.held[k.held] = false;
    };
    const blur = () => {
      moveKeys.current.clear();
      mouse.current = { attack: false, block: false };
      const e = engineRef.current;
      if (e) Object.assign(e.held, { mx: 0, mz: 0, attack: false, block: false });
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [interact, openMenu]);

  // the mouse: click the game to take the mouse; then move to look,
  // RIGHT button attacks, LEFT button blocks (parry: right as the hit lands),
  // the wheel picks what right click does.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onLock = () => setLocked(document.pointerLockElement === wrap);
    const md = (ev: MouseEvent) => {
      if (pausedRef.current || (ev.target as HTMLElement).closest("button")) return;
      if (document.pointerLockElement !== wrap) {
        if (ev.button === 0 || ev.button === 2) {
          ev.preventDefault();
          void wrap.requestPointerLock?.();
        }
        return;
      }
      ev.preventDefault();
      if (ev.button === 2) mouse.current.attack = true;
      if (ev.button === 0) mouse.current.block = true;
    };
    const mu = (ev: MouseEvent) => {
      if (ev.button === 2) mouse.current.attack = false;
      if (ev.button === 0) mouse.current.block = false;
    };
    const mm = (ev: MouseEvent) => {
      const w = worldRef.current;
      if (!w || document.pointerLockElement !== wrap || pausedRef.current) return;
      w.camYaw -= ev.movementX * LOOK_SPEED;
      w.camPitch += ev.movementY * LOOK_SPEED;
    };
    const wheel = (ev: WheelEvent) => {
      if (pausedRef.current) return;
      ev.preventDefault();
      const opts = [-1, ...attackSkills()];
      const i = Math.max(0, opts.indexOf(attackSelRef.current));
      const next = opts[(i + (ev.deltaY > 0 ? 1 : opts.length - 1)) % opts.length];
      setAttackSel(next);
    };
    const ctx = (ev: Event) => ev.preventDefault();
    document.addEventListener("pointerlockchange", onLock);
    wrap.addEventListener("mousedown", md);
    window.addEventListener("mouseup", mu);
    window.addEventListener("mousemove", mm);
    wrap.addEventListener("wheel", wheel, { passive: false });
    wrap.addEventListener("contextmenu", ctx);
    return () => {
      document.removeEventListener("pointerlockchange", onLock);
      wrap.removeEventListener("mousedown", md);
      window.removeEventListener("mouseup", mu);
      window.removeEventListener("mousemove", mm);
      wrap.removeEventListener("wheel", wheel);
      wrap.removeEventListener("contextmenu", ctx);
    };
  }, [attackSkills]);

  // menus and talks give the mouse back
  useEffect(() => {
    if (paused || dialog) {
      if (document.pointerLockElement) document.exitPointerLock?.();
      mouse.current = { attack: false, block: false };
      moveKeys.current.clear();
    }
  }, [paused, dialog]);

  // the right-click choice stays valid when skills change
  useEffect(() => {
    if (attackSel >= 0 && !attackSkills().includes(attackSel)) setAttackSel(-1);
  }, [state, attackSel, attackSkills]);

  // ---------- the loop ----------

  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    let last = performance.now();
    let lastHud = 0;
    let lastSync = performance.now();
    let lastSave = 0;
    let deathHandled = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const e = engineRef.current;
      const w = worldRef.current;
      const wrap = wrapRef.current;
      if (!e || !w || !wrap) return;
      const dt = Math.min(100, now - last);
      last = now;
      e.paused = pausedRef.current;
      if (e.paused) e.now = now;
      // walking: keys or the joystick, turned to match the camera
      const keys = moveKeys.current;
      let f = (keys.has("f") ? 1 : 0) - (keys.has("b") ? 1 : 0) - stick.current.y;
      let r = (keys.has("r") ? 1 : 0) - (keys.has("l") ? 1 : 0) + stick.current.x;
      const len = Math.hypot(f, r);
      if (len > 1) {
        f /= len;
        r /= len;
      }
      const fx = Math.sin(w.camYaw);
      const fz = Math.cos(w.camYaw);
      // right of the camera is (-cos, sin) in x/z
      e.held.mx = fx * f - fz * r;
      e.held.mz = fz * f + fx * r;
      // the mouse buttons (the phone buttons set these directly)
      if (locked || document.pointerLockElement) {
        e.held.attack = mouse.current.attack;
        e.held.block = mouse.current.block;
        // right click with a skill picked: use it whenever it's ready
        const sel = attackSelRef.current;
        if (mouse.current.attack && sel >= 0) {
          const ss = e.skillState(sel);
          if (ss?.ready && ss.enoughMp) e.press(`skill${sel}` as Press);
        }
      }
      e.update(dt, now);
      // the tune follows where you are
      const kind = ZONES[e.map.zoneId].kind;
      setMusic(kind === "town" ? "town" : kind === "dungeon" ? "cave" : "field");
      // size the 3D view to the screen
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = wrap.clientWidth;
      const ch = wrap.clientHeight;
      const c = canvasRef.current!;
      if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) w.resize(cw, ch, dpr);
      w.render(e, now, { look, name: stateRef.current.player.name, npcLooks }, dt);
      // send what happened every so often
      if (now - lastSync > 12000 || e.unsentHits > 80) {
        lastSync = now;
        if (e.hasUnsent && !e.player.dead) e.flush();
      }
      if (now - lastSave > 2000) {
        lastSave = now;
        savePos();
      }
      if (e.player.dead && deathHandled !== e.player.diedAt && now - e.player.diedAt > RESPAWN_DELAY_MS) {
        // falling in a fight: back at the inn at once, fully healed (the server agrees in the background)
        deathHandled = e.player.diedAt;
        const entering = enterZone("thornvale");
        e.respawn(INN3D.map, INN3D.x, INN3D.z, e.player.maxHp, e.player.maxMp);
        w.camYaw = e.player.yaw;
        savePos();
        setBanner("Thornvale");
        toast("You were carried back to Thornvale, a little poorer.", "#ffffff");
        entering
          .catch(() => {})
          .finally(() => {
            adoptNext.current = true;
            void refresh();
          });
      }
      if (now - lastHud > 100) {
        lastHud = now;
        setTick((t) => t + 1);
      }
    };
    raf = requestAnimationFrame(loop);
    const hide = () => {
      if (document.visibilityState === "hidden") engineRef.current?.flush();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [ready, locked, look, npcLooks, flush, refresh, rest, say, savePos, enterZone, toast]);

  // ---------- HUD ----------

  if (artError)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted">
        <p>{artError}.</p>
        {onSwitchView && (
          <button className="btn px-3 py-1" onClick={onSwitchView}>
            Play the 2D version
          </button>
        )}
      </div>
    );

  const e = engine;
  const p = e?.player;
  const near = e && !pausedRef.current ? e.nearby() : null;
  const contextLabel = near ? { tame: "Tame", npc: "Talk", door: near.kind === "door" && near.building.kind === "house" ? "Knock" : "Enter", sign: "Read", portal: "Go" }[near.kind] : null;
  const skillButtons: (SkillButton | null)[] = [0, 1, 2, 3].map((i) => {
    const s = e?.skillSlots[i];
    const ss = e?.skillState(i);
    if (!s || !ss) return null;
    return {
      name: s.name,
      short: shortName(s.name),
      ready: ss.ready,
      cdPct: ss.cdLeft / ss.cdTotal,
      enoughMp: ss.enoughMp,
      gauge: ss.gauge ? { value: ss.gauge.value, charged: ss.gauge.tier > 0 } : undefined,
    };
  });
  const boss = e ? (e.monsters.find((m) => MONSTERS[m.id].isBoss && m.state !== "dead") ?? null) : null;
  const rightClick = attackSel >= 0 && e?.skillSlots[attackSel] ? e.skillSlots[attackSel].name : "Normal attack";
  const food = e?.bag.filter((b) => b.qty > 0 && ITEMS[b.itemId]?.edible).reduce((n, b) => n + b.qty, 0) ?? 0;
  const menuBadge = state.skills.some((s) => s.status === "offered") || player.freePoints > 0;
  const hpPct = p ? Math.max(0, p.hp / p.maxHp) : 0;
  const mpPct = p ? Math.max(0, p.mp / p.maxMp) : 0;
  const expPct = Math.min(1, player.exp / Math.max(1, state.expToNext));

  return (
    <div ref={wrapRef} className="relative h-full w-full select-none overflow-hidden bg-[#9fd2ff]" style={{ touchAction: "none" }}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      {!ready && <div className="absolute inset-0 flex items-center justify-center text-lg font-bold text-[#2f2a3b]">Loading…</div>}

      {/* left column: name, level, HP / MP / EXP, then hidden-skill hints, the dungeon room and what just happened */}
      <div className="pointer-events-none absolute left-2 top-2 flex w-[min(300px,40vw)] flex-col">
        <div className="rounded-xl border-[3px] border-[#2f2a3b] bg-[#fdf6e3]/95 px-2 py-1 text-[#2f2a3b] shadow-[0_3px_0_#2f2a3b]">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-xs font-black sm:text-sm">{player.name}</span>
            <span className="shrink-0 text-[10px] font-bold sm:text-[11px]">
              Lv {player.level} · {state.className} · {player.gold}g
            </span>
          </div>
          {[
            { label: "HP", pct: hpPct, color: "#e0533d", text: `${Math.max(0, Math.round(p?.hp ?? 0))}/${p?.maxHp ?? 0}` },
            { label: "MP", pct: mpPct, color: "#3f8fd9", text: `${Math.round(p?.mp ?? 0)}/${p?.maxMp ?? 0}` },
            { label: "EXP", pct: expPct, color: "#f0b429", text: `${player.exp}/${state.expToNext}` },
          ].map((b) => (
            <div key={b.label} className="flex items-center gap-1">
              <span className="w-6 text-[9px] font-black">{b.label}</span>
              <div className="relative h-2.5 flex-1 overflow-hidden rounded-full border-2 sm:h-3 border-[#2f2a3b] bg-[#d9d2c3]">
                <div className="h-full transition-[width] duration-150" style={{ width: `${b.pct * 100}%`, background: b.color }} />
                <span className="absolute inset-0 flex items-center justify-center text-[8px] font-black leading-none sm:text-[9px] text-white [text-shadow:0_0_2px_#2f2a3b,0_0_2px_#2f2a3b]">{b.text}</span>
              </div>
            </div>
          ))}
        </div>
        <HintStrip hints={state.hints} />
        {e?.run && (
          <div className="mt-1 w-fit rounded-lg bg-black/45 px-2 py-1 text-[11px] font-bold text-white">
            {e.run.cleared ? "Hollow cleared!" : `Room ${Math.min(e.run.room + 1, e.run.totalRooms)} of ${e.run.totalRooms}`}
          </div>
        )}
        <div className="mt-1 flex flex-col gap-1">
          {toasts.map((t) => (
            <div key={t.id} className="w-fit max-w-[60vw] rounded-md bg-black/55 px-2 py-0.5 text-xs font-bold" style={{ color: t.color }}>
              {t.text}
            </div>
          ))}
        </div>
      </div>

      {/* top right: view switch, potion and menu */}
      <div className="absolute right-2 top-2 flex gap-2">
        {onSwitchView && (
          <button
            type="button"
            className="relative flex h-11 items-center justify-center rounded-xl border-[3px] border-[#2f2a3b] bg-[#fdf6e3] px-2 text-xs font-black text-[#2f2a3b] shadow-[0_3px_0_#2f2a3b] active:translate-y-[2px]"
            onClick={() => {
              engineRef.current?.flush();
              onSwitchView();
            }}
            title="Switch to the 2D side view"
          >
            2D
          </button>
        )}
        <button
          type="button"
          className="relative flex h-11 w-11 items-center justify-center rounded-xl border-[3px] border-[#2f2a3b] bg-[#fdf6e3] text-xl shadow-[0_3px_0_#2f2a3b] active:translate-y-[2px]"
          aria-label="Eat food"
          title="Eat food (Q)"
          onPointerDown={(ev) => {
            ev.preventDefault();
            e?.press("potion");
          }}
        >
          🍖<span className="absolute -bottom-1 -right-1 rounded-full bg-[#2f2a3b] px-1.5 text-[10px] font-bold text-white">{food}</span>
        </button>
        <button
          type="button"
          className="relative flex h-11 items-center justify-center rounded-xl border-[3px] border-[#2f2a3b] bg-[#fdf6e3] px-3 text-sm font-black text-[#2f2a3b] shadow-[0_3px_0_#2f2a3b] active:translate-y-[2px]"
          onClick={() => void openMenu()}
          aria-label="Menu"
        >
          MENU
          {menuBadge && <span className="absolute -right-1.5 -top-1.5 h-3.5 w-3.5 rounded-full border-2 border-[#2f2a3b] bg-[#f0b429]" />}
        </button>
      </div>

      {/* the boss */}
      {boss && (
        <div className="pointer-events-none absolute left-1/2 top-[74px] w-[min(460px,70vw)] -translate-x-1/2 text-center sm:top-3">
          <div className="text-sm font-black text-white [text-shadow:0_2px_0_#2f2a3b]">{MONSTERS[boss.id].name}</div>
          <div className="h-4 overflow-hidden rounded-full border-4 border-[#2f2a3b] bg-[#3a3446]">
            <div className="h-full bg-[#c74ad9] transition-[width]" style={{ width: `${(Math.max(0, boss.hp) / boss.maxHp) * 100}%` }} />
          </div>
        </div>
      )}

      {/* place name */}
      {banner && (
        <div className="pointer-events-none absolute left-1/2 top-[30%] -translate-x-1/2 rounded-2xl border-4 border-[#2f2a3b] bg-[#fdf6e3] px-6 py-2 text-xl font-black text-[#2f2a3b] shadow-[0_4px_0_#2f2a3b]">
          {banner}
        </div>
      )}

      <TouchControls3D
        engine={e}
        stick={stick}
        onLook={(dx, dy) => {
          const w = worldRef.current;
          if (!w) return;
          w.camYaw -= dx * LOOK_SPEED * 1.4;
          w.camPitch += dy * LOOK_SPEED * 1.4;
        }}
        skills={skillButtons}
        context={contextLabel}
        onContext={() => near && void interact(near)}
        disabled={!!dialog || paused || !ready}
      />

      {/* PC: what's nearby, what right click does, and the skill bar */}
      <div className="pointer-events-none absolute inset-x-0 bottom-2 hidden flex-col items-center gap-1.5 [@media(pointer:fine)]:flex">
        {contextLabel && !dialog && (
          <div className="rounded-lg border-[3px] border-[#2f2a3b] bg-[#f0b429] px-3 py-1 text-sm font-black text-[#2f2a3b] shadow-[0_3px_0_#2f2a3b]">E · {contextLabel}</div>
        )}
        <div className="flex items-end gap-1.5">
          <div className="mr-2 rounded-lg bg-black/45 px-2 py-1 text-center text-[11px] font-bold leading-tight text-white">
            <div className="text-white/70">Right click</div>
            <div className="text-[#ffd34d]">{rightClick}</div>
            <div className="text-[9px] text-white/60">wheel to change</div>
          </div>
          {skillButtons.map((s, i) => (
            <div
              key={i}
              className={`relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl border-[3px] text-[10px] font-black leading-tight text-white ${attackSel === i ? "border-[#ffd34d]" : "border-[#2f2a3b]"} ${s ? (s.gauge ? (s.gauge.charged ? "bg-[#c98a12]" : "bg-[#5a4a2a]") : "bg-[#7a52c7]") : "bg-black/30"} ${s && !s.enoughMp ? "opacity-50" : ""}`}
              title={s?.name}
            >
              {s && <span className="relative z-10 px-0.5 text-center">{s.short}</span>}
              {s && s.cdPct > 0 && <span className="absolute inset-x-0 bottom-0 bg-black/55" style={{ height: `${s.cdPct * 100}%` }} />}
              <span className="absolute left-1 top-0 z-10 text-[9px] text-white/80">{i + 1}</span>
              {s?.gauge && <span className="absolute inset-x-0 bottom-0.5 z-10 text-center text-[9px] font-bold text-[#ffe9a8]">{s.gauge.value}</span>}
            </div>
          ))}
        </div>
        <p className="whitespace-nowrap rounded bg-black/40 px-2 py-0.5 text-[11px] text-white/90">
          WASD move · mouse look · Right click attack · Left click block (parry: right as the hit lands) · wheel picks the attack · 1-4 skills · Space jump · E talk · Q eat · M menu
        </p>
      </div>

      {/* PC: click to play */}
      {ready && !locked && !dialog && !paused && (
        <div className="pointer-events-none absolute left-1/2 top-[16%] hidden -translate-x-1/2 rounded-2xl border-4 border-[#2f2a3b] bg-[#fdf6e3]/95 px-5 py-3 text-center text-[#2f2a3b] shadow-[0_4px_0_#2f2a3b] [@media(pointer:fine)]:block">
          <div className="text-lg font-black">Click to play</div>
          <div className="text-xs font-bold">The mouse turns the camera. Press Esc to get the mouse back.</div>
        </div>
      )}
      {/* aim dot */}
      {locked && <div className="pointer-events-none absolute left-1/2 top-[45%] h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-white/80 shadow" />}

      {portraitTip && !dialog && (
        <button
          type="button"
          className="absolute inset-x-6 top-[45%] rounded-xl border-4 border-[#2f2a3b] bg-[#fdf6e3] p-3 text-center text-sm font-bold text-[#2f2a3b]"
          onClick={() => setPortraitTip(false)}
        >
          Turn your phone sideways for a bigger view. (Tap to hide)
        </button>
      )}

      {dialog && (
        <div className="absolute inset-x-0 bottom-0 z-30 mx-auto max-w-2xl">
          <TextBox key={dialogKey} dialog={dialog} bus={bus} close={() => setDialog(null)} />
        </div>
      )}
    </div>
  );
}
