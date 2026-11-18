// 3D models for the game, built in code from simple rounded shapes:
// soft toon shading with a dark outline, bright colours, chibi proportions.
// Monsters and pets use a softer plush look with no outline and big shiny eyes.
// Every model faces +z and stands with its feet at y = 0. One world unit here
// is one tile (64 game units), so the player is about 1.3 tall.

import * as THREE from "three";
import type { WeaponType } from "@/lib/game/types";
import type { Look } from "../side/hero";
import { MONSTER_LOOKS } from "../side/sprites";
import { makeHornWeapon } from "./hornWeapons";

export const U = 1 / 64; // game units -> scene units

// ---------- materials ----------

let gradient: THREE.DataTexture | null = null;
/** Three soft bands of light: the anime "cel" look. */
function gradientMap() {
  if (gradient) return gradient;
  const data = new Uint8Array([120, 120, 120, 255, 200, 200, 200, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}

const shared = new Map<string, THREE.MeshToonMaterial>();
/** A shared toon material (for things that never flash). */
export function toon(color: string, opts: { emissive?: string; emissiveIntensity?: number; transparent?: boolean; opacity?: number } = {}) {
  const key = `${color}|${opts.emissive ?? ""}|${opts.emissiveIntensity ?? 0}|${opts.opacity ?? 1}`;
  let m = shared.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: gradientMap() });
    if (opts.emissive) {
      m.emissive = new THREE.Color(opts.emissive);
      m.emissiveIntensity = opts.emissiveIntensity ?? 1;
    }
    if (opts.transparent || (opts.opacity ?? 1) < 1) {
      m.transparent = true;
      m.opacity = opts.opacity ?? 1;
      m.depthWrite = false;
    }
    shared.set(key, m);
  }
  return m;
}

/** A material of its own (monsters flash white when hit, so each needs its own). */
export function ownToon(color: string, opts: { transparent?: boolean; opacity?: number } = {}) {
  const m = new THREE.MeshToonMaterial({ color, gradientMap: gradientMap() });
  if (opts.transparent) {
    m.transparent = true;
    m.opacity = opts.opacity ?? 0.85;
  }
  return m;
}

const OUTLINE_COLOR = new THREE.Color("#2a2238");
let outlineMat: THREE.ShaderMaterial | null = null;
/** The dark outline: the same shape pushed out along its normals, drawn inside-out. */
function outline() {
  if (outlineMat) return outlineMat;
  outlineMat = new THREE.ShaderMaterial({
    uniforms: { thickness: { value: 0.022 }, color: { value: OUTLINE_COLOR } },
    vertexShader: `
      uniform float thickness;
      void main() {
        vec3 n = normalize(normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec3 wn = normalize(mat3(modelMatrix) * n);
        wp.xyz += wn * thickness;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3 color;
      void main() { gl_FragColor = vec4(color, 1.0); }`,
    side: THREE.BackSide,
  });
  return outlineMat;
}

/** One solid piece of a model, with its outline. */
export function piece(geo: THREE.BufferGeometry, mat: THREE.Material, opts: { outline?: boolean; shadow?: boolean } = {}): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = opts.shadow !== false;
  m.receiveShadow = false;
  if (opts.outline !== false) {
    const o = new THREE.Mesh(geo, outline());
    o.castShadow = false;
    o.userData.outline = true;
    m.add(o);
  }
  return m;
}

// ---------- shared shapes ----------

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g as T;
}
export const sphere = (r: number, seg = 18) => cached(`s${r}|${seg}`, () => new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75)));
export const capsule = (r: number, len: number) => cached(`c${r}|${len}`, () => new THREE.CapsuleGeometry(r, len, 6, 12));
export const cone = (r: number, h: number, seg = 12) => cached(`k${r}|${h}|${seg}`, () => new THREE.ConeGeometry(r, h, seg));
export const cyl = (r0: number, r1: number, h: number, seg = 12) => cached(`y${r0}|${r1}|${h}|${seg}`, () => new THREE.CylinderGeometry(r0, r1, h, seg));
export const box = (w: number, h: number, d: number) => cached(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
export const torus = (r: number, t: number, arc = Math.PI * 2) => cached(`t${r}|${t}|${arc}`, () => new THREE.TorusGeometry(r, t, 8, 24, arc));
export const ico = (r: number, detail = 1) => cached(`i${r}|${detail}`, () => new THREE.IcosahedronGeometry(r, detail));
export const dodeca = (r: number) => cached(`d${r}`, () => new THREE.DodecahedronGeometry(r, 0));

function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number, s?: number | [number, number, number]): T {
  o.position.set(x, y, z);
  if (typeof s === "number") o.scale.setScalar(s);
  else if (s) o.scale.set(...s);
  return o;
}

/** Shiny cartoon eyes: dark oval with a white sparkle. */
function eye(r: number, color = "#2a2238") {
  const g = new THREE.Group();
  g.add(at(piece(sphere(r, 12), toon(color), { outline: false, shadow: false }), 0, 0, 0, [1, 1.25, 0.55]));
  g.add(at(piece(sphere(r * 0.38, 8), toon("#ffffff", { emissive: "#ffffff", emissiveIntensity: 0.6 }), { outline: false, shadow: false }), r * 0.3, r * 0.4, r * 0.4));
  return g;
}

// ---------- the player and villagers ----------

export type HeroPose = "idle" | "walk" | "jump" | "fall" | "attack" | "cast" | "block" | "hurt" | "dead";

export interface HeroModel {
  root: THREE.Group;
  /** Put a weapon in the hands; horn = the Horn Rabbit version of it. */
  set(weapon: WeaponType, horn?: boolean): void;
  horn?: boolean;
  animate(pose: HeroPose, t: number, walkT: number, progress: number): void;
  weapon: WeaponType | null;
  /** Goes up when the hero swaps its model (an anime hero once its file has loaded). */
  version?: number;
  /** Frees the GPU memory of a hero that is thrown away. */
  dispose?(): void;
}

const lighten = (hex: string, k: number) => "#" + new THREE.Color(hex).lerp(new THREE.Color(k > 0 ? "#ffffff" : "#000000"), Math.abs(k)).getHexString();

