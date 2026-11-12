"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client";
import { ITEMS, MONSTERS, ZONES } from "@/lib/game/data/world";
import { SIDE_INN, SIDE_MAPS, SIDE_START, type PortalDef, type SideMapId } from "@/lib/game/data/sidemaps";
import type { LiveReport } from "@/lib/game/live";
import { attackerFromPetStats } from "@/lib/game/pets";
import type { UnlockNotice, getState } from "@/lib/game/service";
import type { InputBus } from "../world/input";
import TextBox, { type Dialog } from "../world/TextBox";
import { Engine, type CombatInfo, type Nearby, type Press } from "./engine";
import { lookFor, type Look } from "./hero";
import { bossOf, drawFrame, updateCamera, type Camera } from "./render";
import { loadArt } from "./sprites";
import TouchControls, { type SkillButton } from "./TouchControls";

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

const SAVE_KEY = (id: string) => `ub-side-${id}`;

/** The pet that's out, as the game screen needs it. */
function petOf(st: GameState) {
  const p = st.pets.find((x) => x.active);
  return p ? { species: p.species, attacker: attackerFromPetStats(p.stats) } : null;
}

function loadSpot(playerId: string): { map: SideMapId; x: number; row: number } {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY(playerId)) ?? "null");
    if (s && SIDE_MAPS[s.map as SideMapId] && typeof s.x === "number" && typeof s.row === "number") {
      // A dungeon attempt never survives a reload: start outside the cave.
      if (s.map === "hollow_of_the_mire") return { map: "mirewood_fields", x: 70, row: 11 };
      return s;
    }
  } catch {
    // no saved spot
  }
  return { ...SIDE_START };
}

function shortName(name: string) {
  const words = name.split(/\s+/);
  return words.length > 1 ? words.map((w) => w[0]).join("").slice(0, 3).toUpperCase() : name.slice(0, 5);
}

/** Every key binding for PC in one place. */
const KEYS: Record<string, { held?: keyof Engine["held"]; press?: Press | "menu" }> = {
  ArrowLeft: { held: "left" },
  a: { held: "left" },
  A: { held: "left" },
  ArrowRight: { held: "right" },
  d: { held: "right" },
  D: { held: "right" },
  ArrowUp: { held: "up" },
  w: { held: "up" },
  W: { held: "up" },
  ArrowDown: { held: "down" },
  s: { held: "down" },
  S: { held: "down" },
  " ": { press: "jump" },
  Alt: { press: "jump" },
  j: { held: "attack" },
  J: { held: "attack" },
  z: { held: "attack" },
  Z: { held: "attack" },
  Control: { held: "attack" },
  k: { held: "block" },
  K: { held: "block" },
  x: { held: "block" },
  X: { held: "block" },
  Shift: { held: "block" },
  "1": { press: "skill0" },
  "2": { press: "skill1" },
  "3": { press: "skill2" },
  "4": { press: "skill3" },
  q: { press: "potion" },
  Q: { press: "potion" },
  e: { press: "interact" },
  E: { press: "interact" },
  Enter: { press: "interact" },
  m: { press: "menu" },
  M: { press: "menu" },
  Tab: { press: "menu" },
  Escape: { press: "menu" },
};

