"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { INN_SPOT, MAPS, START, TILE, buildingAt, npcAt, tileAt, walkable, type Facing, type MapId, type Npc } from "@/lib/game/data/maps";
import { ZONES } from "@/lib/game/data/world";
import { personSheet, renderMap, tallGrassFront, type Look, type PersonSheet } from "./art";
import type { Dir, InputBus } from "./input";
import { useButtons } from "./input";
import TextBox, { type Dialog } from "./TextBox";

const STEP_MS = 170; // time to walk one tile
const TURN_MS = 90; // a tap shorter than this turns without stepping
const GRASS_RATE = 1 / 9; // chance of a wild monster per step in tall grass
const SWAMP_RATE = 1 / 7;

export interface Spot {
  map: MapId;
  x: number;
  y: number;
  facing: Facing;
}

const DELTA: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPPOSITE: Record<Facing, Facing> = { up: "down", down: "up", left: "right", right: "left" };

function loadSpot(key: string): Spot {
  try {
    const s = JSON.parse(localStorage.getItem(key) ?? "null") as Spot | null;
    if (s && MAPS[s.map] && walkable(MAPS[s.map], s.x, s.y)) return s;
  } catch {
    /* storage blocked or bad data: start in town */
  }
  return { ...START };
}

export interface OverworldProps {
  bus: InputBus;
  playerId: string;
  look: Look;
  hp: number;
  paused: boolean; // a menu or battle is open
  wakeAtInn: number; // bumped after losing a fight
  dungeonAttempts: Record<string, number>;
  onEncounter: (zoneId: string, terrain: "grass" | "swamp" | null) => Promise<boolean>;
  onRest: () => Promise<string[] | null>;
  onRumors: () => Promise<string[] | null>;
  onShop: () => void;
  onMenu: () => void;
}