export function makeHero(L: Look): HeroModel {
  const root = new THREE.Group();
  const body = new THREE.Group(); // everything that bobs and leans
  root.add(body);
  const bw = L.build === "Strong" ? 1.18 : L.build === "Slim" ? 0.88 : 1;
  const skin = toon(L.skin);
  const shirt = toon(L.shirt);
  const pants = toon(lighten(L.shirt, -0.55));
  const hair = toon(L.hair);

  // legs
  const legL = new THREE.Group();
  const legR = new THREE.Group();
  for (const [g, x] of [
    [legL, 0.1],
    [legR, -0.1],
  ] as const) {
    g.position.set(x * bw, 0.36, 0);
    g.add(at(piece(capsule(0.075 * bw, 0.18), pants), 0, -0.14, 0));
    g.add(at(piece(sphere(0.09, 10), toon("#5a3d2b")), 0, -0.3, 0.03, [1, 0.7, 1.35]));
    body.add(g);
  }
  // torso and belt
  body.add(at(piece(capsule(0.17 * bw, 0.18), shirt), 0, 0.55, 0, [1, 1, 0.8]));
  body.add(at(piece(cyl(0.175 * bw, 0.175 * bw, 0.05, 14), toon("#4a3426"), { outline: false }), 0, 0.42, 0, [1, 1, 0.8]));
  if (L.female) body.add(at(piece(cone(0.2 * bw, 0.18, 14), shirt), 0, 0.4, 0, [1, 1, 0.82]));
  // arms (pivot at the shoulder)
  const armL = new THREE.Group();
  const armR = new THREE.Group();
  for (const [g, x] of [
    [armL, 0.22],
    [armR, -0.22],
  ] as const) {
    g.position.set(x * bw, 0.68, 0);
    g.add(at(piece(capsule(0.06 * bw, 0.16), shirt), 0, -0.1, 0));
    g.add(at(piece(sphere(0.07, 10), skin), 0, -0.24, 0));
    body.add(g);
  }
  // head
  const head = new THREE.Group();
  head.position.set(0, 0.98, 0);
  body.add(head);
  head.add(piece(sphere(0.3, 22), skin));
  head.add(at(eye(0.05, "#2a2238"), 0.11, -0.02, 0.27));
  head.add(at(eye(0.05, "#2a2238"), -0.11, -0.02, 0.27));
  // coloured irises
  head.add(at(piece(sphere(0.026, 8), toon(L.eyes), { outline: false, shadow: false }), 0.11, -0.04, 0.3));
  head.add(at(piece(sphere(0.026, 8), toon(L.eyes), { outline: false, shadow: false }), -0.11, -0.04, 0.3));
  head.add(at(piece(sphere(0.04, 8), toon("#ff9aa8", { opacity: 0.6 }), { outline: false, shadow: false }), 0.17, -0.1, 0.24, [1, 0.6, 0.4]));
  head.add(at(piece(sphere(0.04, 8), toon("#ff9aa8", { opacity: 0.6 }), { outline: false, shadow: false }), -0.17, -0.1, 0.24, [1, 0.6, 0.4]));
  // hair
  const hs = L.hairStyle;
  if (hs !== "Shaved") {
    const cap = new THREE.SphereGeometry(0.325, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.55);
    head.add(at(piece(cap, hair), 0, 0.02, -0.02, [1, 1, 1]));
    // fringe
    head.add(at(piece(sphere(0.12, 12), hair), 0.12, 0.17, 0.2, [1.2, 0.6, 0.6]));
    head.add(at(piece(sphere(0.12, 12), hair), -0.1, 0.18, 0.21, [1.1, 0.55, 0.6]));
  } else {
    const cap = new THREE.SphereGeometry(0.305, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.4);
    head.add(at(piece(cap, hair, { outline: false }), 0, 0.01, -0.01));
  }
  if (hs === "Long" || (L.female && hs === "Medium")) head.add(at(piece(capsule(0.22, hs === "Long" ? 0.32 : 0.12), hair), 0, -0.15, -0.12, [1.15, 1, 0.6]));
  if (hs === "Medium" && !L.female) head.add(at(piece(sphere(0.28, 14), hair), 0, -0.04, -0.1, [1.12, 0.8, 0.9]));
  if (hs === "Ponytail") {
    head.add(at(piece(sphere(0.06, 8), toon("#e05a7a")), 0, 0.1, -0.3));
    head.add(at(piece(capsule(0.08, 0.28), hair), 0, -0.12, -0.38, [1, 1, 1]).rotateX(0.35));
  }
  if (hs === "Braided") {
    for (const x of [0.2, -0.2]) for (let i = 0; i < 3; i++) head.add(at(piece(sphere(0.06, 8), hair), x, -0.18 - i * 0.1, -0.05));
  }
  if (hs === "Spiky") {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const s = piece(cone(0.08, 0.24, 6), hair);
      s.position.set(Math.cos(a) * 0.17, 0.26, Math.sin(a) * 0.17 - 0.04);
      s.lookAt(Math.cos(a) * 0.6, 0.6, Math.sin(a) * 0.6);
      s.rotateX(Math.PI / 2);
      head.add(s);
    }
  }

  // weapon slots
  const handR = new THREE.Group();
  handR.position.set(0, -0.25, 0.02);
  armR.add(handR);
  const handL = new THREE.Group();
  handL.position.set(0, -0.25, 0.02);
  handR.userData.weapon = handL.userData.weapon = true;
  armL.add(handL);

  const model: HeroModel = {
    root,
    weapon: null,
    set(weapon, horn = false) {
      if (model.weapon === weapon && !!model.horn === horn) return;
      model.weapon = weapon;
      model.horn = horn;
      handR.clear();
      handL.clear();
      const w = horn ? makeHornWeapon(weapon, L.glow) : makeWeapon(weapon);
      if (w.right) handR.add(w.right);
      if (w.left) handL.add(w.left);
    },
    animate(pose, t, walkT, progress) {
      animateRig({ body, head, legL, legR, armL, armR }, model.weapon, pose, t, walkT, progress);
    },
  };
  return model;
}

/** The moving parts of a hero built from pieces (the code-built and Brick heroes). */
export interface HeroRig {
  body: THREE.Object3D;
  head: THREE.Object3D;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
}

/** Poses a hero built from pieces: walking, attacking with each weapon style, blocking and so on. */
export function animateRig(rig: HeroRig, weapon: WeaponType | null, pose: HeroPose, t: number, walkT: number, progress: number) {
  const { body, head, legL, legR, armL, armR } = rig;
  body.position.set(0, 0, 0);
  body.rotation.set(0, 0, 0);
  head.rotation.set(0, 0, 0);
  legL.rotation.set(0, 0, 0);
  legR.rotation.set(0, 0, 0);
  armL.rotation.set(0, 0, 0.12);
  armR.rotation.set(0, 0, -0.12);
  armR.position.z = 0;
  const style = weapon ? WEAPON_LOOK[weapon] : "punch";
  if (pose === "idle") {
    body.position.y = Math.sin(t / 380) * 0.012;
    armL.rotation.z = 0.12 + Math.sin(t / 380) * 0.03;
    armR.rotation.z = -0.12 - Math.sin(t / 380) * 0.03;
  } else if (pose === "walk") {
    const s = Math.sin(walkT / 95);
    legL.rotation.x = s * 0.7;
    legR.rotation.x = -s * 0.7;
    armL.rotation.x = -s * 0.6;
    armR.rotation.x = s * 0.6;
    body.position.y = Math.abs(Math.cos(walkT / 95)) * 0.04;
    body.rotation.x = 0.08;
  } else if (pose === "jump" || pose === "fall") {
    legL.rotation.x = -0.6;
    legR.rotation.x = 0.3;
    armL.rotation.set(-0.4, 0, 0.8);
    armR.rotation.set(-0.4, 0, -0.8);
  } else if (pose === "attack") {
    const p = Math.min(1, progress);
    if (style === "swing") {
      // big overhead slash
      armR.rotation.x = -2.6 + p * 3.4;
      armR.rotation.z = -0.3;
      body.rotation.y = 0.4 - p * 0.8;
    } else if (style === "thrust") {
      armR.rotation.x = -1.5;
      body.position.z = Math.sin(p * Math.PI) * 0.12;
      armR.position.z = Math.sin(p * Math.PI) * 0.2;
    } else if (style === "shoot") {
      armR.rotation.x = -1.5;
      armL.rotation.x = weapon === "bow" ? -1.5 : 0;
      body.rotation.x = -Math.sin(p * Math.PI) * 0.08;
    } else {
      // a punch, alternating hands
      const left = Math.floor(t / 300) % 2 === 0;
      (left ? armL : armR).rotation.x = -1.6 * Math.sin(p * Math.PI);
      body.rotation.y = (left ? -0.25 : 0.25) * Math.sin(p * Math.PI);
    }
    legL.rotation.x = 0.3;
    legR.rotation.x = -0.25;
  } else if (pose === "cast") {
    armL.rotation.set(-2.6, 0, 0.3);
    armR.rotation.set(-2.6, 0, -0.3);
    body.position.y = 0.04;
  } else if (pose === "block") {
    armL.rotation.set(-1.4, 0, -0.5);
    armR.rotation.set(-1.2, 0, 0.6);
    body.rotation.x = 0.12;
    legL.rotation.x = 0.35;
    legR.rotation.x = -0.35;
  } else if (pose === "hurt") {
    body.rotation.x = -0.3;
    armL.rotation.z = 0.8;
    armR.rotation.z = -0.8;
  } else if (pose === "dead") {
    body.rotation.x = -Math.PI / 2;
    body.position.y = 0.16;
    body.position.z = -0.5;
  }
}

/** How each weapon is held and used. */
export const WEAPON_LOOK: Record<WeaponType, "swing" | "thrust" | "shoot" | "punch"> = {
  sword: "swing",
  daggers: "swing",
  hammer: "swing",
  lance: "thrust",
  large_shield: "swing",
  bow: "shoot",
  pistol: "shoot",
  staff: "shoot",
  tamer_wand: "shoot",
  healing_bracelet: "shoot",
  strength_bracelet: "punch",
  unarmed: "punch",
};

