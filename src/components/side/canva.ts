// The Canva chibi art for the 2D view (sample: Swordsman, Green Slime, the
// dusk sky, ground, inn and cottage). Anything without Canva art yet keeps
// being drawn the old way, so the game always has a picture for everything.

import type { ClassId, WeaponType } from "@/lib/game/types";
import { makeCanvas } from "./sprites";
import type { Pose } from "./hero";

type Ctx = CanvasRenderingContext2D;

interface Art {
  src: string;
  /** Where the feet are, from the left edge, as a share of the width. */
  footX: number;
  img?: HTMLImageElement;
}

const art = (name: string, footX = 0.5): Art => ({ src: `/art/canva/${name}.webp`, footX });

type HeroArt = { weapon: WeaponType; idle: Art; walk: Art; attack: Art };
const HEROES: Partial<Record<ClassId, HeroArt>> = {
  swordsman: {
    weapon: "sword",
    idle: art("hero-swordsman-idle", 0.398),
    walk: art("hero-swordsman-walk", 0.512),
    attack: art("hero-swordsman-attack", 0.313),
  },
};
const MONSTERS: Record<string, Art> = {
  green_slime: art("monster-green_slime", 0.489),
};
const SKY = art("sky-dusk");
const GROUND = art("ground");
const BUILDINGS = { inn: art("building-inn", 0.569), house: art("building-house", 0.499) };

const ALL: Art[] = [...Object.values(HEROES).flatMap((h) => [h!.idle, h!.walk, h!.attack]), ...Object.values(MONSTERS), SKY, GROUND, BUILDINGS.inn, BUILDINGS.house];

let loading: Promise<void> | null = null;
/** Load the Canva pictures once. A picture that fails to load is skipped (old art is used). */
export function loadCanvaArt(): Promise<void> {
  loading ??= Promise.all(
    ALL.map(
      (a) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            a.img = img;
            resolve();
          };
          img.onerror = () => resolve();
          img.src = a.src;
        }),
    ),
  ).then(() => undefined);
  return loading;
}

const ready = (a: Art | undefined): a is Art & { img: HTMLImageElement } => !!a?.img;

/** Draw a picture with its feet at (0,0), `h` units tall. */
function drawArt(ctx: Ctx, a: Art & { img: HTMLImageElement }, h: number) {
  const w = (a.img.width / a.img.height) * h;
  ctx.drawImage(a.img, -a.footX * w, -h, w, h);
}

// ---------- heroes ----------

const HERO_H = 116; // a bit taller than the 82-unit hitbox: the big chibi hair sits above it

/** True when this hero has Canva art for the weapon in hand. */
export function hasCanvaHero(classId: ClassId | undefined, weapon: WeaponType) {
  const h = classId ? HEROES[classId] : undefined;
  return !!h && h.weapon === weapon && ready(h.idle) && ready(h.walk) && ready(h.attack);
}

/** Draw the hero with the feet at (0,0), facing right. Call only when hasCanvaHero is true. */
export function drawCanvaHero(ctx: Ctx, classId: ClassId, pose: Pose, t: number, progress: number) {
  const h = HEROES[classId]!;
  ctx.save();
  if (pose === "dead") {
    // lying down on the ground
    ctx.translate(-HERO_H * 0.35, 0);
    ctx.rotate(-Math.PI / 2);
    ctx.translate(-12, HERO_H * 0.18);
    drawArt(ctx, h.idle as Art & { img: HTMLImageElement }, HERO_H);
    ctx.restore();
    return;
  }
  let a: Art = h.idle;
  let sx = 1;
  let sy = 1;
  if (pose === "walk") {
    const step = Math.floor(t / 170) % 2;
    a = step ? h.walk : h.idle;
    ctx.translate(0, -Math.abs(Math.sin((t / 170) * Math.PI)) * 3);
  } else if (pose === "jump" || pose === "fall") {
    a = h.walk;
    sy = pose === "jump" ? 1.04 : 0.98;
  } else if (pose === "attack" || pose === "cast") {
    a = h.attack;
    // a small lunge forward, then back
    ctx.translate(Math.sin(Math.min(1, progress) * Math.PI) * 8, 0);
  } else if (pose === "hurt") {
    ctx.translate(-4, 0);
    ctx.rotate(-0.08);
  } else if (pose === "block") {
    sx = 0.97;
    sy = 0.96;
  } else {
    // idle: breathing
    sy = 1 + Math.sin(t / 380) * 0.015;
  }
  ctx.scale(sx, sy);
  drawArt(ctx, a as Art & { img: HTMLImageElement }, HERO_H);
  ctx.restore();
}

// ---------- monsters ----------

