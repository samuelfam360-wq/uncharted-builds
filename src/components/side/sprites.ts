// Art for the side-view game: the Kenney "New Platformer Pack" (CC0) sheets,
// recoloured copies of some of its monsters, and a few things drawn in code
// in the same style (thick dark outline, flat colours).

import { FRAMES, type Sheet } from "./atlas";

export const OUTLINE = "#2f2a3b";

export type Img = HTMLImageElement | HTMLCanvasElement;

const SHEETS: Record<Sheet, string> = {
  tiles: "/art/kenney/spritesheet-tiles-default.png",
  enemies: "/art/kenney/spritesheet-enemies-double.png", // double size: crisp when scaled up
  backgrounds: "/art/kenney/spritesheet-backgrounds-default.png",
};

const loaded: Partial<Record<Sheet, HTMLImageElement>> = {};

/** Load the three sheets once. Resolves when all are ready. */
export function loadArt(): Promise<void> {
  return Promise.all(
    (Object.keys(SHEETS) as Sheet[]).map(
      (k) =>
        new Promise<void>((resolve, reject) => {
          if (loaded[k]) return resolve();
          const img = new Image();
          img.onload = () => {
            loaded[k] = img;
            resolve();
          };
          img.onerror = () => reject(new Error(`Couldn't load ${SHEETS[k]}`));
          img.src = SHEETS[k];
        }),
    ),
  ).then(() => undefined);
}

export function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

const frameCache = new Map<string, HTMLCanvasElement>();

/** One frame of the art pack as its own canvas (cached). */
export function frame(name: string): HTMLCanvasElement {
  let c = frameCache.get(name);
  if (c) return c;
  const f = FRAMES[name];
  if (!f) throw new Error(`No art frame "${name}"`);
  const [sheet, x, y, w, h] = f;
  c = makeCanvas(w, h);
  const img = loaded[sheet];
  if (img) c.getContext("2d")!.drawImage(img, x, y, w, h, 0, 0, w, h);
  frameCache.set(name, c);
  return c;
}

// ---------- recolouring ----------

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

export interface Tint {
  hue: number; // degrees to turn the colour wheel
  sat?: number; // multiply saturation
  light?: number; // multiply lightness
}

/** A recoloured copy. Dark outline pixels are left alone so the style holds. */
export function recolor(src: HTMLCanvasElement, t: Tint): HTMLCanvasElement {
  const c = makeCanvas(src.width, src.height);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    if (l < 0.22) continue; // outline
    const [r, g, b] = hslToRgb(h + t.hue, Math.min(1, s * (t.sat ?? 1)), Math.min(1, l * (t.light ?? 1)));
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const tinted = new Map<string, HTMLCanvasElement>();
export function tintedFrame(name: string, t: Tint | null): HTMLCanvasElement {
  if (!t) return frame(name);
  const key = `${name}|${t.hue}|${t.sat ?? 1}|${t.light ?? 1}`;
  let c = tinted.get(key);
  if (!c) {
    c = recolor(frame(name), t);
    tinted.set(key, c);
  }
  return c;
}

// ---------- shapes in the pack's style ----------

type Ctx = CanvasRenderingContext2D;

export function outlined(ctx: Ctx, path: Path2D, fill: string, line = 4) {
  ctx.fillStyle = fill;
  ctx.fill(path);
  ctx.lineWidth = line;
  ctx.lineJoin = "round";
  ctx.strokeStyle = OUTLINE;
  ctx.stroke(path);
}

export function ellipse(cx: number, cy: number, rx: number, ry: number, rot = 0) {
  const p = new Path2D();
  p.ellipse(cx, cy, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, Math.PI * 2);
  return p;
}

export function roundRect(x: number, y: number, w: number, h: number, r: number) {
  const p = new Path2D();
  r = Math.min(r, w / 2, h / 2);
  p.moveTo(x + r, y);
  p.arcTo(x + w, y, x + w, y + h, r);
  p.arcTo(x + w, y + h, x, y + h, r);
  p.arcTo(x, y + h, x, y, r);
  p.arcTo(x, y, x + w, y, r);
  p.closePath();
  return p;
}

export function poly(points: number[]) {
  const p = new Path2D();
  p.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) p.lineTo(points[i], points[i + 1]);
  p.closePath();
  return p;
}

export function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

// ---------- monsters ----------