export function makeWeapon(w: WeaponType): { right?: THREE.Object3D; left?: THREE.Object3D } {
  const metal = toon("#dfe6f0");
  const wood = toon("#9a6a3c");
  const gold = toon("#f5c542");
  const g = new THREE.Group();
  // weapons point "forward" from the hand: down the arm is -y, so a held blade goes along -y then forward
  switch (w) {
    case "sword": {
      g.add(at(piece(box(0.06, 0.5, 0.02), metal), 0, -0.3, 0));
      g.add(at(piece(box(0.18, 0.04, 0.05), gold), 0, -0.04, 0));
      g.add(at(piece(cyl(0.025, 0.025, 0.1, 6), wood), 0, 0.03, 0));
      return { right: g };
    }
    case "daggers": {
      const d = () => {
        const x = new THREE.Group();
        x.add(at(piece(box(0.05, 0.24, 0.02), metal), 0, -0.16, 0));
        x.add(at(piece(box(0.1, 0.03, 0.04), toon("#5a5a6a")), 0, -0.03, 0));
        return x;
      };
      return { right: d(), left: d() };
    }
    case "hammer": {
      g.add(at(piece(cyl(0.025, 0.025, 0.5, 6), wood), 0, -0.2, 0));
      g.add(at(piece(box(0.2, 0.14, 0.14), toon("#8c95a6")), 0, -0.45, 0));
      return { right: g };
    }
    case "lance": {
      g.rotation.x = -Math.PI / 2;
      g.add(at(piece(cyl(0.025, 0.025, 1.1, 6), wood), 0, -0.15, 0));
      g.add(at(piece(cone(0.06, 0.24, 8), metal), 0, -0.82, 0).rotateX(Math.PI));
      g.add(at(piece(cone(0.08, 0.14, 8), toon("#3d7fbf")), 0, -0.6, 0).rotateX(Math.PI));
      return { right: g };
    }
    case "large_shield": {
      const s = new THREE.Group();
      s.add(at(piece(cyl(0.2, 0.2, 0.05, 16), toon("#8d6e4c")), 0, -0.05, 0.07).rotateX(Math.PI / 2));
      s.add(at(piece(cyl(0.07, 0.07, 0.06, 10), gold), 0, -0.05, 0.1).rotateX(Math.PI / 2));
      return { left: s };
    }
    case "bow": {
      const b = new THREE.Group();
      b.add(at(piece(torus(0.28, 0.02, Math.PI), wood), 0, -0.05, 0.05).rotateY(Math.PI / 2).rotateZ(Math.PI / 2));
      return { left: b };
    }
    case "pistol": {
      g.add(at(piece(box(0.06, 0.1, 0.06), toon("#4a4a55")), 0, -0.04, 0.04));
      g.add(at(piece(box(0.05, 0.05, 0.22), toon("#6b6b78")), 0, 0.01, 0.13));
      return { right: g };
    }
    case "staff": {
      g.add(at(piece(cyl(0.025, 0.03, 0.9, 6), wood), 0, -0.05, 0));
      g.add(at(piece(ico(0.08, 1), toon("#8fb4ff", { emissive: "#6f8fff", emissiveIntensity: 0.8 })), 0, 0.44, 0));
      return { right: g };
    }
    case "tamer_wand": {
      g.add(at(piece(cyl(0.02, 0.02, 0.36, 6), toon("#7ad1c4")), 0, -0.05, 0));
      g.add(at(piece(ico(0.07, 0), toon("#ffe066", { emissive: "#ffd34d", emissiveIntensity: 0.7 })), 0, 0.16, 0));
      return { right: g };
    }
    case "healing_bracelet":
    case "strength_bracelet": {
      const c = w === "healing_bracelet" ? toon("#7fe0a0", { emissive: "#5fd36a", emissiveIntensity: 0.5 }) : gold;
      const r = new THREE.Group();
      r.add(at(piece(torus(0.07, 0.02), c), 0, 0.06, 0).rotateX(Math.PI / 2));
      const l = new THREE.Group();
      l.add(at(piece(torus(0.07, 0.02), c), 0, 0.06, 0).rotateX(Math.PI / 2));
      return { right: r, left: l };
    }
    default:
      return {};
  }
}

// ---------- monsters and pets ----------

/** Each species' main colours (match the side view's art). */
export const SPECIES_COLOR: Record<string, string> = {
  green_slime: "#5fd36a",
  horned_rabbit: "#e8b07a",
  bog_toad: "#6f8f3a",
  thorn_wolf: "#7d8aa6",
  mire_bat: "#7b4fa8",
  moss_golem: "#8a8f86",
  mirefang: "#3f5a52",
};

export interface MonsterModel {
  root: THREE.Group;
  /** Materials of its own, so it can flash white when hit. */
  mats: MonsterMat[];
  animate(pose: "rest" | "walk" | "windup" | "attack" | "dead", t: number, walkT: number): void;
  height: number;
}

type Feature = "horn" | "thorns" | "wings" | "moss" | "crown" | "eyes_big" | "shine";
const FEATURE_OF: Record<string, Feature> = {
  green_slime: "shine",
  horned_rabbit: "horn",
  bog_toad: "eyes_big",
  thorn_wolf: "thorns",
  mire_bat: "wings",
  moss_golem: "moss",
  mirefang: "crown",
};

/** A mixed monster takes the body of its biggest parent. */
export function bodySpecies(species: string): string {
  const parts = species.split("+").filter((s) => MONSTER_LOOKS[s]);
  if (!parts.length) return "green_slime";
  return parts.reduce((a, b) => (MONSTER_LOOKS[b].body.w * MONSTER_LOOKS[b].body.h > MONSTER_LOOKS[a].body.w * MONSTER_LOOKS[a].body.h ? b : a));
}

// ----- soft chibi parts: plush shading, no ink outline, big shiny eyes -----

export type MonsterMat = THREE.MeshPhysicalMaterial;
const PLUSH_GLOW = 0.3;
/** A plush material of its own. It glows faintly in its own colour so it stays soft at dusk. */
function ownPlush(color: string, opts: { transparent?: boolean; opacity?: number; double?: boolean } = {}): MonsterMat {
  const m = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.78,
    sheen: 1,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color(lighten(color, 0.55)),
    emissive: color,
    emissiveIntensity: PLUSH_GLOW,
  });
  // what the scene goes back to when the monster is not flashing
  m.userData.glow = { color: new THREE.Color(color), intensity: PLUSH_GLOW };
  if (opts.transparent) {
    m.transparent = true;
    m.opacity = opts.opacity ?? 0.85;
  }
  if (opts.double) m.side = THREE.DoubleSide;
  return m;
}
const softShared = new Map<string, THREE.Material>();
/** A shared plush material, for small parts that never flash. */
function soft(color: string, glow = PLUSH_GLOW): THREE.Material {
  const key = `p|${color}|${glow}`;
  let m = softShared.get(key);
  if (!m) {
    const p = ownPlush(color);
    p.emissiveIntensity = glow;
    m = p;
    softShared.set(key, m);
  }
  return m;
}
/** A flat colour that ignores the light (eye shine, blush, mouths). */
function flat(color: string, opacity = 1, power = 1): THREE.Material {
  const key = `f|${color}|${opacity}|${power}`;
  let m = softShared.get(key);
  if (!m) {
    const b = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power) });
    if (opacity < 1) {
      b.transparent = true;
      b.opacity = opacity;
      b.depthWrite = false;
    }
    m = b;
    softShared.set(key, m);
  }
  return m;
}
function glossy(): THREE.Material {
  let m = softShared.get("eye");
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({ color: "#2b1c3a", roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 });
    softShared.set("eye", m);
  }
  return m;
}
/** A soft part: no outline. */
const blob = (geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true) => piece(geo, mat, { outline: false, shadow });
const caps = (r: number, len: number) => cached(`sc${r}|${len}`, () => new THREE.CapsuleGeometry(r, len, 8, 22));

