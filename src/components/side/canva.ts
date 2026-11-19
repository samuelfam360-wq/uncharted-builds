// The Canva chibi art for the 2D view: all 12 class heroes (stand, walk,
// attack), the World 1 monsters, villagers, the dusk sky and the cave, ground,
// inn, cottage, weapon shop, ladders and signposts. Anything without Canva art
// keeps being drawn the old way, so the game always has a picture for everything.

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

/** `size` evens out the body size between classes (a tall lance makes the picture taller). */
type HeroArt = { weapon: WeaponType; idle: Art; walk: Art; attack: Art; size?: number };
const hero = (c: ClassId, weapon: WeaponType, feet: [number, number, number], size = 1): HeroArt => ({
  weapon,
  idle: art(`hero-${c}-idle`, feet[0]),
  walk: art(`hero-${c}-walk`, feet[1]),
  attack: art(`hero-${c}-attack`, feet[2]),
  size,
});
const HEROES: Partial<Record<ClassId, HeroArt>> = {
  swordsman: hero("swordsman", "sword", [0.398, 0.512, 0.313]),
  mage: hero("mage", "staff", [0.595, 0.606, 0.307]),
  assassin: hero("assassin", "daggers", [0.557, 0.622, 0.26], 0.97),
  tanker: hero("tanker", "large_shield", [0.443, 0.509, 0.32]),
  ranger: hero("ranger", "bow", [0.485, 0.646, 0.442]),
  gunslinger: hero("gunslinger", "pistol", [0.544, 0.507, 0.636]),
  tamer: hero("tamer", "tamer_wand", [0.661, 0.641, 0.351]),
  lancer: hero("lancer", "lance", [0.468, 0.455, 0.25], 1.13),
  saint: hero("saint", "healing_bracelet", [0.513, 0.572, 0.37]),
  blacksmith: hero("blacksmith", "hammer", [0.508, 0.565, 0.441]),
  monk: hero("monk", "strength_bracelet", [0.527, 0.575, 0.35]),
  free: hero("free", "unarmed", [0.53, 0.61, 0.509]),
};
/** Every picture faces right. */
const MONSTERS: Record<string, Art> = {
  green_slime: art("monster-green_slime", 0.489),
  horned_rabbit: art("monster-horned_rabbit", 0.479),
  bog_toad: art("monster-bog_toad", 0.571),
  thorn_wolf: art("monster-thorn_wolf", 0.461),
  mire_bat: art("monster-mire_bat", 0.538),
  moss_golem: art("monster-moss_golem", 0.453),
  mirefang: art("monster-mirefang", 0.505),
};
/** Villagers face right in the pictures. */
const VILLAGERS: Record<string, Art> = {
  villager_a: art("villager-a", 0.404),
  villager_b: art("villager-b", 0.38),
};
const SKY = art("sky-dusk");
const CAVE = art("sky-cave");
const GROUND = art("ground");
const BUILDINGS = { inn: art("building-inn", 0.569), house: art("building-house", 0.499), shop: art("building-shop", 0.494) };
const SIGN = art("prop-sign", 0.498);
const LADDER = art("prop-ladder");

const ALL: Art[] = [
  ...Object.values(HEROES).flatMap((h) => [h!.idle, h!.walk, h!.attack]),
  ...Object.values(MONSTERS),
  ...Object.values(VILLAGERS),
  SKY,
  CAVE,
  GROUND,
  ...Object.values(BUILDINGS),
  SIGN,
  LADDER,
];

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
const ART_H = 260; // the tallest pose of each hero sheet is saved this tall; shorter poses keep their size

/** Draw one hero pose at the sheet's own scale. */
function drawPose(ctx: Ctx, h: HeroArt, a: Art) {
  const img = (a as Art & { img: HTMLImageElement }).img;
  drawArt(ctx, a as Art & { img: HTMLImageElement }, HERO_H * (h.size ?? 1) * (img.height / ART_H));
}

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
    drawPose(ctx, h, h.idle);
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
  drawPose(ctx, h, a);
  ctx.restore();
}

// ---------- villagers ----------

export function hasCanvaVillager(id: string) {
  return ready(VILLAGERS[id]);
}

/** Draw a villager with the feet at (0,0), facing right, breathing gently. */
export function drawCanvaVillager(ctx: Ctx, id: string, t: number) {
  const a = VILLAGERS[id] as Art & { img: HTMLImageElement };
  ctx.save();
  ctx.scale(1, 1 + Math.sin(t / 420) * 0.015);
  drawArt(ctx, a, HERO_H * 0.95);
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

export function hasCanvaCave() {
  return ready(CAVE);
}

/** The dusk sky (or the cave picture), moving slowly behind everything. */
export function drawCanvaSky(ctx: Ctx, camX: number, vw: number, vh: number, cave = false) {
  const img = (cave ? CAVE : SKY).img!;
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
  const a = BUILDINGS[kind];
  if (!ready(a)) return false;
  const h = (a.img.height / a.img.width) * w;
  ctx.save();
  ctx.translate(cx, groundY + 4);
  drawArt(ctx, a, h);
  ctx.restore();
  return true;
}

// ---------- signposts and ladders ----------

/** A wooden signpost standing on (x, groundY), `h` units tall. False if there is no picture. */
export function drawCanvaSign(ctx: Ctx, x: number, groundY: number, h: number) {
  if (!ready(SIGN)) return false;
  ctx.save();
  ctx.translate(x, groundY + 2);
  drawArt(ctx, SIGN, h);
  ctx.restore();
  return true;
}

export function hasCanvaLadder() {
  return ready(LADDER);
}

/**
 * One whole ladder from `top` to `bottom` (map units), centred on `cx`.
 * The rails' round ends sit at the top and bottom; the middle repeats.
 */
export function drawCanvaLadder(ctx: Ctx, cx: number, top: number, bottom: number, w: number) {
  const img = LADDER.img!;
  const s = w / img.width;
  const capH = Math.round(img.height * 0.1); // source pixels for each round end
  const midY = capH;
  const midH = img.height - capH * 2;
  const x = cx - w / 2;
  ctx.drawImage(img, 0, 0, img.width, capH, x, top, w, capH * s);
  let y = top + capH * s;
  const end = bottom - capH * s;
  while (y < end) {
    const left = Math.min(midH * s, end - y);
    ctx.drawImage(img, 0, midY, img.width, left / s, x, y, w, left);
    y += left;
  }
  ctx.drawImage(img, 0, img.height - capH, img.width, capH, x, end, w, capH * s);
}
