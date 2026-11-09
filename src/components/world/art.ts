// Original pixel art, drawn in code so there are no image files to license.
// Everything is drawn small (16x16 tiles, 32-48px monsters) and scaled up with
// nearest-neighbour so it stays crisp.

import type { Appearance, ClassId, WeaponType } from "@/lib/game/types";
import { TILE, type Building, type Facing, type WorldMap } from "@/lib/game/data/maps";

type Ctx = CanvasRenderingContext2D;

export function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return { c, ctx };
}

const px = (ctx: Ctx, x: number, y: number, color: string) => {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
};
const rect = (ctx: Ctx, x: number, y: number, w: number, h: number, color: string) => {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
};

/** Small stable hash so decorations look random but never change between frames. */
const hash = (x: number, y: number, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  const r = f(n >> 16);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Filled ellipse with a light top-left and a dark bottom-right, for a rounded look. */
function blob(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, base: string, light = 0.12, dark = -0.14) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      const t = dx * 0.6 + dy * 0.8;
      px(ctx, x, y, t < -0.55 ? shade(base, light) : t > 0.45 ? shade(base, dark) : base);
    }
  }
}

/** Draw a dark 1px outline around everything already drawn on a sprite canvas. */
function outline(c: HTMLCanvasElement, color = "#1b1a22") {
  const ctx = c.getContext("2d")!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const a = (x: number, y: number) => (x < 0 || y < 0 || x >= c.width || y >= c.height ? 0 : img.data[(y * c.width + x) * 4 + 3]);
  const edge: [number, number][] = [];
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) if (a(x, y) === 0 && (a(x - 1, y) || a(x + 1, y) || a(x, y - 1) || a(x, y + 1))) edge.push([x, y]);
  for (const [x, y] of edge) px(ctx, x, y, color);
}

// ---------------------------------------------------------------- palettes

export const SKIN: Record<string, string> = {
  Light: "#f7dcc6",
  Fair: "#eec39a",
  Medium: "#d9a066",
  Tan: "#c68642",
  Brown: "#8d5524",
  Dark: "#5c3a21",
};
export const HAIR: Record<string, string> = {
  Black: "#2a2a2e",
  Brown: "#6b4226",
  Blonde: "#e8c76a",
  Red: "#b8372f",
  White: "#ececec",
  Silver: "#aeb8c6",
  Blue: "#3e6fd1",
  Green: "#3f9b4f",
  Pink: "#e889b5",
};
export const EYES: Record<string, string> = {
  Brown: "#6b3e1f",
  Black: "#1b1b1b",
  Blue: "#2f6fd6",
  Green: "#2f8f45",
  Gray: "#7d8794",
  Amber: "#d08a1c",
  Red: "#c22d2d",
  Violet: "#7b3fc4",
};
/** Clothes colour per class, so you can tell classes apart on the map. */
export const CLASS_COLOR: Record<ClassId, string> = {
  swordsman: "#c0392b",
  mage: "#5b3fb8",
  assassin: "#34343f",
  tanker: "#7f8c8d",
  ranger: "#3e8e41",
  gunslinger: "#8e5a2b",
  tamer: "#d67f2c",
  lancer: "#2e6db4",
  saint: "#e8e2d0",
  blacksmith: "#5d4037",
  monk: "#e0a526",
  free: "#4f7f8f",
};

export interface Look {
  skin: string;
  hair: string;
  eyes: string;
  shirt: string;
  hairStyle: string;
  female: boolean;
  build: "Slim" | "Average" | "Strong";
}

export function lookFor(a: Appearance, classId: ClassId): Look {
  return {
    skin: SKIN[a.skinTone] ?? SKIN.Medium,
    hair: HAIR[a.hairColor] ?? HAIR.Black,
    eyes: EYES[a.eyeColor] ?? EYES.Brown,
    shirt: CLASS_COLOR[classId] ?? CLASS_COLOR.free,
    hairStyle: a.hairStyle,
    female: a.gender === "Female",
    build: (["Slim", "Average", "Strong"].includes(a.build) ? a.build : "Average") as Look["build"],
  };
}

// ---------------------------------------------------------------- people (16x16)