/** A big shiny eye: dark and glossy, a warm colour low in it, two white sparkles. `side` is -1 or 1. */
function softEye(s: number, side: number, iris: string) {
  const g = new THREE.Group();
  g.rotation.y = side * 0.32;
  g.add(at(blob(sphere(0.5, 24), glossy(), false), 0, 0, 0, [s, s * 1.24, s * 0.55]));
  g.add(at(blob(sphere(0.5, 14), flat(iris), false), 0, -0.27 * s, 0.13 * s, [0.67 * s, 0.55 * s, 0.3 * s]));
  g.add(at(blob(sphere(0.5, 10), flat("#ffffff"), false), -0.18 * s, 0.3 * s, 0.24 * s, [0.33 * s, 0.39 * s, 0.12 * s]));
  g.add(at(blob(sphere(0.5, 8), flat("#ffffff"), false), 0.21 * s, -0.24 * s, 0.26 * s, [0.15 * s, 0.17 * s, 0.07 * s]));
  return g;
}
/** A rosy cheek. */
function blush(s: number, side: number, turn = 0.7) {
  const b = blob(
    cached("blush", () => new THREE.CircleGeometry(0.5, 20)),
    flat("#ff7fa0", 0.55),
    false,
  );
  b.rotation.y = side * turn;
  b.scale.set(s * 1.25, s * 0.75, 1);
  return b;
}
/** A little "w" mouth. */
function smile(s: number) {
  const g = new THREE.Group();
  for (const x of [-1, 1]) {
    const m = blob(torus(0.5, 0.11, Math.PI), flat("#7a4a3a"), false);
    m.position.x = x * s * 0.5;
    m.rotation.z = Math.PI;
    m.scale.setScalar(s);
    g.add(m);
  }
  return g;
}
/** A frowning brow, to make a cute face look fierce. */
function brow(s: number, side: number) {
  const b = blob(caps(0.5, 2.4), flat("#3a2a3f"), false);
  b.scale.setScalar(s * 0.12);
  b.rotation.z = Math.PI / 2 + side * 0.38;
  return b;
}
/** The ivory horn with a gentle spiral. Stands along +y, base at 0. */
function softHorn(s: number) {
  const g = new THREE.Group();
  const ivory = soft("#fff1cf", 0.2);
  g.add(at(blob(cone(0.2, 1, 20), ivory), 0, 0.5 * s, 0, s));
  for (let i = 0; i < 4; i++) {
    const k = i / 4;
    const ring = blob(torus(0.5, 0.1), ivory, false);
    ring.position.y = (0.09 + k * 0.76) * s;
    ring.rotation.x = Math.PI / 2 + 0.22;
    ring.scale.setScalar(0.39 * s * (1 - k * 0.82));
    g.add(ring);
  }
  return g;
}

/**
 * Build a monster (or a pet: a bred pet is its biggest parent's body,
 * coloured between its parents, wearing the others' features).
 * Soft chibi style: round and squishy, a big head, big shiny eyes.
 */