export function hasCanvaMonster(id: string) {
  return ready(MONSTERS[id]);
}

/** Draw a monster with the feet at (0,0), facing right, `h` units tall. */
export function drawCanvaMonster(ctx: Ctx, id: string, pose: "rest" | "walk0" | "walk1" | "windup" | "attack" | "hurt" | "dead", t: number, h: number) {
  const a = MONSTERS[id] as Art & { img: HTMLImageElement };
  let sx = 1;
  let sy = 1;
  // a jelly wobble that never stops
  const wob = Math.sin(t / 260) * 0.03;
  sx += wob;
  sy -= wob;
  if (pose === "walk0") {
    sx *= 1.08;
    sy *= 0.92;
  } else if (pose === "walk1") {
    sx *= 0.94;
    sy *= 1.07;
  } else if (pose === "windup") {
    sx *= 1.14;
    sy *= 0.84;
  } else if (pose === "attack") {
    sx *= 0.88;
    sy *= 1.16;
  } else if (pose === "dead") {
    sx *= 1.3;
    sy *= 0.4;
  }
  ctx.save();
  ctx.scale(sx, sy);
  drawArt(ctx, a, h);
  ctx.restore();
}

// ---------- sky, ground and buildings ----------

export function hasCanvaWorld() {
  return ready(SKY) && ready(GROUND);
}

/** The dusk sky, moving slowly behind everything. */
export function drawCanvaSky(ctx: Ctx, camX: number, vw: number, vh: number) {
  const img = SKY.img!;
  const h = vh;
  const w = (img.width / img.height) * h;
  const off = (((camX * 0.12) % (w * 2)) + w * 2) % (w * 2);
  // mirror every other copy so the edges always meet
  for (let i = -1; i * w - off < vw; i++) {
    const x = i * w - off;
    if (x + w < 0) continue;
    ctx.save();
    if (((i % 2) + 2) % 2 === 1) {
      ctx.translate(x + w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, w, h);
    } else ctx.drawImage(img, x, 0, w, h);
    ctx.restore();
  }
}

let groundTiles: { top: HTMLCanvasElement; fill: HTMLCanvasElement } | null = null;
/** Two strips cut from the ground picture (~387 tall): the grass band on top, earth below. Each is 64 units tall. */
function groundStrips() {
  if (groundTiles) return groundTiles;
  const img = GROUND.img!;
  const w = Math.round(img.width * 0.5);
  const cut = (y0: number) => {
    const c = makeCanvas(w, 64);
    c.getContext("2d")!.drawImage(img, 0, y0, img.width, 128, 0, 0, w, 64);
    return c;
  };
  groundTiles = { top: cut(0), fill: cut(150) };
  return groundTiles;
}

/** Paint one solid ground tile. `top` = grass on top (open air above). */
export function drawCanvaGroundTile(ctx: Ctx, x: number, y: number, size: number, top: boolean) {
  const s = groundStrips();
  const img = top ? s.top : s.fill;
  const sx = (((x * size) % img.width) + img.width) % img.width;
  const w1 = Math.min(size, img.width - sx);
  ctx.drawImage(img, sx, 0, w1, 64, x * size, y * size, w1, size);
  if (w1 < size) ctx.drawImage(img, 0, 0, size - w1, 64, x * size + w1, y * size, size - w1, size);
}

/** Paint one floating platform tile: a grassy ledge with rounded ends. */
export function drawCanvaPlatformTile(ctx: Ctx, x: number, y: number, size: number, leftEnd: boolean, rightEnd: boolean) {
  const s = groundStrips();
  const h = size * 0.62;
  const px = x * size;
  const py = y * size;
  const r = h / 2;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(px, py, size, h, [leftEnd ? r : 0, rightEnd ? r : 0, rightEnd ? r : 0, leftEnd ? r : 0]);
  ctx.clip();
  const sx = (((px % s.top.width) + s.top.width) % s.top.width) % (s.top.width - size);
  ctx.drawImage(s.top, sx, 0, size, 64, px, py, size, size);
  ctx.restore();
}

/** The colour under the ground picture (when the screen is taller than the map). */
export const CANVA_EARTH = "#7f4f53";

/** A building picture, standing on the ground, centred on `cx`, `w` units wide. False if there is none. */
export function drawCanvaBuilding(ctx: Ctx, kind: "inn" | "house" | "shop", cx: number, groundY: number, w: number) {
  const a = kind === "inn" ? BUILDINGS.inn : BUILDINGS.house;
  if (!ready(a)) return false;
  const h = (a.img.height / a.img.width) * w;
  ctx.save();
  ctx.translate(cx, groundY + 4);
  drawArt(ctx, a, h);
  ctx.restore();
  return true;
}
