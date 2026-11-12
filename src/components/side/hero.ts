// The player (and the villagers), drawn in code so every self-customised look
// shows: gender, skin tone, hair style, hair colour, eye colour and build.
// Chibi proportions and a thick dark outline to match the art pack.

import type { Appearance, ClassId, WeaponType } from "@/lib/game/types";
import { BODY_OPTIONS, CLASS_BODY } from "@/lib/game/data/classes";
import { OUTLINE, ellipse, outlined, poly, roundRect, shade } from "./sprites";

type Ctx = CanvasRenderingContext2D;

export const SKIN: Record<string, string> = {
  Light: "#ffe0c7",
  Fair: "#f6cfa8",
  Medium: "#e3a87a",
  Tan: "#c98b5b",
  Brown: "#9b6640",
  Dark: "#6e4529",
};
export const HAIR: Record<string, string> = {
  Black: "#2d2a33",
  Brown: "#6b4226",
  Blonde: "#f0cf6b",
  Red: "#c2412d",
  White: "#f2f0ea",
  Silver: "#b9c0cc",
  Blue: "#3f74d1",
  Green: "#3fa35a",
  Pink: "#f08bb7",
};
export const EYES: Record<string, string> = {
  Brown: "#7a4a24",
  Black: "#2a2a2a",
  Blue: "#3a7bd5",
  Green: "#3c9a4f",
  Gray: "#7c8794",
  Amber: "#d99a22",
  Red: "#c43b3b",
  Violet: "#8a55c7",
};
/** Shirt colour by class, so you can tell classes apart at a glance. */
export const CLASS_COLOR: Record<ClassId, string> = {
  swordsman: "#d24c4c",
  mage: "#5b6ee1",
  assassin: "#4a4e69",
  tanker: "#8d6e4c",
  ranger: "#4f9d55",
  gunslinger: "#c98a3a",
  tamer: "#3fb0a3",
  lancer: "#3d7fbf",
  saint: "#f0e6c8",
  blacksmith: "#7a5a44",
  monk: "#e08a3c",
  free: "#9aa3b5",
};

export interface Look {
  skin: string;
  hair: string;
  eyes: string;
  shirt: string;
  hairStyle: string;
  female: boolean;
  build: "Slim" | "Average" | "Strong";
  /** The animated body used in 3D (Knight, Barbarian, Mage, Rogue, Hooded Rogue). */
  body?: string;
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
    body: a.body && (BODY_OPTIONS as readonly string[]).includes(a.body) ? a.body : CLASS_BODY[classId] ?? "Rogue",
  };
}

export type Pose = "idle" | "walk" | "jump" | "fall" | "climb" | "attack" | "cast" | "block" | "hurt" | "dead";

/** How a weapon is used: swung, thrust, or fired from the hand. */
export type WeaponStyle = "swing" | "thrust" | "shoot" | "punch";
export const WEAPON_STYLE: Record<WeaponType, WeaponStyle> = {
  sword: "swing",
  staff: "shoot",
  daggers: "thrust",
  large_shield: "punch",
  bow: "shoot",
  pistol: "shoot",
  tamer_wand: "shoot",
  lance: "thrust",
  healing_bracelet: "shoot",
  hammer: "swing",
  strength_bracelet: "punch",
  unarmed: "punch",
};

const PANTS = "#3b3f58";
const SHOES = "#4a3428";
const WOOD = "#c8925a";
const WOOD_DARK = "#8a5a32";

export interface HeroFrame {
  pose: Pose;
  t: number; // ms, for idle bob and walk cycle
  progress: number; // 0..1 through an attack / cast
  weapon: WeaponType;
}