export function makeMonster(species: string): MonsterModel {
  const parts = species.split("+").filter((s) => MONSTER_LOOKS[s]);
  const bodyId = bodySpecies(species);
  const others = parts.filter((p) => p !== bodyId);
  let color = SPECIES_COLOR[bodyId] ?? "#9aa3b5";
  if (others.length) {
    const c = new THREE.Color(color);
    for (const o of others) c.lerp(new THREE.Color(SPECIES_COLOR[o] ?? color), 0.5 / others.length);
    color = "#" + c.getHexString();
  }
  const mats: MonsterMat[] = [];
  const own = (hex: string, o?: { transparent?: boolean; opacity?: number; double?: boolean }) => {
    const m = ownPlush(hex, o);
    mats.push(m);
    return m;
  };
  const b = MONSTER_LOOKS[bodyId].body;
  const W = b.w * U;
  const H = b.h * U;
  const root = new THREE.Group();
  const rig = new THREE.Group(); // squashes and hops
  root.add(rig);
  const legs: THREE.Object3D[] = [];
  let wingL: THREE.Object3D | null = null;
  let wingR: THREE.Object3D | null = null;
  let jaw: THREE.Object3D | null = null;
  const eyes: THREE.Object3D[] = [];
  /** Small extra motion: ears, tails, blinking. */
  const extras: ((t: number, pose: string) => void)[] = [];
  const main = own(color);
  const dark = own(lighten(color, -0.22));
  const light = own(lighten(color, 0.55));

  // Each body is drawn in its own units inside `g`, then scaled to the monster's size.
  const g = new THREE.Group();
  rig.add(g);
  let u = W;
  const addEyes = (parent: THREE.Object3D, s: number, x: number, y: number, z: number, iris: string, tiltX = 0) => {
    for (const side of [-1, 1]) {
      const e = softEye(s, side, iris);
      e.position.set(side * x, y, z);
      e.rotation.x = tiltX;
      eyes.push(e);
      parent.add(e);
    }
  };
  const addBlush = (parent: THREE.Object3D, s: number, x: number, y: number, z: number, turn = 0.7) => {
    for (const side of [-1, 1]) parent.add(at(blush(s, side, turn), side * x, y, z));
  };

  // where features go on this body (in the body's own units): top of the head, the back, the sides
  let top = new THREE.Vector3(0, 1, 0);
  let back = new THREE.Vector3(0, 0.8, -0.15);
  let sides = 0.5;
  let face = new THREE.Vector3(0, 0.6, 0.45);

  switch (bodyId) {
    case "green_slime": {
      // a jelly drop with a little tip on top
      u = W;
      const jelly = own(color, { transparent: true, opacity: 0.9 });
      g.add(at(blob(sphere(0.5, 32), jelly), 0, 0.47, 0, [1, 0.95, 0.95]));
      g.add(at(blob(sphere(0.5, 16), jelly), 0, 0.93, 0, [0.24, 0.2, 0.24]));
      g.add(at(blob(sphere(0.5, 12), flat("#ffffff", 0.7), false), -0.22, 0.72, 0.3, [0.2, 0.13, 0.08]));
      g.add(at(blob(sphere(0.5, 8), flat("#ffffff", 0.6), false), -0.08, 0.8, 0.27, [0.07, 0.05, 0.04]));
      addEyes(g, 0.2, 0.19, 0.47, 0.435, "#2f9a55");
      addBlush(g, 0.13, 0.34, 0.33, 0.37);
      g.add(at(smile(0.055), 0, 0.33, 0.475));
      face = new THREE.Vector3(0, 0.47, 0.44);
      top = new THREE.Vector3(0, 0.95, 0);
      break;
    }
    case "horned_rabbit": {
      // small pudgy body, a head bigger than the body, long soft ears
      u = H * 1.15;
      g.add(at(blob(sphere(0.5, 28), main), 0, 0.32, 0, [0.64, 0.6, 0.62]));
      g.add(at(blob(sphere(0.5, 20), light), 0, 0.29, 0.13, [0.46, 0.44, 0.42]));
      g.add(at(blob(sphere(0.5, 14), light), 0, 0.3, -0.31, 0.2)); // fluffy tail
      for (const x of [-1, 1]) {
        const backFoot = at(blob(sphere(0.5, 14), main), x * 0.25, 0.07, 0.04, [0.2, 0.14, 0.32]);
        const frontFoot = at(blob(sphere(0.5, 14), light), x * 0.14, 0.08, 0.3, [0.15, 0.13, 0.19]);
        g.add(backFoot, frontFoot);
      }
      const head = new THREE.Group();
      head.position.set(0, 0.76, 0.07);
      g.add(head);
      head.add(at(blob(sphere(0.5, 32), main), 0, 0, 0, [0.84, 0.72, 0.76]));
      for (const x of [-1, 1]) head.add(at(blob(sphere(0.5, 14), main), x * 0.23, -0.14, 0.13, [0.27, 0.22, 0.27])); // puffy cheeks
      head.add(at(blob(sphere(0.5, 14), light), 0, -0.145, 0.29, [0.25, 0.16, 0.17])); // muzzle
      head.add(at(blob(sphere(0.5, 10), soft("#ff9db5")), 0, -0.1, 0.372, [0.07, 0.048, 0.04])); // nose
      head.add(at(smile(0.052), 0, -0.14, 0.376));
      addEyes(head, 0.165, 0.175, 0, 0.305, "#a8572f");
      addBlush(head, 0.12, 0.285, -0.095, 0.285);
      const ears: THREE.Group[] = [];
      for (const x of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(x * 0.15, 0.27, -0.03);
        pivot.rotation.z = -x * 0.2;
        pivot.add(at(blob(caps(0.085, 0.36), main), 0, 0.27, 0, [1, 1, 0.5]));
        pivot.add(at(blob(caps(0.05, 0.3), soft("#ff9db5"), false), 0, 0.26, 0.028, [1, 1, 0.35]));
        ears.push(pivot);
        head.add(pivot);
      }
      extras.push((t, pose) => {
        const lean = pose === "attack" ? -0.6 : pose === "windup" ? 0.35 : pose === "walk" ? -0.3 : 0;
        for (const e of ears) e.rotation.x += (lean - 0.12 + Math.sin(t / 590) * 0.08 - e.rotation.x) * 0.2;
        head.rotation.z = Math.sin(t / 1100) * 0.05;
      });
      face = new THREE.Vector3(0, 0.76, 0.37);
      top = new THREE.Vector3(0, 1.06, 0.27);
      break;
    }
    case "bog_toad": {
      // squat and wide, eyes up on two bumps, a big smile
      u = W;
      g.add(at(blob(sphere(0.5, 30), main), 0, 0.36, 0, [1, 0.72, 0.92]));
      g.add(at(blob(sphere(0.5, 20), own("#efe9bd")), 0, 0.28, 0.14, [0.76, 0.5, 0.66]));
      jaw = at(blob(torus(0.2, 0.014, Math.PI), flat("#5a3a3a"), false), 0, 0.44, 0.455);
      jaw.rotation.z = Math.PI;
      g.add(jaw);
      for (const [x, y, z] of [
        [-0.3, 0.6, -0.12],
        [0.3, 0.57, -0.02],
        [0.04, 0.66, -0.26],
      ])
        g.add(at(blob(sphere(0.5, 10), dark, false), x, y, z, [0.15, 0.08, 0.15]));
      for (const x of [-1, 1]) {
        g.add(at(blob(sphere(0.5, 18), main), x * 0.24, 0.66, 0.14, 0.32)); // eye bumps
        const leg = at(blob(sphere(0.5, 14), dark), x * 0.44, 0.1, -0.08, [0.32, 0.2, 0.46]);
        legs.push(leg);
        g.add(leg);
        g.add(at(blob(sphere(0.5, 12), dark), x * 0.3, 0.06, 0.34, [0.2, 0.12, 0.22]));
      }
      addEyes(g, 0.2, 0.25, 0.68, 0.27, "#c98a2b");
      addBlush(g, 0.12, 0.37, 0.4, 0.3, 0.85);
      face = new THREE.Vector3(0, 0.68, 0.27);
      top = new THREE.Vector3(0, 0.74, -0.05);
      break;
    }
    case "thorn_wolf": {
      // a wolf pup: big head, fluffy cheeks and tail, red eyes under a frown
      u = H;
      g.add(at(blob(sphere(0.5, 28), main), 0, 0.42, -0.2, [0.62, 0.6, 0.85]));
      g.add(at(blob(sphere(0.5, 18), light), 0, 0.4, 0.12, [0.45, 0.45, 0.35])); // chest fluff
      const head = new THREE.Group();
      head.position.set(0, 0.8, 0.3);
      g.add(head);
      head.add(at(blob(sphere(0.5, 30), main), 0, 0, 0, [0.82, 0.72, 0.74]));
      for (const x of [-1, 1]) {
        head.add(at(blob(sphere(0.5, 14), light), x * 0.3, -0.12, 0.08, [0.3, 0.26, 0.3])); // cheek fluff
        const ear = at(blob(cone(0.15, 0.32, 16), dark), x * 0.25, 0.36, -0.02);
        ear.rotation.z = -x * 0.28;
        ear.add(at(blob(cone(0.09, 0.22, 12), soft("#ff9db5"), false), 0, -0.02, 0.05));
        head.add(ear);
        head.add(at(brow(0.16, x), x * 0.17, 0.165, 0.335));
      }
      head.add(at(blob(sphere(0.5, 16), light), 0, -0.13, 0.3, [0.34, 0.24, 0.3])); // muzzle
      head.add(at(blob(sphere(0.5, 10), flat("#3a2a3f")), 0, -0.07, 0.44, [0.1, 0.075, 0.07])); // nose
      head.add(at(smile(0.05), 0, -0.17, 0.44));
      addEyes(head, 0.17, 0.17, 0.03, 0.31, "#e0483c");
      addBlush(head, 0.11, 0.3, -0.07, 0.25);
      const tail = new THREE.Group();
      tail.position.set(0, 0.5, -0.58);
      const fluff = at(blob(sphere(0.5, 16), main), 0, 0.14, -0.14, [0.26, 0.3, 0.42]);
      fluff.rotation.x = -0.6;
      tail.add(fluff, at(blob(sphere(0.5, 12), light), 0, 0.27, -0.27, 0.18));
      g.add(tail);
      for (const [x, z] of [
        [-0.2, 0.12],
        [0.2, 0.12],
        [-0.2, -0.5],
        [0.2, -0.5],
      ]) {
        const leg = new THREE.Group();
        leg.position.set(x, 0.3, z);
        leg.add(at(blob(caps(0.1, 0.14), dark), 0, -0.14, 0));
        leg.add(at(blob(sphere(0.5, 12), light), 0, -0.25, 0.03, [0.24, 0.14, 0.28]));
        legs.push(leg);
        g.add(leg);
      }
      extras.push((t, pose) => {
        tail.rotation.y = Math.sin(t / (pose === "windup" ? 60 : 170)) * 0.35;
        head.rotation.z = Math.sin(t / 1300) * 0.04;
      });
      face = new THREE.Vector3(0, 0.83, 0.62);
      top = new THREE.Vector3(0, 1.16, 0.3);
      back = new THREE.Vector3(0, 0.7, -0.2);
      sides = 0.31;
      break;
    }
    case "mire_bat": {
      // a round little bat with big ears and two tiny fangs
      u = H * 1.3;
      g.add(at(blob(sphere(0.5, 28), main), 0, 0.5, 0, [0.72, 0.74, 0.66]));
      g.add(at(blob(sphere(0.5, 16), light), 0, 0.42, 0.17, [0.42, 0.4, 0.34]));
      for (const x of [-1, 1]) {
        const ear = at(blob(cone(0.15, 0.34, 16), main), x * 0.22, 0.92, -0.02);
        ear.rotation.z = -x * 0.35;
        ear.add(at(blob(cone(0.09, 0.24, 12), soft("#ff9db5"), false), 0, -0.02, 0.05));
        g.add(ear);
        g.add(at(blob(cone(0.03, 0.09, 10), flat("#ffffff"), false), x * 0.06, 0.36, 0.3).rotateX(Math.PI));
        g.add(at(blob(sphere(0.5, 10), dark), x * 0.11, 0.13, 0.04, 0.14));
      }
      const wingMat = own(lighten(color, -0.3), { double: true });
      const wing = (x: number) => {
        const p = new THREE.Group();
        p.position.set(x * 0.3, 0.56, -0.06);
        const geo = cached("softwing", () => {
          const s = new THREE.Shape();
          s.moveTo(0, 0.08);
          s.quadraticCurveTo(0.5, 0.58, 0.95, 0.42);
          s.quadraticCurveTo(0.9, 0.18, 0.76, 0);
          s.quadraticCurveTo(0.64, 0.14, 0.52, -0.08);
          s.quadraticCurveTo(0.38, 0.06, 0.26, -0.15);
          s.quadraticCurveTo(0.14, 0, 0, -0.2);
          s.closePath();
          return new THREE.ShapeGeometry(s, 10);
        });
        const m = blob(geo, wingMat);
        m.scale.set(x * 0.95, 1, 1);
        p.add(m);
        g.add(p);
        return p;
      };
      wingL = wing(1);
      wingR = wing(-1);
      addEyes(g, 0.19, 0.15, 0.55, 0.295, "#e0a52b");
      addBlush(g, 0.11, 0.275, 0.44, 0.205, 0.9);
      g.add(at(smile(0.045), 0, 0.43, 0.338));
      face = new THREE.Vector3(0, 0.55, 0.3);
      top = new THREE.Vector3(0, 0.88, 0);
      sides = 0.3;
      break;
    }
    case "moss_golem": {
      // a round stone giant with a big head, heavy fists and glowing eyes
      u = W * 0.76;
      g.add(at(blob(sphere(0.5, 28), main), 0, 0.4, 0, [0.8, 0.7, 0.7]));
      g.add(at(blob(sphere(0.5, 12), light, false), -0.2, 0.5, 0.29, [0.22, 0.16, 0.1]));
      g.add(at(blob(sphere(0.5, 12), light, false), 0.21, 0.31, 0.27, [0.16, 0.12, 0.08]));
      g.add(at(blob(sphere(0.5, 30), main), 0, 0.88, 0.04, [0.74, 0.6, 0.66]));
      for (const x of [-1, 1]) {
        const arm = new THREE.Group();
        arm.position.set(x * 0.48, 0.62, 0);
        arm.add(at(blob(sphere(0.5, 16), main), 0, -0.2, 0, [0.28, 0.46, 0.3]));
        arm.add(at(blob(sphere(0.5, 16), dark), 0, -0.44, 0.02, 0.3));
        legs.push(arm);
        g.add(arm);
        g.add(at(blob(sphere(0.5, 14), dark), x * 0.2, 0.1, 0.03, [0.34, 0.22, 0.4]));
        // glowing eyes
        const e = new THREE.Group();
        e.position.set(x * 0.15, 0.9, 0.345);
        e.rotation.y = x * 0.3;
        e.add(at(blob(sphere(0.5, 16), flat("#d6ff7a", 1, 1.25), false), 0, 0, 0, [0.12, 0.15, 0.05]));
        e.add(at(blob(sphere(0.5, 8), flat("#ffffff"), false), -0.02, 0.035, 0.02, [0.04, 0.045, 0.02]));
        eyes.push(e);
        g.add(e);
      }
      addBlush(g, 0.1, 0.26, 0.82, 0.27, 0.8);
      g.add(at(smile(0.05), 0, 0.78, 0.352));
      face = new THREE.Vector3(0, 0.9, 0.36);
      top = new THREE.Vector3(0, 1.17, 0.04);
      back = new THREE.Vector3(0, 0.8, -0.3);
      sides = 0.45;
      break;
    }
    case "mirefang": {
      // a great swamp bulb on a thick stalk, with a fanged jaw and golden eyes
      u = H;
      g.add(at(blob(cyl(0.15, 0.225, 0.4, 20), dark), 0, 0.2, 0));
      g.add(at(blob(sphere(0.5, 36), main), 0, 0.58, 0, [0.8, 0.6, 0.74]));
      for (const [x, y, z, s] of [
        [-0.17, 0.83, 0.02, 0.15],
        [0.19, 0.8, -0.1, 0.12],
        [0.02, 0.85, -0.17, 0.1],
        [-0.3, 0.68, -0.12, 0.1],
      ])
        g.add(at(blob(sphere(0.5, 10), light, false), x, y, z, [s, s * 0.5, s]));
      const tooth = soft("#fff6e0", 0.35);
      jaw = new THREE.Group();
      jaw.position.set(0, 0.5, 0.17);
      jaw.add(at(blob(sphere(0.5, 22), dark), 0, -0.05, 0.11, [0.56, 0.22, 0.47]));
      for (let i = -2; i <= 2; i++) jaw.add(at(blob(cone(0.034, 0.09, 12), tooth), i * 0.085, 0.06, 0.3 - Math.abs(i) * 0.02));
      g.add(jaw);
      for (let i = -2; i <= 2; i++) g.add(at(blob(cone(0.034, 0.09, 12), tooth), i * 0.085, 0.5, 0.35 - Math.abs(i) * 0.02).rotateX(Math.PI));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const leaf = at(blob(sphere(0.5, 12), own("#5c9a56")), Math.sin(a) * 0.36, 0.06, Math.cos(a) * 0.36, [0.26, 0.06, 0.47]);
        leaf.rotation.y = a;
        g.add(leaf);
      }
      addEyes(g, 0.17, 0.17, 0.72, 0.29, "#ffb000", -0.35);
      for (const x of [-1, 1]) g.add(at(brow(0.17, x), x * 0.17, 0.835, 0.25));
      addBlush(g, 0.1, 0.31, 0.63, 0.2, 0.9);
      face = new THREE.Vector3(0, 0.72, 0.3);
      top = new THREE.Vector3(0, 0.875, 0);
      break;
    }
    default:
      g.add(at(blob(sphere(0.5, 20), main), 0, 0.5 * (H / W), 0, [1, H / W, 1]));
      addEyes(g, 0.18, 0.18, 0.5 * (H / W), 0.44, "#a8572f");
  }
  g.scale.setScalar(u);
  // feature spots, now in scene units
  top.multiplyScalar(u);
  back.multiplyScalar(u);
  face.multiplyScalar(u);
  sides *= u;

  // a toad parent gives a mixed pet its eye bumps
  if (bodyId !== "bog_toad" && others.includes("bog_toad")) {
    const r = W * 0.12;
    for (const x of [-1, 1]) {
      const bump = new THREE.Group();
      bump.position.set(x * W * 0.24, top.y - r * 0.4, face.z * 0.45);
      bump.add(blob(sphere(r, 14), soft(SPECIES_COLOR.bog_toad)));
      const e = softEye(r * 1.2, x, "#c98a2b");
      e.position.set(0, r * 0.1, r * 0.75);
      bump.add(e);
      rig.add(bump);
    }
  }

  // blinking; eyes narrow before a strike and close when it falls
  extras.push((t, pose) => {
    const sy = pose === "dead" || t % 3400 < 130 ? 0.12 : pose === "windup" ? 0.7 : 1;
    for (const e of eyes) e.scale.y = sy;
  });

  // the other parents' features
  const feats = new Set<Feature>([...(bodyId === "mirefang" ? (["crown"] as Feature[]) : []), ...others.map((o) => FEATURE_OF[o])]);
  if (bodyId === "horned_rabbit") feats.add("horn");
  if (bodyId === "thorn_wolf") feats.add("thorns");
  if (bodyId === "moss_golem") feats.add("moss");
  for (const f of feats) {
    if (f === "horn") {
      const horn = softHorn(Math.max(H * 0.42, u * 0.34));
      horn.position.copy(top);
      horn.rotation.x = 0.55;
      rig.add(horn);
    }
    if (f === "thorns") {
      for (let i = 0; i < 4; i++) rig.add(at(blob(cone(W * 0.055, H * 0.3, 12), soft("#6fbf5f")), back.x, back.y + H * 0.1, back.z + (i - 1.5) * W * 0.15).rotateX(-0.25));
    }
    if (f === "moss") {
      for (const [x, z, s] of [
        [-0.16, 0.08, 0.3],
        [0.15, -0.1, 0.36],
        [0.02, 0.13, 0.24],
      ])
        rig.add(at(blob(sphere(0.5, 14), soft("#6fc068")), top.x + x * W, top.y - H * 0.03, top.z + z * W, [W * s, H * 0.14, W * s]));
      // a little sprout
      rig.add(at(blob(sphere(0.5, 10), soft("#8fe07a")), top.x + W * 0.05, top.y + H * 0.1, top.z - W * 0.02, [W * 0.1, H * 0.12, W * 0.05]).rotateZ(0.5));
    }
    if (f === "crown") {
      const c = new THREE.Group();
      c.position.set(top.x, top.y + H * 0.02, top.z);
      const k = Math.max(W, 0.6);
      const gold = soft("#f5c542", 0.45);
      c.add(at(blob(cyl(k * 0.25, k * 0.22, k * 0.1, 20), gold), 0, 0, 0));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        c.add(at(blob(cone(k * 0.06, k * 0.16, 12), gold), Math.sin(a) * k * 0.22, k * 0.1, Math.cos(a) * k * 0.22));
        c.add(at(blob(sphere(k * 0.035, 10), gold), Math.sin(a) * k * 0.22, k * 0.185, Math.cos(a) * k * 0.22));
      }
      c.add(at(blob(sphere(k * 0.05, 12), soft("#e2607f", 0.6)), 0, k * 0.04, k * 0.24));
      rig.add(c);
    }
    if (f === "wings" && bodyId !== "mire_bat") {
      for (const x of [-1, 1]) {
        const p = new THREE.Group();
        p.position.set(x * sides * 0.7, back.y, back.z);
        p.add(at(blob(sphere(0.5, 12), own(SPECIES_COLOR.mire_bat)), x * W * 0.25, 0, 0, [W * 0.5, H * 0.08, W * 0.3]));
        rig.add(p);
        if (x === 1) wingL = p;
        else wingR = p;
      }
    }
    if (f === "shine" && bodyId !== "green_slime") rig.add(at(blob(sphere(0.5, 12), flat("#bff5c4", 0.55), false), 0, top.y, top.z, [W * 0.5, H * 0.2, W * 0.5]));
  }

  const st = { lastT: -1, pose: "", since: 0, y: 0, sx: 1, sy: 1, rx: 0, z: 0, jaw: 0, leg: 0 };
  const model: MonsterModel = {
    root,
    mats,
    height: H,
    animate(pose, t, walkT) {
      // Smooth motion: work out where every part wants to be, then ease toward it,
      // so moves blend instead of snapping. Hops stretch going up and squash on landing.
      const dt = st.lastT < 0 ? 0 : Math.min(0.1, Math.max(0, (t - st.lastT) / 1000));
      st.lastT = t;
      if (pose !== st.pose) {
        st.pose = pose;
        st.since = t;
      }
      const age = t - st.since; // ms in this pose
      const hopper = bodyId === "green_slime" || bodyId === "bog_toad" || bodyId === "horned_rabbit";
      const T = { y: 0, sx: 1, sy: 1, rx: 0, z: 0, jaw: 0, leg: 0 };
      const breathe = Math.sin(t / 420);
      const flap = Math.sin(t / 70);
      if (wingL && wingR) {
        const f = pose === "windup" ? Math.sin(t / 40) : flap;
        wingL.rotation.z = f * 0.7;
        wingR.rotation.z = -f * 0.7;
      }
      if (pose === "dead") {
        // a squish, then flat
        const p = Math.min(1, age / 380);
        const k = 1 - Math.pow(1 - p, 3);
        T.sy = 1 - 0.75 * k;
        T.sx = 1 + 0.2 * k;
        T.rx = bodyId === "mire_bat" ? 0 : -0.15 * k;
      } else if (pose === "rest") {
        T.sy = 1 + breathe * 0.035;
        T.sx = 1 - breathe * 0.018;
      } else if (pose === "walk") {
        if (hopper) {
          // one hop: crouch, stretch up, land with a squash
          const ph = (walkT / 520) % 1;
          if (ph < 0.15) {
            const c = Math.sin((ph / 0.15) * Math.PI);
            T.sy = 1 - c * 0.14;
            T.sx = 1 + c * 0.08;
          } else if (ph < 0.85) {
            const a = (ph - 0.15) / 0.7;
            T.y = 4 * a * (1 - a) * H * 0.4;
            const up = a < 0.5 ? 1 - a * 2 : 0;
            T.sy = 1 + up * 0.14;
            T.sx = 1 - up * 0.07;
            T.rx = (a - 0.5) * 0.3;
          } else {
            const c = Math.sin(((ph - 0.85) / 0.15) * Math.PI);
            T.sy = 1 - c * 0.18;
            T.sx = 1 + c * 0.1;
          }
        } else {
          const s = Math.sin(walkT / 90);
          T.leg = s * 0.7;
          T.y = Math.abs(Math.cos(walkT / 90)) * H * 0.05;
          T.sy = 1 + Math.abs(s) * 0.03;
          T.rx = 0.06;
        }
      } else if (pose === "windup") {
        // gathers itself: squashes down, leans back, mouth opens; a shiver as it peaks
        const p = Math.min(1, age / 450);
        const k = 1 - Math.pow(1 - p, 2);
        const shiver = p > 0.6 ? Math.sin(t / 22) * 0.02 : 0;
        T.sy = 1 - 0.18 * k;
        T.sx = 1 + 0.12 * k + shiver;
        T.rx = -0.22 * k;
        T.z = -0.06 * k;
        T.jaw = -0.45 * k;
      } else if (pose === "attack") {
        // a fast lunge, then settle back
        const p = Math.min(1, age / 240);
        const out = p < 0.3 ? p / 0.3 : 1 - (p - 0.3) / 0.7;
        const e = Math.sin((out * Math.PI) / 2);
        T.z = (0.2 + W * 0.15) * e;
        T.sy = 1 + 0.12 * e;
        T.sx = 1 - 0.06 * e;
        T.rx = 0.28 * e;
        T.jaw = 0.35 * e;
      }
      // ease toward the target: quick for strikes, softer for the rest
      const speed = pose === "attack" || pose === "dead" ? 40 : pose === "windup" ? 20 : 14;
      const a = dt === 0 ? 1 : 1 - Math.exp(-speed * dt);
      st.y += (T.y - st.y) * (pose === "walk" ? 1 : a);
      st.sx += (T.sx - st.sx) * a;
      st.sy += (T.sy - st.sy) * a;
      st.rx += (T.rx - st.rx) * a;
      st.z += (T.z - st.z) * a;
      st.jaw += (T.jaw - st.jaw) * a;
      st.leg += (T.leg - st.leg) * (pose === "walk" ? 1 : a);
      rig.position.set(0, st.y, st.z);
      rig.rotation.set(st.rx, 0, 0);
      rig.scale.set(st.sx, st.sy, st.sx);
      if (jaw) jaw.rotation.x = st.jaw;
      legs.forEach((l, i) => (l.rotation.x = st.leg * (i % 2 ? 1 : -1)));
      for (const x of extras) x(t, pose);
    },
  };
  return model;
}