/** How each monster looks. Picks from the art pack where one fits, drawn in code where none does. */
export interface MonsterLook {
  kind: "frames" | "wolf" | "bat";
  rest?: string;
  walk?: [string, string];
  attack?: string; // frame used while striking
  dead?: string;
  tint?: Tint | null;
  scale: number; // drawn size compared to the 64px pack frames
  extra?: "horn" | "crown";
  body: { w: number; h: number }; // hitbox in world units
  flying?: boolean;
}

export const MONSTER_LOOKS: Record<string, MonsterLook> = {
  green_slime: {
    kind: "frames",
    rest: "slime_normal_rest",
    walk: ["slime_normal_walk_a", "slime_normal_walk_b"],
    dead: "slime_normal_flat",
    tint: { hue: -150, sat: 0.9, light: 1.0 },
    scale: 1,
    body: { w: 52, h: 38 },
  },
  horned_rabbit: {
    kind: "frames",
    rest: "mouse_rest",
    walk: ["mouse_walk_a", "mouse_walk_b"],
    tint: { hue: 25, sat: 2.2, light: 1.12 },
    scale: 1,
    extra: "horn",
    body: { w: 48, h: 40 },
  },
  bog_toad: {
    kind: "frames",
    rest: "frog_idle",
    walk: ["frog_idle", "frog_jump"],
    attack: "frog_jump",
    dead: "frog_rest",
    tint: { hue: -70, sat: 0.75, light: 0.85 },
    scale: 1.15,
    body: { w: 56, h: 48 },
  },
  thorn_wolf: { kind: "wolf", scale: 1, body: { w: 84, h: 56 } },
  mire_bat: { kind: "bat", scale: 1, body: { w: 60, h: 40 }, flying: true },
  moss_golem: {
    kind: "frames",
    rest: "block_idle",
    walk: ["block_idle", "block_rest"],
    attack: "block_fall",
    dead: "block_rest",
    tint: null,
    scale: 1.6,
    body: { w: 92, h: 96 },
  },
  mirefang: {
    kind: "frames",
    rest: "barnacle_attack_rest",
    walk: ["barnacle_attack_rest", "barnacle_attack_a"],
    attack: "barnacle_attack_b",
    dead: "barnacle_attack_rest",
    tint: { hue: -100, sat: 0.6, light: 0.72 },
    scale: 2.7,
    extra: "crown",
    body: { w: 140, h: 150 },
  },
};

/**
 * Draw a monster standing with its feet at (0,0), facing right (the caller flips).
 * `pose`: 0/1 walk steps, "rest", "windup", "attack", "dead".
 */
export function drawMonster(ctx: Ctx, id: string, pose: "rest" | "walk0" | "walk1" | "windup" | "attack" | "hurt" | "dead", t: number) {
  const L = MONSTER_LOOKS[id];
  if (L.kind === "wolf") return drawWolf(ctx, pose, t);
  if (L.kind === "bat") return drawBat(ctx, pose, t);
  let name = L.rest!;
  if (pose === "walk0") name = L.walk![0];
  else if (pose === "walk1") name = L.walk![1];
  else if (pose === "attack" && L.attack) name = L.attack;
  else if (pose === "dead" && L.dead) name = L.dead;
  const img = tintedFrame(name, L.tint ?? null);
  const s = L.scale / 2; // the monster sheet is double size
  let sx = s;
  let sy = s;
  if (pose === "windup") {
    sx = s * 1.08;
    sy = s * 0.9;
  }
  // The pack frames face left; turn them to face right like everything else.
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(img, (-img.width * sx) / 2, -img.height * sy, img.width * sx, img.height * sy);
  ctx.restore();
  if (L.extra === "horn") {
    const p = poly([14, -36, 30, -62, 22, -32]);
    outlined(ctx, p, "#f4ead2", 3);
  } else if (L.extra === "crown") {
    const top = -img.height * sy * 0.7;
    const p = poly([-36, top + 8, -40, top - 26, -20, top - 8, 0, top - 34, 20, top - 8, 40, top - 26, 36, top + 8]);
    outlined(ctx, p, "#f5c542", 5);
    outlined(ctx, ellipse(0, top - 12, 6, 6), "#d64b6b", 3);
  }
  void t;
}