export default function Overworld(p: OverworldProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 240, h: 160, scale: 2 });
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [dialogKey, setDialogKey] = useState(0);
  const [zoneLabel, setZoneLabel] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  const storeKey = `ub-spot-${p.playerId}`;
  const me = useRef<Spot & { from: { x: number; y: number } | null; t0: number; frame: number }>({
    ...START,
    from: null,
    t0: 0,
    frame: 0,
  });
  const busy = useRef(false); // waiting on the server (a fight is starting)
  const turnAt = useRef(0);
  const grace = useRef(0); // steps with no wild monsters after a fight
  const npcFacing = useRef<Record<string, Facing>>({});
  const props = useRef(p);
  props.current = p;
  const dialogOpen = useRef(false);
  dialogOpen.current = dialog !== null;

  const say = useCallback((d: Dialog) => {
    setDialogKey((k) => k + 1);
    setDialog(d);
  }, []);

  // ---------- load position, art ----------
  useEffect(() => {
    const s = loadSpot(storeKey);
    Object.assign(me.current, s, { from: null });
    setZoneLabel(ZONES[MAPS[s.map].zoneId].name);
  }, [storeKey]);

  const save = useCallback(() => {
    const { map, x, y, facing } = me.current;
    try {
      localStorage.setItem(storeKey, JSON.stringify({ map, x, y, facing }));
    } catch {
      /* private mode: position just isn't remembered */
    }
  }, [storeKey]);

  useEffect(() => {
    if (!p.wakeAtInn) return;
    Object.assign(me.current, INN_SPOT, { from: null });
    grace.current = 4;
    save();
    setZoneLabel(ZONES.thornvale.name);
    say({ lines: ["You were carried back to Thornvale.", "Rest at the inn to recover your HP."] });
  }, [p.wakeAtInn, save, say]);

  const art = useRef<{
    maps: Partial<Record<MapId, HTMLCanvasElement[]>>;
    player: PersonSheet | null;
    npcs: Record<string, PersonSheet>;
    grass: HTMLCanvasElement | null;
  }>({ maps: {}, player: null, npcs: {}, grass: null });

  useEffect(() => {
    art.current.player = personSheet(p.look);
  }, [p.look]);

  useEffect(() => {
    const a = art.current;
    for (const id of Object.keys(MAPS) as MapId[]) a.maps[id] = [renderMap(MAPS[id], 0), renderMap(MAPS[id], 1)];
    for (const m of Object.values(MAPS))
      for (const n of m.npcs)
        a.npcs[n.id] = personSheet({
          skin: n.look.skin,
          hair: n.look.hair,
          eyes: "#2a2a2e",
          shirt: n.look.shirt,
          hairStyle: "Short",
          female: false,
          build: "Average",
        });
    a.grass = tallGrassFront();
  }, []);

  // ---------- canvas size: whole-number zoom so pixels stay square ----------
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      const cw = el.clientWidth;
      const scale = cw >= 900 ? 4 : cw >= 640 ? 3 : 2;
      const w = Math.floor(cw / scale);
      const h = Math.min(Math.round((w * 2) / 3), Math.floor((window.innerHeight * 0.62) / scale));
      setSize({ w, h: Math.max(120, h), scale });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---------- interactions ----------
  const facingTile = () => {
    const { x, y, facing } = me.current;
    const [dx, dy] = DELTA[facing];
    return { x: x + dx, y: y + dy };
  };

  const talk = useCallback(
    async (n: Npc) => {
      npcFacing.current[n.id] = OPPOSITE[me.current.facing];
      busy.current = true;
      const r = await props.current.onRumors();
      busy.current = false;
      const lines = r && r.length ? r.map((s) => `“${s}”`) : ["“Nothing new to tell you.”"];
      say({ lines, onDone: () => delete npcFacing.current[n.id] });
    },
    [say],
  );

  const interact = useCallback(() => {
    const m = MAPS[me.current.map];
    const { x, y } = facingTile();
    const n = npcAt(m, x, y);
    if (n) return void talk(n);
    const sign = m.signs.find((s) => s.x === x && s.y === y);
    if (sign) {
      const z = ZONES[sign.zoneId];
      return say({ lines: [z.name, z.description] });
    }
    const b = buildingAt(m, x, y);
    if (b && me.current.facing === "up" && b.door.x === x && b.door.y === y) return void openDoor(b.kind);
  }, [say, talk]); // eslint-disable-line react-hooks/exhaustive-deps

  const openDoor = useCallback(
    (kind: "inn" | "shop" | "house") => {
      if (kind === "house") return say({ lines: ["The door is locked."] });
      if (kind === "shop") return props.current.onShop();
      say({
        lines: ["Welcome to the inn! Rest here to restore your HP and MP?"],
        choices: [
          {
            label: "Rest",
            run: async () => {
              busy.current = true;
              const log = await props.current.onRest();
              busy.current = false;
              say({ lines: log ?? ["You couldn't rest right now."] });
            },
          },
          { label: "Leave", run: () => {} },
        ],
      });
    },
    [say],
  );

  const startFight = useCallback(async (zoneId: string, terrain: "grass" | "swamp" | null) => {
    busy.current = true;
    setFlash(true);
    const ok = await props.current.onEncounter(zoneId, terrain);
    setTimeout(() => setFlash(false), 450);
    busy.current = false;
    grace.current = 3;
    return ok;
  }, []);

  /** Called after each finished step: doors, warps, the cave and wild monsters. */
  const arrive = useCallback(() => {
    const s = me.current;
    const m = MAPS[s.map];
    save();
    const warp = m.warps.find((w) => w.x === s.x && w.y === s.y);
    if (warp) {
      Object.assign(s, { map: warp.to, x: warp.toX, y: warp.toY, facing: warp.facing, from: null });
      save();
      setZoneLabel(ZONES[MAPS[warp.to].zoneId].name);
      return;
    }
    if (m.cave && s.x === m.cave.x && s.y === m.cave.y) {
      const z = ZONES[m.cave.zoneId];
      const cave = m.cave;
      const tries = props.current.dungeonAttempts[z.id] ?? 0;
      const stepOut = () => {
        Object.assign(s, { x: cave.exitX, y: cave.exitY, facing: "down", from: null });
        save();
      };
      return say({
        lines: [
          z.name,
          z.description,
          tries === 0
            ? "Your first attempt. Legends say the Hollow rewards those who clear it alone on their first try."
            : `Attempts so far: ${tries}. Go in?`,
        ],
        choices: [
          {
            label: "Enter",
            run: async () => {
              if (props.current.hp <= 0) {
                stepOut();
                return say({ lines: ["You're too hurt to go in. Rest at the inn first."] });
              }
              const ok = await startFight(z.id, null);
              stepOut();
              if (!ok) say({ lines: ["Something went wrong. Try again in a moment."] });
            },
          },
          { label: "Leave", run: stepOut },
        ],
      });
    }
    const t = tileAt(m, s.x, s.y);
    if (t === "," || t === "%") {
      if (grace.current > 0) {
        grace.current--;
        return;
      }
      if (props.current.hp <= 0) return;
      if (Math.random() < (t === "%" ? SWAMP_RATE : GRASS_RATE)) void startFight(m.zoneId, t === "%" ? "swamp" : "grass");
    }
  }, [save, say, startFight]);

  // ---------- buttons ----------
  useButtons(p.bus, (b) => {
    if (props.current.paused || dialogOpen.current || busy.current) return false;
    if (b === "a" && !me.current.from) interact();
    if (b === "menu" || b === "b") props.current.onMenu();
    return false;
  });

  // ---------- game loop ----------
  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const s = me.current;
      const pr = props.current;
      const frozen = pr.paused || dialogOpen.current || busy.current;

      // walking
      if (s.from) {
        const k = (now - s.t0) / STEP_MS;
        if (k >= 1) {
          s.from = null;
          arrive();
        }
      }
      if (frozen) pr.bus.takeTap(); // presses meant for a menu shouldn't walk you later
      if (!s.from && !frozen) {
        const tapped = pr.bus.takeTap();
        const held = pr.bus.current();
        if (!held && tapped && tapped !== s.facing) {
          s.facing = tapped; // quick tap: just turn
          turnAt.current = now;
        }
        const d = held;
        if (d) {
          const m = MAPS[s.map];
          const [dx, dy] = DELTA[d];
          const nx = s.x + dx;
          const ny = s.y + dy;
          const turning = s.facing !== d;
          if (turning) {
            // a quick tap only turns you around (so you can face someone to talk)
            s.facing = d;
            turnAt.current = now;
          }
          const settled = now - turnAt.current >= TURN_MS;
          if (!settled) {
            /* still turning */
          } else if (walkable(m, nx, ny) && !npcAt(m, nx, ny)) {
            s.from = { x: s.x, y: s.y };
            s.x = nx;
            s.y = ny;
            s.t0 = now;
            s.frame = (s.frame + 1) % 2;
          } else {
            // walking into the inn or shop door opens it
            const b = buildingAt(m, nx, ny);
            if (b && d === "up" && b.door.x === nx && b.door.y === ny && b.kind !== "house") {
              pr.bus.releaseAll();
              openDoor(b.kind);
            }
          }
        }
      }

      // draw
      const c = canvasRef.current;
      const a = art.current;
      const mapArt = a.maps[s.map];
      if (!c || !mapArt || !a.player) return;
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      const m = MAPS[s.map];
      const k = s.from ? Math.min(1, (now - s.t0) / STEP_MS) : 1;
      const fx = s.from ? s.from.x + (s.x - s.from.x) * k : s.x;
      const fy = s.from ? s.from.y + (s.y - s.from.y) * k : s.y;
      const W = m.tiles[0].length * TILE;
      const H = m.tiles.length * TILE;
      const camX = Math.round(Math.max(0, Math.min(W - c.width, fx * TILE + 8 - c.width / 2)));
      const camY = Math.round(Math.max(0, Math.min(H - c.height, fy * TILE + 8 - c.height / 2)));
      ctx.fillStyle = "#1b3a1f";
      ctx.fillRect(0, 0, c.width, c.height);
      const offX = W < c.width ? Math.floor((c.width - W) / 2) : -camX;
      const offY = H < c.height ? Math.floor((c.height - H) / 2) : -camY;
      ctx.drawImage(mapArt[Math.floor(now / 600) % 2], offX, offY);

      const people: { y: number; draw: () => void }[] = [];
      for (const n of m.npcs) {
        const sheet = a.npcs[n.id];
        if (!sheet) continue;
        people.push({ y: n.y, draw: () => ctx.drawImage(sheet.frame(npcFacing.current[n.id] ?? n.facing, 0), offX + n.x * TILE, offY + n.y * TILE - 5) });
      }
      const walkFrame = s.from ? (k < 0.5 ? 1 + s.frame : 0) : 0;
      const px = Math.round(offX + fx * TILE);
      const py = Math.round(offY + fy * TILE - 5);
      people.push({
        y: fy,
        draw: () => {
          ctx.drawImage(a.player!.frame(s.facing, walkFrame), px, py);
          // tall grass hides your legs, like it should
          if (a.grass && !s.from && tileAt(m, s.x, s.y) === ",") ctx.drawImage(a.grass, px, offY + s.y * TILE);
        },
      });
      people.sort((u, v) => u.y - v.y).forEach((q) => q.draw());
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [arrive, openDoor]);

  // show the area name for a moment when it changes
  useEffect(() => {
    if (!zoneLabel) return;
    const t = setTimeout(() => setZoneLabel(null), 1800);
    return () => clearTimeout(t);
  }, [zoneLabel]);

  return (
    <div ref={wrapRef} className="relative w-full overflow-hidden rounded-lg border-4 border-[#1b1a22] bg-[#1b3a1f]">
      <canvas
        ref={canvasRef}
        width={size.w}
        height={size.h}
        className="block"
        style={{ width: size.w * size.scale, height: size.h * size.scale, imageRendering: "pixelated" }}
        aria-label="Game map"
      />
      {zoneLabel && <div className="pixel-box absolute left-2 top-2 px-3 py-1 text-sm font-bold">{zoneLabel}</div>}
      {flash && <div className="encounter-flash pointer-events-none absolute inset-0" />}
      {dialog && <TextBox key={dialogKey} dialog={dialog} bus={p.bus} close={() => setDialog(null)} />}
    </div>
  );
}