const FACINGS: Facing[] = ["down", "up", "left", "right"];

/** One 16x16 frame of a walking person. frame 0 = standing, 1/2 = steps. */
function drawPerson(ctx: Ctx, L: Look, facing: Facing, frame: number) {
  const pants = "#3b3f58";
  const shoes = "#2a1f1a";
  const shirt = L.shirt;
  const shirtDark = shade(shirt, -0.15);
  const hairDark = shade(L.hair, -0.12);
  const wide = L.build === "Strong" ? 1 : 0;
  const slim = L.build === "Slim" ? 1 : 0;
  const bx0 = 4 - wide + slim; // body left
  const bw = 8 + wide * 2 - slim * 2;
  const step = frame === 0 ? 0 : frame === 1 ? 1 : -1;
  const side = facing === "left" || facing === "right";
  const longHair = ["Long", "Braided"].includes(L.hairStyle);

  // long hair hangs behind the body
  if (facing === "up" && longHair) rect(ctx, 4, 8, 8, 4, L.hair);

  // legs
  if (side) {
    const lx = facing === "left" ? 6 : 7;
    rect(ctx, lx, 13, 3, 2, pants);
    if (step !== 0) {
      rect(ctx, lx - step, 13, 2, 2, pants);
      rect(ctx, lx + 1 + step, 13, 2, 2, pants);
    }
    rect(ctx, lx - (step === 0 ? 0 : step), 15, 2, 1, shoes);
    rect(ctx, lx + 1 + (step === 0 ? 0 : step), 15, 2, 1, shoes);
  } else {
    const lUp = step === 1 ? 1 : 0;
    const rUp = step === -1 ? 1 : 0;
    rect(ctx, 5, 13, 2, 2 - lUp, pants);
    rect(ctx, 9, 13, 2, 2 - rUp, pants);
    rect(ctx, 5, 15 - lUp, 2, 1, shoes);
    rect(ctx, 9, 15 - rUp, 2, 1, shoes);
  }

  // body
  rect(ctx, bx0, 9, bw, 4, shirt);
  rect(ctx, bx0, 12, bw, 1, shirtDark);
  if (L.female) rect(ctx, bx0 - 1, 12, bw + 2, 1, shirt);
  rect(ctx, bx0, 11, bw, 1, "#3a2c22"); // belt
  // arms
  if (side) {
    const ax = facing === "left" ? 7 + step : 8 - step;
    rect(ctx, ax, 9, 2, 3, shirtDark);
    px(ctx, ax, 12, L.skin);
  } else {
    const swing = step;
    rect(ctx, bx0 - 1, 9 + Math.max(0, swing), 1, 3, shirtDark);
    rect(ctx, bx0 + bw, 9 + Math.max(0, -swing), 1, 3, shirtDark);
    px(ctx, bx0 - 1, 12 + Math.max(0, swing) - (swing > 0 ? 1 : 0), L.skin);
    px(ctx, bx0 + bw, 12 + Math.max(0, -swing) - (swing < 0 ? 1 : 0), L.skin);
  }

  // head
  const hx = side ? 5 : 4;
  const hw = side ? 7 : 8;
  rect(ctx, hx, 2, hw, 7, L.skin);
  rect(ctx, hx, 8, hw, 1, shade(L.skin, -0.08));

  // face
  if (facing === "down") {
    px(ctx, 6, 6, L.eyes);
    px(ctx, 9, 6, L.eyes);
    px(ctx, 6, 5, shade(L.eyes, -0.2));
    px(ctx, 9, 5, shade(L.eyes, -0.2));
    if (L.female) {
      px(ctx, 5, 5, "#1b1a22");
      px(ctx, 10, 5, "#1b1a22");
    }
  } else if (side) {
    const ex = facing === "left" ? 6 : 9;
    px(ctx, ex, 6, L.eyes);
    px(ctx, ex, 5, shade(L.eyes, -0.2));
  }

  // hair
  const H = L.hair;
  const style = L.hairStyle;
  if (style === "Shaved") {
    rect(ctx, hx, 2, hw, 1, hairDark);
    if (facing === "up") rect(ctx, hx, 2, hw, 3, hairDark);
    return;
  }
  rect(ctx, hx, 1, hw, 3, H);
  rect(ctx, hx, 1, hw, 1, shade(H, 0.1));
  if (facing === "up") {
    rect(ctx, hx, 1, hw, 7, H);
    rect(ctx, hx, 7, hw, 1, hairDark);
  } else if (side) {
    const back = facing === "left" ? hx + hw - 3 : hx;
    rect(ctx, back, 1, 3, 6, H);
    rect(ctx, facing === "left" ? hx : hx + hw - 2, 3, 2, 1, H); // fringe
  } else {
    px(ctx, hx, 4, H);
    px(ctx, hx + hw - 1, 4, H);
    rect(ctx, 5, 4, 2, 1, hairDark);
  }
  if (style === "Medium" || longHair) {
    const len = style === "Medium" ? 3 : 7;
    if (facing === "down") {
      rect(ctx, hx - 1, 3, 1, len, H);
      rect(ctx, hx + hw, 3, 1, len, H);
    } else if (side) {
      rect(ctx, facing === "left" ? hx + hw - 2 : hx, 6, 3, len - 2, H);
    }
  }
  if (style === "Braided") {
    const bxp = facing === "left" ? hx + hw : facing === "right" ? hx - 1 : hx + hw;
    rect(ctx, bxp, 6, 1, 6, hairDark);
  }
  if (style === "Ponytail") {
    if (facing === "up") rect(ctx, 7, 7, 2, 4, hairDark);
    else if (side) rect(ctx, facing === "left" ? hx + hw : hx - 2, 3, 2, 4, H);
  }
  if (style === "Spiky") {
    for (const x of [hx, hx + 2, hx + 4, hx + 6]) if (x < hx + hw) px(ctx, x, 0, H);
  }
}