// ---------- the world: trees, rocks, houses... ----------

export function makeTree(s = 1, pine = false): THREE.Group {
  const g = new THREE.Group();
  if (pine) {
    g.add(at(piece(cyl(0.1 * s, 0.14 * s, 0.6 * s, 8), toon("#8a5a34")), 0, 0.3 * s, 0));
    const greens = ["#3f9a5a", "#4bb06a", "#5cc27a"];
    for (let i = 0; i < 3; i++) g.add(at(piece(cone((0.9 - i * 0.22) * s, (0.9 - i * 0.1) * s, 9), toon(greens[i])), 0, (0.8 + i * 0.5) * s, 0));
    return g;
  }
  g.add(at(piece(cyl(0.12 * s, 0.18 * s, 0.9 * s, 8), toon("#9a6a3c")), 0, 0.45 * s, 0));
  const greens = ["#6fcf5a", "#86dc6a", "#5bbf52"];
  const blobs: [number, number, number, number][] = [
    [0, 1.45, 0, 0.75],
    [0.45, 1.15, 0.1, 0.5],
    [-0.4, 1.2, -0.1, 0.55],
    [0.05, 1.2, 0.42, 0.5],
    [0.1, 1.85, -0.05, 0.45],
  ];
  blobs.forEach(([x, y, z, r], i) => g.add(at(piece(ico(r * s, 1), toon(greens[i % 3])), x * s, y * s, z * s)));
  return g;
}