/** Draw with the feet at (0,0), facing right. The caller flips for left. */
export function drawHero(ctx: Ctx, L: Look, f: HeroFrame) {
  const { pose, t, progress } = f;
  if (pose === "dead") {
    ctx.save();
    ctx.translate(0, -12);
    ctx.rotate(-Math.PI / 2);
    ctx.translate(-30, 0);
    drawHero(ctx, L, { ...f, pose: "idle", t: 0 });
    ctx.restore();
    return;
  }
  const bw = L.build === "Strong" ? 34 : L.build === "Slim" ? 24 : 28;
  const walking = pose === "walk";
  const cyc = walking ? Math.sin(t / 80) : 0;
  const bob = pose === "idle" ? Math.sin(t / 400) * 1.5 : walking ? Math.abs(cyc) * -2 : 0;
  const style = WEAPON_STYLE[f.weapon];

  ctx.save();
  ctx.translate(0, bob);

  // ----- hair behind the head and body -----
  const hy = -64; // head centre
  if (L.hairStyle === "Long" || (L.female && L.hairStyle === "Medium")) {
    outlined(ctx, roundRect(-26, hy - 10, 34, L.hairStyle === "Long" ? 50 : 34, 12), L.hair);
  }
  if (L.hairStyle === "Ponytail") {
    const sw = Math.sin(t / 160) * (walking ? 4 : 1.5);
    outlined(ctx, ellipse(-30 + sw, hy + 4, 9, 20, 0.25), L.hair);
  }
  if (L.hairStyle === "Braided") {
    for (let i = 0; i < 4; i++) outlined(ctx, ellipse(-22, hy + 2 + i * 11, 7, 7), shade(L.hair, i % 2 ? -0.08 : 0), 3);
  }

  // ----- back arm -----
  drawArm(ctx, L, { x: -4, y: -44 }, armAngle(pose, style, progress, t, true), false);

  // ----- legs -----
  if (pose === "jump" || pose === "fall") {
    outlined(ctx, roundRect(-10, -24, 10, 18, 5), PANTS, 3);
    outlined(ctx, roundRect(2, -26, 10, 18, 5), PANTS, 3);
    outlined(ctx, ellipse(-4, -6, 7, 5), SHOES, 3);
    outlined(ctx, ellipse(9, -8, 7, 5), SHOES, 3);
  } else if (pose === "climb") {
    const c = Math.sin(t / 120) * 5;
    outlined(ctx, roundRect(-10, -24 + c, 10, 22, 5), PANTS, 3);
    outlined(ctx, roundRect(2, -24 - c, 10, 22, 5), PANTS, 3);
  } else {
    const a = cyc * 7;
    outlined(ctx, roundRect(-10 - a, -24, 10, 22, 5), PANTS, 3);
    outlined(ctx, roundRect(2 + a, -24, 10, 22, 5), PANTS, 3);
    outlined(ctx, ellipse(-4 - a, -3, 8, 5), SHOES, 3);
    outlined(ctx, ellipse(9 + a, -3, 8, 5), SHOES, 3);
  }

  // ----- body -----
  const top = -48;
  if (L.female) {
    outlined(ctx, poly([-bw / 2 + 2, top, bw / 2 - 2, top, bw / 2 + 5, -16, -bw / 2 - 5, -16]), L.shirt);
  } else {
    outlined(ctx, roundRect(-bw / 2, top, bw, 30, 8), L.shirt);
  }
  ctx.fillStyle = shade(L.shirt, -0.25);
  ctx.fillRect(-bw / 2 + 2, -24, bw - 4, 4); // belt

  // ----- head -----
  const hurt = pose === "hurt";
  outlined(ctx, ellipse(4, hy, 25, 23), L.skin);
  // ear
  outlined(ctx, ellipse(-8, hy + 2, 5, 6), L.skin, 3);
  // eyes: 3/4 view, both visible, the far one a little narrower
  for (const [ex, w] of [
    [10, 4.2],
    [22, 3.6],
  ] as const) {
    if (hurt) {
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(ex - 4, hy - 3);
      ctx.lineTo(ex + 4, hy + 3);
      ctx.moveTo(ex + 4, hy - 3);
      ctx.lineTo(ex - 4, hy + 3);
      ctx.stroke();
      continue;
    }
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(ex, hy, w + 1, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = L.eyes;
    ctx.beginPath();
    ctx.ellipse(ex + 1, hy + 0.5, w - 0.5, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = OUTLINE;
    ctx.beginPath();
    ctx.ellipse(ex + 1.5, hy + 1, 1.8, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(ex - 0.5, hy - 2.5, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  if (L.female) {
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(24, hy - 6);
    ctx.lineTo(27, hy - 8);
    ctx.stroke();
  }
  // mouth and cheek
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (hurt) ctx.arc(18, hy + 13, 3, Math.PI, 0);
  else ctx.arc(18, hy + 9, 3, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  ctx.fillStyle = "rgba(240,110,110,0.35)";
  ctx.beginPath();
  ctx.ellipse(8, hy + 8, 4, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // ----- hair on top -----
  drawHairTop(ctx, L, hy);

  // ----- front arm with the weapon -----
  drawArm(ctx, L, { x: 6, y: -44 }, armAngle(pose, style, progress, t, false), true, f.weapon, pose, progress);

  // block shimmer
  if (pose === "block") {
    ctx.strokeStyle = "rgba(120,190,255,0.85)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(14, -40, 34, -1.1, 1.1);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHairTop(ctx: Ctx, L: Look, hy: number) {
  const h = L.hair;
  switch (L.hairStyle) {
    case "Shaved": {
      ctx.save();
      ctx.globalAlpha = 0.55;
      outlined(ctx, poly([-20, hy - 6, -14, hy - 20, 4, hy - 25, 22, hy - 18, 26, hy - 10, 8, hy - 14, -10, hy - 10]), h, 2);
      ctx.restore();
      return;
    }
    case "Spiky": {
      outlined(
        ctx,
        poly([-22, hy + 2, -28, hy - 16, -18, hy - 18, -20, hy - 34, -4, hy - 26, 2, hy - 40, 12, hy - 26, 26, hy - 34, 24, hy - 18, 32, hy - 12, 24, hy - 8, 16, hy - 14, 10, hy - 6, 4, hy - 14, -6, hy - 8, -10, hy + 4]),
        h,
      );
      return;
    }
    default: {
      // a cap over the top and back of the head, then bangs
      outlined(ctx, poly([-22, hy + 8, -26, hy - 8, -18, hy - 22, 0, hy - 28, 18, hy - 24, 28, hy - 12, 28, hy - 4, 20, hy - 12, 12, hy - 6, 6, hy - 14, -2, hy - 8, -10, hy - 8, -12, hy + 8]), h);
      if (L.hairStyle === "Medium" || L.hairStyle === "Long") {
        outlined(ctx, poly([-24, hy - 4, -12, hy - 8, -12, hy + 16, -22, hy + 14]), h, 3);
      }
      if (L.hairStyle === "Ponytail" || L.hairStyle === "Braided") {
        outlined(ctx, ellipse(-22, hy - 6, 5, 5), shade(h, -0.3), 3); // the tie
      }
    }
  }
}

function armAngle(pose: Pose, style: WeaponStyle, p: number, t: number, back: boolean): number {
  // 0 = straight down, positive = forward (towards facing)
  if (pose === "walk") return (back ? 1 : -1) * Math.sin(t / 80) * 0.6;
  if (pose === "jump" || pose === "fall") return back ? -0.6 : 0.9;
  if (pose === "climb") return Math.PI - 0.4 + (back ? 1 : -1) * Math.sin(t / 120) * 0.3;
  if (pose === "block") return back ? 0.6 : 1.4;
  if (pose === "hurt") return back ? -0.8 : -0.5;
  if (pose === "cast") return back ? 1.2 : 2.2 - p * 0.6;
  if (pose === "attack") {
    if (back) return style === "shoot" ? 1.3 : -0.4;
    if (style === "swing") return -2.4 + p * 3.6; // overhead to forward-down
    if (style === "thrust") return 1.57 + (p < 0.5 ? -0.3 : 0);
    if (style === "punch") return 1.57;
    return 1.57; // shoot: held out
  }
  return back ? 0.15 : -0.1;
}

function drawArm(
  ctx: Ctx,
  L: Look,
  shoulder: { x: number; y: number },
  angle: number,
  front: boolean,
  weapon?: WeaponType,
  pose?: Pose,
  progress = 0,
) {
  ctx.save();
  ctx.translate(shoulder.x, shoulder.y);
  ctx.rotate(-angle); // canvas y points down; rotate so positive angle swings forward
  let reach = 22;
  if (front && pose === "attack" && weapon) {
    const s = WEAPON_STYLE[weapon];
    if (s === "thrust" || s === "punch") reach = 22 + Math.sin(progress * Math.PI) * 10;
  }
  outlined(ctx, roundRect(-5, 0, 10, reach, 5), front ? L.shirt : shade(L.shirt, -0.12), 3);
  outlined(ctx, ellipse(0, reach + 2, 6, 6), L.skin, 3);
  if (front && weapon) {
    ctx.translate(0, reach + 2);
    drawWeapon(ctx, weapon);
  }
  ctx.restore();
}

/** Weapons in the hand. The arm points along +y here. */
function drawWeapon(ctx: Ctx, w: WeaponType) {
  switch (w) {
    case "sword":
      outlined(ctx, roundRect(-3, -6, 6, 12, 2), WOOD_DARK, 3);
      outlined(ctx, roundRect(-9, 4, 18, 5, 2), WOOD_DARK, 3);
      outlined(ctx, poly([-5, 9, 5, 9, 4, 50, 0, 58, -4, 50]), WOOD, 3);
      return;
    case "daggers":
      outlined(ctx, roundRect(-6, 3, 12, 4, 2), WOOD_DARK, 3);
      outlined(ctx, poly([-3, 7, 3, 7, 2, 28, 0, 33, -2, 28]), WOOD, 3);
      return;
    case "lance":
      outlined(ctx, roundRect(-3, -30, 6, 96, 3), WOOD_DARK, 3);
      outlined(ctx, poly([-8, 64, 8, 64, 0, 92]), WOOD, 3);
      return;
    case "hammer":
      outlined(ctx, roundRect(-3, -6, 6, 46, 3), WOOD_DARK, 3);
      outlined(ctx, roundRect(-16, 36, 32, 20, 4), WOOD, 3);
      return;
    case "staff":
      outlined(ctx, roundRect(-3, -40, 6, 80, 3), WOOD_DARK, 3);
      outlined(ctx, ellipse(0, -44, 8, 8), "#6fd3a3", 3);
      return;
    case "tamer_wand":
      outlined(ctx, roundRect(-2.5, -4, 5, 34, 2), WOOD_DARK, 3);
      outlined(ctx, poly([0, 30, 5, 36, 11, 37, 6, 41, 8, 47, 0, 44, -8, 47, -6, 41, -11, 37, -5, 36]), "#ffd35c", 3);
      return;
    case "bow": {
      ctx.save();
      ctx.rotate(-Math.PI / 2);
      const p = new Path2D();
      p.arc(-8, 0, 30, -1.2, 1.2);
      ctx.lineWidth = 9;
      ctx.strokeStyle = OUTLINE;
      ctx.stroke(p);
      ctx.lineWidth = 5;
      ctx.strokeStyle = WOOD;
      ctx.stroke(p);
      ctx.strokeStyle = "#eee";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-8 + 30 * Math.cos(-1.2), 30 * Math.sin(-1.2));
      ctx.lineTo(-8 + 30 * Math.cos(1.2), 30 * Math.sin(1.2));
      ctx.stroke();
      ctx.restore();
      return;
    }
    case "pistol":
      outlined(ctx, roundRect(-4, -2, 8, 12, 2), WOOD_DARK, 3);
      outlined(ctx, roundRect(-4, 6, 22, 8, 2), WOOD, 3);
      ctx.save();
      ctx.rotate(-Math.PI / 2);
      ctx.restore();
      return;
    case "large_shield":
      outlined(ctx, ellipse(10, 4, 16, 24), WOOD, 4);
      outlined(ctx, ellipse(10, 4, 5, 5), WOOD_DARK, 3);
      return;
    case "healing_bracelet":
      outlined(ctx, ellipse(0, -8, 8, 4), WOOD, 3);
      outlined(ctx, ellipse(0, -8, 3, 3), "#8fe3ff", 2);
      return;
    case "strength_bracelet":
      outlined(ctx, ellipse(0, -8, 8, 4), WOOD_DARK, 3);
      outlined(ctx, ellipse(0, -8, 3, 3), "#e05555", 2);
      return;
    case "unarmed":
      return;
  }
}

/** A small round portrait of the hero's face for the HUD. */
export function drawHeroHead(ctx: Ctx, L: Look, size: number) {
  ctx.save();
  ctx.scale(size / 64, size / 64);
  ctx.translate(28, 100);
  drawHero(ctx, L, { pose: "idle", t: 0, progress: 0, weapon: "unarmed" });
  ctx.restore();
}