export interface PersonSheet {
  frame(facing: Facing, frame: number): HTMLCanvasElement;
}

/** All 12 frames (4 facings x 3) for one person, outlined and cached. */
export function personSheet(L: Look): PersonSheet {
  const frames = new Map<string, HTMLCanvasElement>();
  for (const f of FACINGS)
    for (let i = 0; i < 3; i++) {
      const { c, ctx } = makeCanvas(16, 17);
      ctx.translate(0, 1);
      drawPerson(ctx, L, f, i);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      outline(c);
      frames.set(`${f}${i}`, c);
    }
  return { frame: (facing, frame) => frames.get(`${facing}${frame}`)! };
}

/** The player's back, big, for the battle screen, holding their weapon. */
export function battleBack(L: Look, weapon: WeaponType) {
  const { c: small, ctx } = makeCanvas(24, 20);
  ctx.translate(4, 2);
  drawPerson(ctx, L, "up", 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawWeapon(ctx, weapon);
  outline(small);
  const { c, ctx: big } = makeCanvas(72, 60);
  big.drawImage(small, 0, 0, 72, 60);
  return c;
}

function drawWeapon(ctx: Ctx, w: WeaponType) {
  const wood = "#a0703a";
  const woodD = "#6e4a24";
  switch (w) {
    case "sword":
      rect(ctx, 18, 3, 1, 9, "#d9d2c3");
      rect(ctx, 17, 11, 3, 1, woodD);
      rect(ctx, 18, 12, 1, 2, wood);
      break;
    case "daggers":
      rect(ctx, 18, 7, 1, 5, "#d9d2c3");
      rect(ctx, 17, 12, 3, 1, woodD);
      break;
    case "staff":
    case "tamer_wand":
      rect(ctx, 18, w === "staff" ? 1 : 5, 1, w === "staff" ? 14 : 10, wood);
      rect(ctx, 17, w === "staff" ? 0 : 4, 3, 2, w === "staff" ? "#7fd3ff" : "#ffb347");
      break;
    case "lance":
      rect(ctx, 18, 0, 1, 16, wood);
      rect(ctx, 17, 0, 3, 2, "#d9d2c3");
      break;
    case "bow":
      rect(ctx, 19, 2, 1, 12, wood);
      px(ctx, 18, 1, wood);
      px(ctx, 18, 14, wood);
      rect(ctx, 17, 2, 1, 12, "#e6e1d3");
      break;
    case "pistol":
      rect(ctx, 17, 9, 4, 2, woodD);
      rect(ctx, 17, 11, 2, 2, wood);
      break;
    case "hammer":
      rect(ctx, 18, 4, 1, 10, wood);
      rect(ctx, 16, 2, 5, 3, "#8a8f98");
      break;
    case "large_shield":
      rect(ctx, 16, 7, 6, 8, wood);
      rect(ctx, 16, 7, 6, 1, woodD);
      rect(ctx, 18, 9, 2, 4, woodD);
      break;
    case "healing_bracelet":
    case "strength_bracelet":
      rect(ctx, 17, 13, 3, 1, w === "healing_bracelet" ? "#f3e7a1" : "#c0392b");
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------- tiles & maps

const C = {
  grass: "#7cc45a",
  grassD: "#5ea544",
  grassL: "#9bd877",
  tall: "#3f8f3a",
  tallD: "#2e6e2b",
  tallL: "#5db150",
  path: "#d8b77a",
  pathD: "#bf9a5c",
  water: "#4a90d9",
  waterL: "#8cc4f0",
  swamp: "#5e6b3a",
  swampD: "#4a5530",
  swampL: "#86965a",
  bubble: "#b07ce8",
  rock: "#8b8478",
  rockD: "#6a645a",
  rockL: "#aaa396",
  trunk: "#6e4a24",
  leaf: "#2f7d32",
  leafD: "#235f26",
  leafL: "#4caf50",
};

function grassTile(ctx: Ctx, x: number, y: number, gx: number, gy: number) {
  rect(ctx, x, y, TILE, TILE, C.grass);
  for (let i = 0; i < 4; i++) {
    const tx = x + Math.floor(hash(gx, gy, i) * 14) + 1;
    const ty = y + Math.floor(hash(gy, gx, i + 9) * 13) + 2;
    px(ctx, tx, ty, C.grassD);
    px(ctx, tx + 1, ty - 1, C.grassD);
    if (i % 2) px(ctx, tx, ty - 1, C.grassL);
  }
}

function tallGrass(ctx: Ctx, x: number, y: number, frame: number, top = 0) {
  for (let r = 0; r < 2; r++)
    for (let k = 0; k < 4; k++) {
      const bx = x + k * 4 + (r ? 2 : 0) + (frame && r ? 1 : 0);
      const by = y + 2 + r * 7;
      if (by + 6 < y + top) continue;
      rect(ctx, bx, Math.max(by + 1, y + top), 3, by + 6 - Math.max(by + 1, y + top), C.tall);
      px(ctx, bx + 1, by, C.tallL);
      if (by + 6 > y + top) rect(ctx, bx, by + 5, 3, 1, C.tallD);
    }
}

function waterTile(ctx: Ctx, x: number, y: number, gx: number, gy: number, frame: number) {
  rect(ctx, x, y, TILE, TILE, C.water);
  for (let i = 0; i < 3; i++) {
    const wx = x + ((Math.floor(hash(gx, gy, i) * 12) + frame * 2) % 13);
    const wy = y + 3 + i * 5;
    rect(ctx, wx, wy, 3, 1, C.waterL);
  }
}

function swampTile(ctx: Ctx, x: number, y: number, gx: number, gy: number, frame: number) {
  rect(ctx, x, y, TILE, TILE, C.swamp);
  for (let i = 0; i < 5; i++) {
    const sx = x + Math.floor(hash(gx, gy, i) * 15);
    const sy = y + Math.floor(hash(gy, gx, i + 3) * 15);
    px(ctx, sx, sy, i % 2 ? C.swampD : C.swampL);
  }
  if (hash(gx, gy, 7) > 0.55) {
    const bx = x + 4 + Math.floor(hash(gx, gy, 8) * 7);
    const by = y + 5 + Math.floor(hash(gx, gy, 9) * 6) - frame;
    px(ctx, bx, by, C.bubble);
    px(ctx, bx + 1, by, C.bubble);
    px(ctx, bx, by - 1, shade(C.bubble, 0.2));
  }
}

function treeTile(ctx: Ctx, x: number, y: number) {
  rect(ctx, x + 6, y + 11, 4, 5, C.trunk);
  blob(ctx, x + 8, y + 7, 7.5, 7, C.leaf, 0.1, -0.08);
  px(ctx, x + 5, y + 4, C.leafL);
  px(ctx, x + 6, y + 3, C.leafL);
  px(ctx, x + 10, y + 9, C.leafD);
  rect(ctx, x + 2, y + 13, 12, 1, "rgba(0,0,0,0.12)");
}

function rockTile(ctx: Ctx, x: number, y: number, gx: number, gy: number) {
  rect(ctx, x, y, TILE, TILE, C.rockD);
  blob(ctx, x + 8, y + 8, 8, 8, C.rock, 0.1, -0.1);
  if (hash(gx, gy) > 0.5) rect(ctx, x + 4, y + 9, 5, 1, C.rockD);
}

function caveTile(ctx: Ctx, x: number, y: number) {
  rockTile(ctx, x, y, 0, 0);
  blob(ctx, x + 8, y + 10, 6, 7, "#14121a", 0, 0);
  rect(ctx, x + 2, y + 15, 12, 1, "#14121a");
}

function signTile(ctx: Ctx, x: number, y: number) {
  rect(ctx, x + 7, y + 9, 2, 6, C.trunk);
  rect(ctx, x + 2, y + 3, 12, 7, "#b98545");
  rect(ctx, x + 2, y + 3, 12, 1, "#d7a865");
  rect(ctx, x + 4, y + 5, 8, 1, "#6e4a24");
  rect(ctx, x + 4, y + 7, 6, 1, "#6e4a24");
  ctx.strokeStyle = "#3a2612";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 1.5, y + 2.5, 13, 8);
}

function fenceTile(ctx: Ctx, x: number, y: number) {
  rect(ctx, x, y + 5, TILE, 2, "#d9c3a0");
  rect(ctx, x, y + 10, TILE, 2, "#d9c3a0");
  rect(ctx, x + 2, y + 2, 3, 12, "#efe0c4");
  rect(ctx, x + 11, y + 2, 3, 12, "#efe0c4");
  rect(ctx, x + 2, y + 13, 3, 1, "#a8916c");
  rect(ctx, x + 11, y + 13, 3, 1, "#a8916c");
}

function flowerTile(ctx: Ctx, x: number, y: number, gx: number, gy: number) {
  grassTile(ctx, x, y, gx, gy);
  const colors = ["#ff6b6b", "#ffd93d", "#ffffff", "#c38bff"];
  for (let i = 0; i < 3; i++) {
    const fx = x + 2 + Math.floor(hash(gx, gy, i + 20) * 11);
    const fy = y + 2 + Math.floor(hash(gy, gx, i + 30) * 11);
    const col = colors[Math.floor(hash(gx, gy, i + 40) * colors.length)];
    px(ctx, fx, fy - 1, col);
    px(ctx, fx - 1, fy, col);
    px(ctx, fx + 1, fy, col);
    px(ctx, fx, fy + 1, col);
    px(ctx, fx, fy, "#f6c945");
  }
}

function pathTile(ctx: Ctx, x: number, y: number, gx: number, gy: number) {
  rect(ctx, x, y, TILE, TILE, C.path);
  for (let i = 0; i < 3; i++) px(ctx, x + Math.floor(hash(gx, gy, i + 50) * 15), y + Math.floor(hash(gy, gx, i + 60) * 15), C.pathD);
}

function drawBuilding(ctx: Ctx, b: Building) {
  const x = b.x * TILE;
  const y = b.y * TILE;
  const w = b.w * TILE;
  const h = b.h * TILE;
  const roof = b.kind === "inn" ? "#c0504d" : b.kind === "shop" ? "#3f74c4" : "#8e6a4b";
  const roofH = Math.floor(h * 0.5);
  // walls
  rect(ctx, x + 2, y + roofH - 2, w - 4, h - roofH + 2, "#efe3c8");
  rect(ctx, x + 2, y + h - 3, w - 4, 3, "#c9b897");
  // roof with stripes
  rect(ctx, x, y, w, roofH, roof);
  for (let r = 3; r < roofH; r += 4) rect(ctx, x, y + r, w, 1, shade(roof, -0.12));
  rect(ctx, x, y, w, 2, shade(roof, 0.12));
  rect(ctx, x, y + roofH - 1, w, 2, shade(roof, -0.25));
  // windows
  const winY = y + roofH + 4;
  for (const wx of [x + 6, x + w - 16]) {
    rect(ctx, wx, winY, 10, 8, "#5aa0d8");
    rect(ctx, wx, winY, 10, 2, "#a7d4f5");
    rect(ctx, wx + 4, winY, 1, 8, "#efe3c8");
  }
  // door
  const dx = b.door.x * TILE + 3;
  const dy = (b.door.y + 1) * TILE - 13;
  rect(ctx, dx, dy, 10, 13, "#6e4a24");
  rect(ctx, dx + 1, dy + 1, 8, 12, "#8a5c2e");
  px(ctx, dx + 7, dy + 7, "#f6c945");
  // icon over the door: a bed for the inn, a sword for the shop
  const ix = dx + 1;
  const iy = y + roofH - 9;
  if (b.kind === "inn") {
    rect(ctx, ix - 1, iy, 10, 7, "#fff6e0");
    rect(ctx, ix, iy + 3, 8, 2, "#c0504d");
    rect(ctx, ix, iy + 2, 2, 1, "#ffffff");
  } else if (b.kind === "shop") {
    rect(ctx, ix - 1, iy, 10, 7, "#fff6e0");
    rect(ctx, ix + 1, iy + 3, 6, 1, "#7d8794");
    rect(ctx, ix + 1, iy + 2, 1, 3, "#6e4a24");
  }
  ctx.strokeStyle = "#2a2230";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

/** Draw the whole map once (per water frame). Characters are drawn on top each frame. */
export function renderMap(m: WorldMap, frame: number) {
  const W = m.tiles[0].length;
  const H = m.tiles.length;
  const { c, ctx } = makeCanvas(W * TILE, H * TILE);
  for (let gy = 0; gy < H; gy++)
    for (let gx = 0; gx < W; gx++) {
      const t = m.tiles[gy][gx];
      const x = gx * TILE;
      const y = gy * TILE;
      if (t !== "~" && t !== "%" && t !== "=" && t !== "R" && t !== "C") grassTile(ctx, x, y, gx, gy);
      switch (t) {
        case ",":
          tallGrass(ctx, x, y, frame);
          break;
        case "=":
          pathTile(ctx, x, y, gx, gy);
          break;
        case "~":
          waterTile(ctx, x, y, gx, gy, frame);
          break;
        case "%":
          swampTile(ctx, x, y, gx, gy, frame);
          break;
        case "T":
          treeTile(ctx, x, y);
          break;
        case "R":
          rockTile(ctx, x, y, gx, gy);
          break;
        case "C":
          caveTile(ctx, x, y);
          break;
        case "S":
          signTile(ctx, x, y);
          break;
        case "F":
          fenceTile(ctx, x, y);
          break;
        case "f":
          flowerTile(ctx, x, y, gx, gy);
          break;
      }
    }
  for (const b of m.buildings) drawBuilding(ctx, b);
  return c;
}

/** The front blades of tall grass, drawn over a person's legs. */
export function tallGrassFront() {
  const { c, ctx } = makeCanvas(TILE, TILE);
  tallGrass(ctx, 0, 0, 0, 9);
  return c;
}

// ---------------------------------------------------------------- monsters

/** Front-facing monster art. Returns a canvas already scaled for the battle screen. */
export function monsterArt(id: string): HTMLCanvasElement {
  const boss = id === "mirefang";
  const S = boss ? 48 : 32;
  const { c: small, ctx } = makeCanvas(S, S);
  const eye = (x: number, y: number, col = "#1b1a22") => {
    rect(ctx, x, y, 2, 2, col);
    px(ctx, x, y, "#ffffff");
  };
  switch (id) {
    case "green_slime":
      blob(ctx, 16, 21, 12, 9, "#5fd068");
      blob(ctx, 16, 14, 7, 6, "#5fd068");
      rect(ctx, 10, 13, 3, 2, "#c9f7cf");
      eye(12, 19);
      eye(19, 19);
      rect(ctx, 14, 24, 5, 1, "#2f7d3a");
      break;
    case "horned_rabbit":
      blob(ctx, 10, 6, 2.5, 6, "#efe6dc");
      blob(ctx, 22, 6, 2.5, 6, "#efe6dc");
      px(ctx, 10, 5, "#f2a7b8");
      px(ctx, 22, 5, "#f2a7b8");
      blob(ctx, 16, 23, 10, 8, "#efe6dc");
      blob(ctx, 16, 15, 8, 7, "#efe6dc");
      for (let i = 0; i < 6; i++) rect(ctx, 15 + (i > 3 ? 1 : 0), 2 + i, 2 - (i > 3 ? 1 : 0), 1, i < 2 ? "#e8d9a8" : "#c9a96b");
      eye(12, 14, "#c22d2d");
      eye(18, 14, "#c22d2d");
      px(ctx, 16, 18, "#f2a7b8");
      rect(ctx, 10, 29, 4, 2, "#d9cfc4");
      rect(ctx, 18, 29, 4, 2, "#d9cfc4");
      break;
    case "bog_toad":
      blob(ctx, 16, 21, 14, 9, "#7a6a3a");
      blob(ctx, 10, 12, 4, 4, "#7a6a3a");
      blob(ctx, 22, 12, 4, 4, "#7a6a3a");
      eye(9, 11, "#d0b030");
      eye(21, 11, "#d0b030");
      blob(ctx, 16, 24, 8, 4, "#c8b26a");
      for (const [sx, sy] of [
        [7, 18],
        [24, 17],
        [12, 16],
        [21, 22],
      ])
        rect(ctx, sx, sy, 2, 2, "#9b59b6");
      rect(ctx, 9, 19, 14, 1, "#4a3e1e");
      break;
    case "thorn_wolf":
      blob(ctx, 16, 22, 11, 8, "#6b6f7a");
      blob(ctx, 16, 13, 8, 7, "#6b6f7a");
      for (const ex of [9, 20]) {
        rect(ctx, ex, 4, 3, 5, "#6b6f7a");
        px(ctx, ex + 1, 5, "#a3a7b2");
      }
      for (let i = 0; i < 5; i++) {
        px(ctx, 6 + i * 5, 14 - (i % 2) * 2, "#3f7a3a");
        px(ctx, 6 + i * 5, 13 - (i % 2) * 2, "#3f7a3a");
      }
      blob(ctx, 16, 17, 4, 3, "#c9ccd4");
      rect(ctx, 15, 15, 2, 1, "#1b1a22");
      eye(11, 11, "#e2b85c");
      eye(19, 11, "#e2b85c");
      px(ctx, 14, 19, "#ffffff");
      px(ctx, 18, 19, "#ffffff");
      break;
    case "mire_bat":
      for (const dir of [-1, 1]) {
        for (let i = 0; i < 12; i++) {
          const x = 16 + dir * (5 + i);
          const top = 9 + Math.abs(i - 4);
          rect(ctx, x, top, 1, 14 - Math.abs(i - 6), "#4b3a5e");
        }
      }
      blob(ctx, 16, 16, 6, 7, "#5e4a75");
      rect(ctx, 11, 7, 2, 4, "#5e4a75");
      rect(ctx, 19, 7, 2, 4, "#5e4a75");
      eye(12, 13, "#e0675c");
      eye(18, 13, "#e0675c");
      px(ctx, 14, 19, "#ffffff");
      px(ctx, 17, 19, "#ffffff");
      break;
    case "moss_golem":
      rect(ctx, 6, 12, 20, 16, "#8b8478");
      rect(ctx, 9, 3, 14, 10, "#8b8478");
      rect(ctx, 2, 13, 5, 11, "#7a7468");
      rect(ctx, 25, 13, 5, 11, "#7a7468");
      rect(ctx, 8, 27, 6, 4, "#6a645a");
      rect(ctx, 18, 27, 6, 4, "#6a645a");
      for (const [mx, my, mw] of [
        [9, 3, 14],
        [6, 12, 9],
        [19, 16, 7],
        [2, 13, 5],
      ])
        rect(ctx, mx, my, mw, 2, "#4f9a45");
      rect(ctx, 11, 8, 3, 2, "#9be36a");
      rect(ctx, 18, 8, 3, 2, "#9be36a");
      rect(ctx, 10, 20, 12, 1, "#6a645a");
      break;
    case "mirefang":
      // the swamp queen: a great serpent rising from the mire
      blob(ctx, 24, 40, 22, 7, "#3d4a2a", 0, 0);
      blob(ctx, 24, 34, 13, 8, "#6a3e8a");
      blob(ctx, 24, 25, 9, 9, "#6a3e8a");
      blob(ctx, 24, 15, 11, 8, "#7b4aa0");
      for (const hx of [-1, 1]) {
        for (let i = 0; i < 7; i++) rect(ctx, 24 + hx * (8 + i), 9 - Math.floor(i / 2), 1, 8 - i, "#4f2d6a");
      }
      for (const cx of [17, 21, 24, 27, 31]) {
        rect(ctx, cx, 4 - (cx === 24 ? 2 : 0), 1, 4 + (cx === 24 ? 2 : 0), "#e2b85c");
      }
      rect(ctx, 16, 7, 17, 2, "#e2b85c");
      eye(18, 13, "#d4f04c");
      eye(28, 13, "#d4f04c");
      rect(ctx, 19, 19, 11, 2, "#2a1438");
      rect(ctx, 20, 21, 1, 3, "#ffffff");
      rect(ctx, 28, 21, 1, 3, "#ffffff");
      for (let i = 0; i < 4; i++) rect(ctx, 20 + i * 2, 28 + (i % 2), 2, 1, "#b48fd0");
      break;
    default:
      blob(ctx, 16, 18, 11, 11, "#9b59b6");
      eye(12, 15);
      eye(18, 15);
  }
  outline(small);
  const scale = 2;
  const { c, ctx: big } = makeCanvas(S * scale, S * scale);
  big.drawImage(small, 0, 0, S * scale, S * scale);
  return c;
}

// ---------------------------------------------------------------- battle backdrop

export type Backdrop = "grass" | "swamp" | "cave";

export function battleBackdrop(kind: Backdrop, w = 240, h = 160) {
  const { c, ctx } = makeCanvas(w, h);
  const sky = kind === "cave" ? ["#1d1a26", "#2c2738"] : kind === "swamp" ? ["#b6c79a", "#d9e3c2"] : ["#a8dcf0", "#e4f5fb"];
  const g = ctx.createLinearGradient(0, 0, 0, h * 0.55);
  g.addColorStop(0, sky[0]);
  g.addColorStop(1, sky[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const ground = kind === "cave" ? "#3a3446" : kind === "swamp" ? "#7b8a52" : "#9ad07a";
  rect(ctx, 0, Math.floor(h * 0.5), w, h, ground);
  // far trees / stalactites
  if (kind === "cave") {
    for (let i = 0; i < 12; i++) {
      const x = i * 21 + 6;
      const len = 6 + Math.floor(hash(i, 3) * 14);
      for (let k = 0; k < len; k++) rect(ctx, x + Math.floor(k / 4), k, 6 - Math.floor(k / 3), 1, "#2a2536");
    }
  } else {
    for (let i = 0; i < 9; i++) blob(ctx, i * 30 + 10, h * 0.5 - 4, 16, 10, kind === "swamp" ? "#5c6b3e" : "#4f9a45", 0.06, -0.06);
  }
  // platforms
  const plat = kind === "cave" ? "#4a4258" : kind === "swamp" ? "#5e6b3a" : "#78b85a";
  blob(ctx, w * 0.72, h * 0.42, 44, 10, plat, 0.08, -0.1);
  blob(ctx, w * 0.27, h * 0.82, 52, 12, plat, 0.08, -0.1);
  if (kind === "swamp") for (let i = 0; i < 14; i++) px(ctx, Math.floor(hash(i, 1) * w), Math.floor(h * 0.55 + hash(i, 2) * h * 0.4), "#b07ce8");
  return c;
}