export function makeBush(s = 1) {
  const g = new THREE.Group();
  g.add(at(piece(ico(0.38 * s, 1), toon("#5fbf55")), 0, 0.25 * s, 0, [1.2, 0.8, 1]));
  g.add(at(piece(ico(0.28 * s, 1), toon("#79d064")), 0.28 * s, 0.22 * s, 0.05 * s));
  g.add(at(piece(ico(0.06 * s, 0), toon("#ff8fb0")), 0.1 * s, 0.5 * s, 0.25 * s));
  return g;
}

export function makeRock(s = 1, cave = false) {
  const g = new THREE.Group();
  g.add(at(piece(dodeca(0.55 * s), toon(cave ? "#6f6a80" : "#a9a6b5")), 0, 0.3 * s, 0, [1, 0.7, 0.9]));
  g.add(at(piece(dodeca(0.3 * s), toon(cave ? "#5d5870" : "#c2bfcc")), 0.35 * s, 0.18 * s, 0.2 * s, [1, 0.8, 1]));
  return g;
}

const FLOWER_COLORS = ["#ff8fb0", "#ffe066", "#ffffff", "#b49cff", "#ff9f5a", "#7fd4ff"];
export function makeFlower(s = 1, seed = 0) {
  const g = new THREE.Group();
  g.add(at(piece(cyl(0.012, 0.012, 0.2 * s, 4), toon("#4f9d55"), { outline: false, shadow: false }), 0, 0.1 * s, 0));
  const c = FLOWER_COLORS[Math.abs(Math.floor(seed * 997)) % FLOWER_COLORS.length];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.add(at(piece(sphere(0.045 * s, 6), toon(c), { outline: false, shadow: false }), Math.cos(a) * 0.05 * s, 0.22 * s, Math.sin(a) * 0.05 * s));
  }
  g.add(at(piece(sphere(0.035 * s, 6), toon("#ffd34d"), { outline: false, shadow: false }), 0, 0.23 * s, 0));
  return g;
}