function drawWolf(ctx: Ctx, pose: string, t: number) {
  const fur = "#7d8aa6";
  const dark = shade(fur, -0.22);
  const step = pose === "walk0" ? 1 : pose === "walk1" ? -1 : 0;
  const crouch = pose === "windup" ? 6 : 0;
  const lunge = pose === "attack" ? 10 : 0;
  ctx.save();
  ctx.translate(lunge, crouch);
  // tail
  outlined(ctx, poly([-34, -34, -58, -50 - step * 3, -50, -28]), dark);
  // back legs, body, front legs
  outlined(ctx, roundRect(-30 + step * 4, -22, 12, 22, 5), dark);
  outlined(ctx, roundRect(16 - step * 4, -22, 12, 22, 5), dark);
  outlined(ctx, ellipse(-4, -30, 38, 18), fur);
  outlined(ctx, roundRect(-22 - step * 4, -20, 12, 20, 5), fur);
  outlined(ctx, roundRect(24 + step * 4, -20, 12, 20, 5), fur);
  // thorns on the back
  for (const x of [-22, -8, 6]) outlined(ctx, poly([x - 6, -44, x, -60, x + 6, -44]), "#5e9e4f", 3);
  // head
  outlined(ctx, poly([30, -58, 36, -76, 44, -58]), dark, 3); // ear
  outlined(ctx, ellipse(40, -46, 18, 15), fur);
  outlined(ctx, roundRect(48, -46, 20, 12, 5), shade(fur, 0.15));
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.arc(66, -42, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = pose === "windup" ? "#ff5a4f" : "#d63c3c";
  ctx.beginPath();
  ctx.ellipse(44, -50, 3.5, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  if (pose === "attack") {
    ctx.fillStyle = "#fff";
    ctx.fillRect(54, -35, 3, 5);
    ctx.fillRect(60, -35, 3, 5);
  }
  ctx.restore();
  void t;
}

function drawBat(ctx: Ctx, pose: string, t: number) {
  const body = "#7b4fa8";
  const wing = shade(body, -0.25);
  const flap = Math.sin(t / 70) * (pose === "dead" ? 0 : 1);
  ctx.save();
  ctx.translate(0, -24);
  const wy = flap * 14;
  outlined(ctx, poly([-6, -4, -44, -18 - wy, -36, 2, -26, -2, -18, 8]), wing);
  outlined(ctx, poly([6, -4, 44, -18 - wy, 36, 2, 26, -2, 18, 8]), wing);
  outlined(ctx, ellipse(0, 0, 18, 16), body);
  outlined(ctx, poly([-12, -10, -10, -26, -2, -14]), body, 3);
  outlined(ctx, poly([12, -10, 10, -26, 2, -14]), body, 3);
  ctx.fillStyle = pose === "windup" ? "#ffe066" : "#f5f0ff";
  ctx.beginPath();
  ctx.ellipse(-6, -2, 4, 5, 0, 0, Math.PI * 2);
  ctx.ellipse(8, -2, 4, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.arc(-5, -1, 2, 0, Math.PI * 2);
  ctx.arc(9, -1, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillRect(-4, 8, 3, 4);
  ctx.fillRect(2, 8, 3, 4);
  ctx.restore();
}

// ---------- bred pets: one mixed monster that looks like all its parents ----------

/** Each species' main colour, used to blend a mixed monster's body. */
const SPECIES_COLOR: Record<string, string> = {
  green_slime: "#5fd36a",
  horned_rabbit: "#e0b98a",
  bog_toad: "#6f8f3a",
  thorn_wolf: "#7d8aa6",
  mire_bat: "#6a4f8a",
  moss_golem: "#6f8f5a",
  mirefang: "#4a3a5a",
};

function hueOf(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** The parts of a species: a bred one is its parents' species joined with "+". */
const partsOf = (species: string) => species.split("+").filter((s) => MONSTER_LOOKS[s]);

/** A mixed monster takes the body of its biggest parent. */
export function bodyOf(species: string): string {
  const parts = partsOf(species);
  if (!parts.length) return "green_slime";
  return parts.reduce((a, b) => (MONSTER_LOOKS[b].body.w * MONSTER_LOOKS[b].body.h > MONSTER_LOOKS[a].body.w * MONSTER_LOOKS[a].body.h ? b : a));
}

/** The look (size, flying) of any pet, bred or not. */
export const petLookOf = (species: string) => MONSTER_LOOKS[bodyOf(species)];

/** Draw a pet, feet at (0,0) facing right. A bred pet is its biggest parent's body, coloured between its parents, wearing the others' features. */
export function drawPet(ctx: Ctx, species: string, pose: "rest" | "walk0" | "walk1" | "windup" | "attack" | "hurt" | "dead", t: number) {
  const parts = partsOf(species);
  if (parts.length <= 1) return drawMonster(ctx, parts[0] ?? species, pose, t);
  const body = bodyOf(species);
  const others = parts.filter((p) => p !== body);
  const L = MONSTER_LOOKS[body];
  // wings go behind the body
  for (const o of others) if (o === "mire_bat") drawFeature(ctx, o, L.body, pose, t);
  // the body, its colour turned halfway towards the other parents'
  const hb = hueOf(SPECIES_COLOR[body] ?? "#888888");
  const ho = others.reduce((n, o) => n + hueOf(SPECIES_COLOR[o] ?? "#888888"), 0) / others.length;
  let diff = ho - hb;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  ctx.save();
  ctx.filter = `hue-rotate(${Math.round(diff / 2)}deg)`;
  drawMonster(ctx, body, pose, t);
  ctx.restore();
  for (const o of others) if (o !== "mire_bat") drawFeature(ctx, o, L.body, pose, t);
}

/** One parent's tell-tale feature, sized to the body it sits on. */
function drawFeature(ctx: Ctx, species: string, b: { w: number; h: number }, pose: string, t: number) {
  const w = b.w;
  const h = b.h;
  ctx.save();
  switch (species) {
    case "green_slime": {
      // a wobbly coat of slime with drips
      const wob = Math.sin(t / 170) * 2;
      ctx.globalAlpha = 0.38;
      outlined(ctx, ellipse(0, -h * 0.5, w * 0.5 + wob, h * 0.52 - wob), "#5fd36a", 2);
      ctx.globalAlpha = 0.55;
      for (const [x, len] of [
        [-w * 0.25, 9],
        [w * 0.05, 13],
        [w * 0.3, 7],
      ]) {
        outlined(ctx, ellipse(x, -h * 0.08 + len / 2, 4, len / 2 + Math.sin(t / 220 + x) * 1.5), "#5fd36a", 1.5);
      }
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "#ffffff";
      ctx.fill(ellipse(-w * 0.22, -h * 0.82, 4, 7, -0.4));
      break;
    }
    case "horned_rabbit": {
      // long ears and a horn
      outlined(ctx, ellipse(-w * 0.12, -h * 1.02, 6, 15, -0.25), "#e8d2b0", 3);
      outlined(ctx, ellipse(w * 0.02, -h * 1.05, 6, 15, 0.15), "#e8d2b0", 3);
      outlined(ctx, poly([w * 0.22, -h * 0.82, w * 0.42, -h * 1.32, w * 0.34, -h * 0.76]), "#f4ead2", 3);
      break;
    }
    case "bog_toad": {
      // toxic warts
      for (const [x, y, r] of [
        [-w * 0.22, -h * 0.62, 5],
        [w * 0.08, -h * 0.75, 4],
        [w * 0.24, -h * 0.45, 5],
        [-w * 0.05, -h * 0.35, 4],
      ]) outlined(ctx, ellipse(x, y, r, r), "#9b6fd0", 2);
      break;
    }
    case "thorn_wolf": {
      // thorns along the back
      for (let i = 0; i < 4; i++) {
        const x = -w * 0.3 + i * w * 0.17;
        outlined(ctx, poly([x - 7, -h * 0.9, x, -h * 0.9 - 16 - (i % 2) * 5, x + 7, -h * 0.9]), "#5e7a3a", 2.5);
      }
      break;
    }
    case "mire_bat": {
      // flapping wings on the back
      const flap = pose === "walk0" || pose === "walk1" ? Math.sin(t / 90) * 0.35 : Math.sin(t / 300) * 0.15;
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(-w * 0.05, -h * 0.85);
        ctx.rotate(side * (0.35 + flap));
        const k = Math.max(0.8, w / 75);
        ctx.scale(k, k);
        outlined(ctx, poly([0, 0, side * 30, -30, side * 44, -8, side * 33, -2, side * 26, 10, side * 12, 4]), "#5b4478", 2.5 / k);
        ctx.restore();
      }
      break;
    }
    case "moss_golem": {
      // moss and a pebble or two
      outlined(ctx, ellipse(-w * 0.1, -h * 0.9, w * 0.22, 7), "#5f9a3f", 2.5);
      outlined(ctx, ellipse(w * 0.2, -h * 0.55, 8, 6), "#5f9a3f", 2);
      outlined(ctx, ellipse(-w * 0.28, -h * 0.4, 6, 5), "#9a9488", 2);
      break;
    }
    case "mirefang": {
      // a small crown
      const top = -h * 0.95;
      outlined(ctx, poly([-14, top + 4, -16, top - 12, -7, top - 4, 0, top - 16, 7, top - 4, 16, top - 12, 14, top + 4]), "#f5c542", 3);
      outlined(ctx, ellipse(0, top - 5, 3, 3), "#d64b6b", 1.5);
      break;
    }
  }
  ctx.restore();
}