export default function SideGame({
  state,
  bus,
  paused,
  refresh,
  onMenu,
  onShop,
  onUnlocks,
  onError,
  registerSync,
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
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [ready, setReady] = useState(false);
  const [artError, setArtError] = useState<string | null>(null);
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
  const cam = useRef<Camera>({ x: 0, y: 0, scale: 1 });
  const pausedRef = useRef(paused);
  pausedRef.current = paused || !!dialog || busy;

  const { player } = state;
  const look: Look = useMemo(() => lookFor(player.appearance, player.classId), [player.appearance, player.classId]);
  const npcLooks = useMemo(() => {
    const out: Record<string, Look> = {};
    for (const m of Object.values(SIDE_MAPS))
      for (const n of m.npcs)
        out[n.id] = { skin: n.look.skin, hair: n.look.hair, shirt: n.look.shirt, eyes: "#5a4030", hairStyle: n.look.hairStyle, female: n.look.female, build: "Average" };
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
    loadArt()
      .then(async () => {
        if (cancelled) return;
        const st = stateRef.current;
        let spot = loadSpot(st.player.id);
        if (st.player.currentHp <= 0) spot = { ...SIDE_INN };
        const zone = SIDE_MAPS[spot.map].zoneId;
        // the game starts at once; the server hears where you are first, in order
        queueCall("/api/live", { type: "enter", zoneId: zone }).catch((err: Error) => onError(err.message));
        const e = new Engine({
          mapId: spot.map,
          x: spot.x,
          row: spot.row,
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
        e.setPet(petOf(st));
        engineRef.current = e;
        setEngine(e);
        adoptNext.current = false;
        setReady(true);
        setBanner(ZONES[zone].name);
        if (st.player.currentHp <= 0) say({ lines: ["You're back in Thornvale, badly hurt.", "Rest at the inn (the door on the left) to recover."] });
      })
      .catch((err) => setArtError((err as Error).message));
    return () => {
      cancelled = true;
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
    e.setPet(petOf(state));
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
      localStorage.setItem(SAVE_KEY(stateRef.current.player.id), JSON.stringify({ map: e.map.id, x: e.player.x / 64, row: Math.round(e.player.y / 64) }));
    } catch {
      // storage may be blocked
    }
  }, []);

  const travel = useCallback(
    (to: SideMapId, x: number, row: number) => {
      const e = engineRef.current;
      if (!e) return false;
      const zone = ZONES[SIDE_MAPS[to].zoneId];
      if (zone.kind === "dungeon" && e.player.hp <= 0) {
        say({ lines: ["You're too hurt to go in. Rest at the inn first."] });
        return false;
      }
      // walk straight onto the new map; the server hears about it in order, in the background
      const entering = enterZone(zone.id);
      e.setMap(to, x, row, zone.kind === "dungeon" ? { room: 0, totalRooms: zone.rooms!.length, cleared: false } : null);
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
    (p: PortalDef) => {
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
            { label: "Enter", run: () => void travel("hollow_of_the_mire", p.toX, p.toRow) },
            { label: "Leave", run: () => {} },
          ],
        });
      }
      if (p.kind === "dungeon_exit") return void travel("mirewood_fields", p.toX, p.toRow);
      if (e.run && !e.run.cleared) {
        return say({
          lines: ["Leave the Hollow? This attempt ends, and the next time counts as a new attempt."],
          choices: [
            { label: "Leave", run: () => void travel(p.to!, p.toX, p.toRow) },
            { label: "Stay", run: () => {} },
          ],
        });
      }
      if (e.map.id === "thornvale" && hp <= 0) return say({ lines: ["You're too hurt to leave town. Rest at the inn first."] });
      void travel(p.to!, p.toX, p.toRow);
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

  // ---------- keyboard ----------

  useEffect(() => {
    const typing = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    };
    const down = (ev: KeyboardEvent) => {
      const e = engineRef.current;
      if (!e || typing(ev) || ev.metaKey) return;
      const k = KEYS[ev.key];
      if (!k) return;
      if (pausedRef.current) return; // dialogs and menus use the same keys
      ev.preventDefault();
      if (k.held) {
        e.held[k.held] = true;
        if (k.held === "up" && !ev.repeat) {
          const n = e.nearby();
          if (n && n.kind === "portal") void interact(n);
        }
      }
      if (k.press && !ev.repeat) {
        if (k.press === "menu") return void openMenu();
        if (k.press === "interact") {
          const n = e.nearby();
          if (n) void interact(n);
          return;
        }
        e.press(k.press);
      }
    };
    const up = (ev: KeyboardEvent) => {
      const e = engineRef.current;
      const k = KEYS[ev.key];
      if (e && k?.held) e.held[k.held] = false;
    };
    const blur = () => {
      const e = engineRef.current;
      if (e) Object.assign(e.held, { left: false, right: false, up: false, down: false, attack: false, block: false });
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

  // ---------- the loop ----------

  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    let last = performance.now();
    let lastHud = 0;
    let lastSync = performance.now();
    let lastSave = 0;
    let deathHandled = 0;
    let first = true;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const e = engineRef.current;
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!e || !canvas || !wrap) return;
      const dt = Math.min(100, now - last);
      last = now;
      e.paused = pausedRef.current;
      if (e.paused) e.now = now;
      e.update(dt, now);
      // size the canvas to the screen
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = wrap.clientWidth;
      const ch = wrap.clientHeight;
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
      }
      const css = cw > ch ? Math.min(ch / 600, cw / 760) : Math.min(cw / 520, ch / 900);
      cam.current.scale = css * dpr;
      updateCamera(cam.current, e, canvas.width, canvas.height, first);
      first = false;
      const ctx = canvas.getContext("2d")!;
      drawFrame(ctx, e, cam.current, canvas.width, canvas.height, { look, name: stateRef.current.player.name, npcLooks });
      // send what happened every so often
      if (now - lastSync > 12000 || e.unsentHits > 80) {
        lastSync = now;
        if (e.hasUnsent && !e.player.dead) e.flush();
      }
      if (now - lastSave > 2000) {
        lastSave = now;
        savePos();
      }
      // falling in a fight: wake up at the inn
      if (e.player.dead && deathHandled !== e.player.diedAt && now - e.player.diedAt > RESPAWN_DELAY_MS) {
        // falling in a fight: back at the inn at once, fully healed (the server agrees in the background)
        deathHandled = e.player.diedAt;
        const entering = enterZone("thornvale");
        e.respawn(SIDE_INN.map, SIDE_INN.x, SIDE_INN.row, e.player.maxHp, e.player.maxMp);
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
  }, [ready, look, npcLooks, flush, refresh, rest, say, savePos, enterZone, toast]);

  // ---------- HUD ----------

  if (artError) return <div className="flex h-full items-center justify-center p-6 text-center text-muted">{artError}. Check your connection and reload.</div>;

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
  const boss = e ? bossOf(e) : null;
  const food = e?.bag.filter((b) => b.qty > 0 && ITEMS[b.itemId]?.edible).reduce((n, b) => n + b.qty, 0) ?? 0;
  const menuBadge = state.skills.some((s) => s.status === "offered") || player.freePoints > 0;
  const hpPct = p ? Math.max(0, p.hp / p.maxHp) : 0;
  const mpPct = p ? Math.max(0, p.mp / p.maxMp) : 0;
  const expPct = Math.min(1, player.exp / Math.max(1, state.expToNext));

  return (
    <div ref={wrapRef} className="relative h-full w-full select-none overflow-hidden bg-[#9fd2ff]" style={{ touchAction: "none" }}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {!ready && <div className="absolute inset-0 flex items-center justify-center text-lg font-bold text-[#2f2a3b]">Loading…</div>}

      {/* status: name, level, HP / MP / EXP */}
      <div className="pointer-events-none absolute left-2 top-2 w-[min(300px,40vw)] rounded-xl border-[3px] border-[#2f2a3b] bg-[#fdf6e3]/95 px-2 py-1 text-[#2f2a3b] shadow-[0_3px_0_#2f2a3b]">
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

      {/* top right: potion and menu */}
      <div className="absolute right-2 top-2 flex gap-2">
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

      {/* dungeon progress */}
      {e?.run && (
        <div className="pointer-events-none absolute left-2 top-[84px] rounded-lg bg-black/45 px-2 py-1 text-[11px] font-bold text-white">
          {e.run.cleared ? "Hollow cleared!" : `Room ${Math.min(e.run.room + 1, e.run.totalRooms)} of ${e.run.totalRooms}`}
        </div>
      )}

      {/* place name */}
      {banner && (
        <div className="pointer-events-none absolute left-1/2 top-[30%] -translate-x-1/2 rounded-2xl border-4 border-[#2f2a3b] bg-[#fdf6e3] px-6 py-2 text-xl font-black text-[#2f2a3b] shadow-[0_4px_0_#2f2a3b]">
          {banner}
        </div>
      )}

      {/* what just happened */}
      <div className="pointer-events-none absolute left-2 top-[110px] flex flex-col gap-1">
        {toasts.map((t) => (
          <div key={t.id} className="w-fit max-w-[60vw] rounded-md bg-black/55 px-2 py-0.5 text-xs font-bold" style={{ color: t.color }}>
            {t.text}
          </div>
        ))}
      </div>

      <TouchControls
        engine={e}
        skills={skillButtons}
        context={contextLabel}
        onContext={() => near && void interact(near)}
        disabled={!!dialog || paused || !ready}
      />

      <p className="pointer-events-none absolute bottom-1 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-black/40 px-2 py-0.5 text-[11px] text-white/90 [@media(pointer:fine)]:block">
        ← → move · ↑ ↓ ladders · Space jump · Z / J attack · X / K block (parry: right as the hit lands) · 1-4 skills · E talk · Q eat · M menu
      </p>

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