export function makeMushroom(s = 1, red = true) {
  const g = new THREE.Group();
  g.add(at(piece(cyl(0.06 * s, 0.08 * s, 0.2 * s, 8), toon("#f4ead2")), 0, 0.1 * s, 0));
  g.add(at(piece(new THREE.SphereGeometry(0.2 * s, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(red ? "#e0533d" : "#b07a4a")), 0, 0.18 * s, 0));
  if (red) for (const [x, z] of [[0.08, 0.05], [-0.07, 0.08], [0, -0.1]]) g.add(at(piece(sphere(0.03 * s, 6), toon("#ffffff"), { outline: false }), x * s, 0.33 * s, z * s));
  return g;
}

export function makeFence() {
  const g = new THREE.Group();
  const w = toon("#c99a6a");
  for (const x of [-0.5, 0, 0.5]) g.add(at(piece(box(0.08, 0.5, 0.08), w), x, 0.25, 0));
  g.add(at(piece(box(1.1, 0.07, 0.05), w), 0, 0.36, 0));
  g.add(at(piece(box(1.1, 0.07, 0.05), w), 0, 0.18, 0));
  return g;
}

export function makeTorch() {
  const g = new THREE.Group();
  g.add(at(piece(cyl(0.04, 0.05, 0.9, 6), toon("#6b4a2a")), 0, 0.45, 0));
  g.add(at(piece(ico(0.1, 1), toon("#ffb347", { emissive: "#ff9a1a", emissiveIntensity: 1.6 }), { outline: false, shadow: false }), 0, 0.98, 0, [1, 1.4, 1]));
  return g;
}

export function makeLamp() {
  const g = new THREE.Group();
  g.add(at(piece(cyl(0.04, 0.05, 1.5, 6), toon("#4a4a5a")), 0, 0.75, 0));
  g.add(at(piece(box(0.2, 0.24, 0.2), toon("#fff3b0", { emissive: "#ffe08a", emissiveIntensity: 0.9 })), 0, 1.55, 0));
  g.add(at(piece(cone(0.17, 0.12, 4), toon("#4a4a5a")), 0, 1.73, 0).rotateY(Math.PI / 4));
  return g;
}

export function makeCrystal(s = 1) {
  const g = new THREE.Group();
  const m = toon("#9fd4ff", { emissive: "#6fb8ff", emissiveIntensity: 0.7 });
  g.add(at(piece(cone(0.16 * s, 0.8 * s, 6), m), 0, 0.4 * s, 0));
  g.add(at(piece(cone(0.1 * s, 0.5 * s, 6), m), 0.18 * s, 0.25 * s, 0.05 * s).rotateZ(-0.4));
  g.add(at(piece(cone(0.1 * s, 0.45 * s, 6), m), -0.15 * s, 0.22 * s, -0.05 * s).rotateZ(0.45));
  return g;
}

export function makeWell() {
  const g = new THREE.Group();
  g.add(at(piece(cyl(0.7, 0.75, 0.55, 16), toon("#b9b4c4")), 0, 0.27, 0));
  g.add(at(piece(cyl(0.55, 0.55, 0.05, 16), toon("#5fb3ff", { emissive: "#3f8fd9", emissiveIntensity: 0.3 }), { outline: false }), 0, 0.5, 0));
  for (const x of [-0.6, 0.6]) g.add(at(piece(box(0.1, 1.2, 0.1), toon("#9a6a3c")), x, 0.9, 0));
  g.add(at(piece(cone(0.95, 0.5, 4), toon("#d0574a")), 0, 1.7, 0).rotateY(Math.PI / 4));
  return g;
}

export function makeReed(s = 1) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) g.add(at(piece(cyl(0.015, 0.02, 0.6 * s, 4), toon("#6b8f4a"), { outline: false }), (i - 1) * 0.06, 0.3 * s, (i % 2) * 0.05).rotateZ((i - 1) * 0.15));
  g.add(at(piece(capsule(0.03, 0.12 * s), toon("#7a4a2a"), { outline: false }), 0, 0.6 * s, 0));
  return g;
}

/** A building: walls, a roof, a door on the south side, windows. */
export function makeBuilding(kind: "inn" | "shop" | "house", w: number, d: number, h: number, doorX: number) {
  const g = new THREE.Group();
  const wall = kind === "inn" ? "#fff1d6" : kind === "shop" ? "#f3f0ff" : "#f6e2c3";
  const roof = kind === "inn" ? "#e0533d" : kind === "shop" ? "#3f8fd9" : ["#5fae5a", "#f08a3c"][Math.floor(doorX) % 2];
  const wh = h * 0.62;
  g.add(at(piece(box(w, wh, d), toon(wall)), w / 2, wh / 2, d / 2));
  // timber trim
  g.add(at(piece(box(w + 0.06, 0.12, d + 0.06), toon("#9a6a3c"), { outline: false }), w / 2, wh, d / 2));
  for (const x of [0.03, w - 0.03]) for (const z of [0.03, d - 0.03]) g.add(at(piece(box(0.14, wh, 0.14), toon("#9a6a3c"), { outline: false }), x, wh / 2, z));
  // roof: a long prism
  const roofGeo = new THREE.CylinderGeometry(0.01, 1, 1, 4, 1);
  roofGeo.rotateY(Math.PI / 4);
  const r = piece(roofGeo, toon(roof));
  r.scale.set((w + 0.6) * 0.71, h * 0.5, (d + 0.6) * 0.71);
  r.position.set(w / 2, wh + h * 0.25, d / 2);
  g.add(r);
  // chimney
  g.add(at(piece(box(0.4, 0.8, 0.4), toon("#b9b4c4")), w * 0.75, wh + h * 0.35, d * 0.35));
  // door
  const dx = doorX;
  g.add(at(piece(box(0.8, 1.25, 0.1), toon("#8a5a34")), dx, 0.62, d + 0.03));
  g.add(at(piece(sphere(0.05, 6), toon("#f5c542"), { outline: false }), dx + 0.25, 0.62, d + 0.1));
  // windows
  const glass = toon("#bfe6ff", { emissive: "#9fd4ff", emissiveIntensity: 0.25 });
  for (const x of [w * 0.22, w * 0.78]) if (Math.abs(x - dx) > 0.9) g.add(at(piece(box(0.6, 0.55, 0.06), glass), x, wh * 0.58, d + 0.03));
  for (const z of [d * 0.35, d * 0.7]) {
    g.add(at(piece(box(0.06, 0.5, 0.55), glass), -0.03, wh * 0.58, z));
    g.add(at(piece(box(0.06, 0.5, 0.55), glass), w + 0.03, wh * 0.58, z));
  }
  // the sign board over the door
  if (kind !== "house") {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 96;
    const x = c.getContext("2d")!;
    x.fillStyle = "#fdf6e3";
    x.fillRect(0, 0, 256, 96);
    x.strokeStyle = "#2f2a3b";
    x.lineWidth = 10;
    x.strokeRect(5, 5, 246, 86);
    x.fillStyle = "#2f2a3b";
    x.font = "900 54px ui-rounded, system-ui, sans-serif";
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillText(kind === "inn" ? "INN" : "WEAPONS", 128, 52);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.6), new THREE.MeshBasicMaterial({ map: tex }));
    board.position.set(dx, 1.62, d + 0.09);
    g.add(board);
  }
  return g;
}

/** A wooden sign post with a little board. */
export function makeSignPost() {
  const g = new THREE.Group();
  g.add(at(piece(box(0.1, 1, 0.1), toon("#9a6a3c")), 0, 0.5, 0));
  g.add(at(piece(box(0.8, 0.4, 0.08), toon("#c99a6a")), 0, 0.95, 0));
  for (const y of [0.88, 1.0]) g.add(at(piece(box(0.55, 0.04, 0.02), toon("#7a5a3a"), { outline: false }), 0, y, 0.05));
  return g;
}
