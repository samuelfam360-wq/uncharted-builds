// 3D models for the game, built in code from simple rounded shapes:
// soft toon shading with a dark outline, bright colours, chibi proportions.
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
      body.position.set(0, 0, 0);
      body.rotation.set(0, 0, 0);
      head.rotation.set(0, 0, 0);
      legL.rotation.set(0, 0, 0);
      legR.rotation.set(0, 0, 0);
      armL.rotation.set(0, 0, 0.12);
      armR.rotation.set(0, 0, -0.12);
      const style = model.weapon ? WEAPON_LOOK[model.weapon] : "punch";
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
          armL.rotation.x = model.weapon === "bow" ? -1.5 : 0;
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
    },
  };
  return model;
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
  mats: THREE.MeshToonMaterial[];
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

/**
 * Build a monster (or a pet: a bred pet is its biggest parent's body,
 * coloured between its parents, wearing the others' features).
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
  const mats: THREE.MeshToonMaterial[] = [];
  const own = (hex: string, o?: { transparent?: boolean; opacity?: number }) => {
    const m = ownToon(hex, o);
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
  const main = own(color);
  const dark = own(lighten(color, -0.3));
  const light = own(lighten(color, 0.35));

  // where features go on this body: top of the head, the back, the sides
  let top = new THREE.Vector3(0, H, 0);
  let back = new THREE.Vector3(0, H * 0.8, -W * 0.15);
  let sides = W * 0.5;
  let face = new THREE.Vector3(0, H * 0.6, W * 0.45);

  switch (bodyId) {
    case "green_slime": {
      rig.add(at(piece(sphere(0.5, 24), own(color, { transparent: true, opacity: 0.88 })), 0, H * 0.5, 0, [W, H * 1.35, W * 0.95]));
      rig.add(at(piece(sphere(0.5, 12), toon("#ffffff", { opacity: 0.7 }), { outline: false, shadow: false }), -W * 0.18, H * 0.85, W * 0.2, [W * 0.22, H * 0.25, W * 0.12]));
      face = new THREE.Vector3(0, H * 0.55, W * 0.44);
      top = new THREE.Vector3(0, H * 1.1, 0);
      break;
    }
    case "horned_rabbit": {
      rig.add(at(piece(sphere(0.5, 22), main), 0, H * 0.45, -W * 0.05, [W * 0.9, H * 0.85, W * 1.1]));
      rig.add(at(piece(sphere(0.5, 20), main), 0, H * 0.78, W * 0.32, [W * 0.62, H * 0.62, W * 0.6]));
      rig.add(at(piece(sphere(0.5, 12), light), 0, H * 0.4, W * 0.3, [W * 0.5, H * 0.4, W * 0.3]));
      for (const x of [-1, 1]) {
        const ear = at(piece(capsule(W * 0.08, H * 0.55), main), x * W * 0.14, H * 1.25, W * 0.2);
        ear.rotation.z = -x * 0.25;
        ear.rotation.x = -0.25;
        ear.add(at(piece(capsule(W * 0.045, H * 0.4), toon("#ffb3c1"), { outline: false }), 0, 0, W * 0.05));
        rig.add(ear);
      }
      rig.add(at(piece(sphere(0.5, 10), toon("#ffffff")), 0, H * 0.5, -W * 0.6, W * 0.3));
      for (const [x, z] of [
        [-0.25, 0.25],
        [0.25, 0.25],
        [-0.25, -0.35],
        [0.25, -0.35],
      ]) {
        const leg = at(piece(sphere(0.5, 10), dark), x * W, H * 0.08, z * W, [W * 0.22, H * 0.2, W * 0.32]);
        legs.push(leg);
        rig.add(leg);
      }
      face = new THREE.Vector3(0, H * 0.82, W * 0.6);
      top = new THREE.Vector3(0, H * 1.08, W * 0.45);
      break;
    }
    case "bog_toad": {
      rig.add(at(piece(sphere(0.5, 22), main), 0, H * 0.45, 0, [W * 1.05, H * 0.85, W * 0.95]));
      rig.add(at(piece(sphere(0.5, 14), toon("#d9d2a0")), 0, H * 0.32, W * 0.18, [W * 0.75, H * 0.55, W * 0.6]));
      // the wide mouth
      jaw = at(piece(torus(W * 0.3, W * 0.03, Math.PI), toon("#3a2a2a"), { outline: false }), 0, H * 0.52, W * 0.42);
      jaw.rotation.z = Math.PI;
      rig.add(jaw);
      // spots
      for (const [x, y, z] of [
        [-0.3, 0.75, -0.1],
        [0.28, 0.7, 0.05],
        [0.05, 0.85, -0.25],
      ])
        rig.add(at(piece(sphere(0.5, 8), dark, { outline: false }), x * W, y * H, z * W, W * 0.14));
      for (const x of [-1, 1]) {
        const leg = at(piece(sphere(0.5, 10), dark), x * W * 0.45, H * 0.1, W * 0.1, [W * 0.3, H * 0.2, W * 0.45]);
        legs.push(leg);
        rig.add(leg);
      }
      face = new THREE.Vector3(0, H * 0.9, W * 0.25);
      top = new THREE.Vector3(0, H * 0.95, -W * 0.05);
      break;
    }
    case "thorn_wolf": {
      rig.add(at(piece(capsule(H * 0.3, W * 0.55), main), 0, H * 0.62, -W * 0.05, [1, 1, 1]).rotateX(Math.PI / 2));
      const head = new THREE.Group();
      head.position.set(0, H * 0.85, W * 0.42);
      rig.add(head);
      head.add(at(piece(sphere(0.5, 18), main), 0, 0, 0, [H * 0.62, H * 0.56, H * 0.6]));
      head.add(at(piece(sphere(0.5, 12), light), 0, -H * 0.08, H * 0.32, [H * 0.36, H * 0.26, H * 0.36]));
      head.add(at(piece(sphere(0.5, 8), toon("#2a2238")), 0, -H * 0.02, H * 0.5, H * 0.1));
      for (const x of [-1, 1]) head.add(at(piece(cone(H * 0.11, H * 0.3, 6), dark), x * H * 0.17, H * 0.3, -H * 0.04).rotateZ(-x * 0.2));
      // red eyes
      for (const x of [-1, 1]) head.add(at(piece(sphere(0.5, 8), toon("#e03c3c", { emissive: "#ff3030", emissiveIntensity: 0.5 }), { outline: false }), x * H * 0.15, H * 0.06, H * 0.26, [H * 0.1, H * 0.12, H * 0.05]));
      rig.add(at(piece(cone(H * 0.12, W * 0.38, 8), dark), 0, H * 0.75, -W * 0.55).rotateX(-1.1));
      for (const [x, z] of [
        [-0.17, 0.25],
        [0.17, 0.25],
        [-0.17, -0.3],
        [0.17, -0.3],
      ]) {
        const leg = new THREE.Group();
        leg.position.set(x * W, H * 0.45, z * W);
        leg.add(at(piece(capsule(H * 0.09, H * 0.32), dark), 0, -H * 0.23, 0));
        legs.push(leg);
        rig.add(leg);
      }
      face = new THREE.Vector3(0, H * 0.95, W * 0.62);
      top = new THREE.Vector3(0, H * 1.25, W * 0.42);
      back = new THREE.Vector3(0, H * 0.92, -W * 0.05);
      break;
    }
    case "mire_bat": {
      rig.add(at(piece(sphere(0.5, 20), main), 0, H * 0.6, 0, [W * 0.55, H * 0.85, W * 0.5]));
      for (const x of [-1, 1]) rig.add(at(piece(cone(W * 0.08, H * 0.4, 6), dark), x * W * 0.14, H * 1.08, 0).rotateZ(-x * 0.2));
      const wing = (x: number) => {
        const g = new THREE.Group();
        g.position.set(x * W * 0.2, H * 0.65, 0);
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.lineTo(0.9, 0.35);
        shape.lineTo(0.75, -0.05);
        shape.lineTo(0.55, 0.05);
        shape.lineTo(0.35, -0.12);
        shape.lineTo(0, -0.15);
        const geo = cached("batwing", () => new THREE.ShapeGeometry(shape));
        const m = piece(geo, own(lighten(color, -0.35)), { outline: false });
        (m.material as THREE.MeshToonMaterial).side = THREE.DoubleSide;
        m.scale.set(x * W * 0.9, H * 1.1, 1);
        g.add(m);
        rig.add(g);
        return g;
      };
      wingL = wing(1);
      wingR = wing(-1);
      // fangs
      for (const x of [-1, 1]) rig.add(at(piece(cone(W * 0.03, H * 0.12, 4), toon("#ffffff"), { outline: false }), x * W * 0.06, H * 0.38, W * 0.24).rotateX(Math.PI));
      face = new THREE.Vector3(0, H * 0.72, W * 0.24);
      top = new THREE.Vector3(0, H * 1.1, 0);
      sides = W * 0.3;
      break;
    }
    case "moss_golem": {
      rig.add(at(piece(box(W * 0.82, H * 0.62, W * 0.7), main), 0, H * 0.52, 0));
      rig.add(at(piece(box(W * 0.55, H * 0.32, W * 0.5), main), 0, H * 0.98, W * 0.04));
      for (const x of [-1, 1]) {
        const arm = new THREE.Group();
        arm.position.set(x * W * 0.52, H * 0.7, 0);
        arm.add(at(piece(box(W * 0.24, H * 0.5, W * 0.26), dark), 0, -H * 0.18, 0));
        legs.push(arm);
        rig.add(arm);
        rig.add(at(piece(box(W * 0.26, H * 0.24, W * 0.3), dark), x * W * 0.22, H * 0.12, 0));
      }
      // glowing eyes
      for (const x of [-1, 1]) rig.add(at(piece(sphere(0.5, 8), toon("#d6ff7a", { emissive: "#b8ff3a", emissiveIntensity: 1 }), { outline: false }), x * W * 0.12, H * 1.0, W * 0.3, [W * 0.1, H * 0.06, W * 0.04]));
      face = new THREE.Vector3(0, H * 1.0, W * 0.3);
      top = new THREE.Vector3(0, H * 1.15, 0);
      back = new THREE.Vector3(0, H * 0.84, -W * 0.1);
      break;
    }
    case "mirefang": {
      // a great swamp bulb on a thick stalk, with a fanged jaw
      rig.add(at(piece(cyl(W * 0.16, W * 0.24, H * 0.4, 14), dark), 0, H * 0.2, 0));
      rig.add(at(piece(sphere(0.5, 24), main), 0, H * 0.55, 0, [W * 0.8, H * 0.55, W * 0.75]));
      jaw = new THREE.Group();
      jaw.position.set(0, H * 0.5, W * 0.18);
      jaw.add(at(piece(sphere(0.5, 18), dark), 0, -H * 0.05, W * 0.12, [W * 0.6, H * 0.22, W * 0.5]));
      for (let i = -2; i <= 2; i++) jaw.add(at(piece(cone(W * 0.035, H * 0.1, 5), toon("#f4ead2")), i * W * 0.09, H * 0.06, W * 0.33));
      rig.add(jaw);
      for (let i = -2; i <= 2; i++) rig.add(at(piece(cone(W * 0.035, H * 0.1, 5), toon("#f4ead2")), i * W * 0.09, H * 0.5, W * 0.38).rotateX(Math.PI));
      // leaves around the base
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const leaf = at(piece(sphere(0.5, 10), own("#4f7a4a")), Math.sin(a) * W * 0.38, H * 0.06, Math.cos(a) * W * 0.38, [W * 0.28, H * 0.06, W * 0.5]);
        leaf.rotation.y = a;
        rig.add(leaf);
      }
      for (const x of [-1, 1]) rig.add(at(piece(sphere(0.5, 10), toon("#ffcf3d", { emissive: "#ffb000", emissiveIntensity: 0.8 }), { outline: false }), x * W * 0.16, H * 0.72, W * 0.31, [W * 0.09, H * 0.06, W * 0.04]));
      face = new THREE.Vector3(0, H * 0.72, W * 0.34);
      top = new THREE.Vector3(0, H * 0.82, 0);
      break;
    }
    default:
      rig.add(at(piece(sphere(0.5, 16), main), 0, H * 0.5, 0, [W, H, W]));
  }

  // cute eyes for the softer monsters
  if (bodyId === "green_slime" || bodyId === "horned_rabbit" || bodyId === "mire_bat") {
    const r = Math.min(W, H) * 0.09;
    for (const x of [-1, 1]) rig.add(at(eye(r), face.x + x * W * 0.14, face.y, face.z));
  }
  if (bodyId === "bog_toad" || others.includes("bog_toad")) {
    const r = W * 0.12;
    for (const x of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(x * W * 0.24, (bodyId === "bog_toad" ? face.y : top.y) + r * 0.3, bodyId === "bog_toad" ? face.z : face.z * 0.6);
      g.add(piece(sphere(r, 14), bodyId === "bog_toad" ? main : toon(SPECIES_COLOR.bog_toad)));
      g.add(at(eye(r * 0.55), 0, r * 0.1, r * 0.75));
      rig.add(g);
    }
  }

  // the other parents' features
  const feats = new Set<Feature>([...(bodyId === "mirefang" ? (["crown"] as Feature[]) : []), ...others.map((o) => FEATURE_OF[o])]);
  if (bodyId === "horned_rabbit") feats.add("horn");
  if (bodyId === "thorn_wolf") feats.add("thorns");
  if (bodyId === "moss_golem") feats.add("moss");
  for (const f of feats) {
    if (f === "horn") rig.add(at(piece(cone(W * 0.08, H * 0.5, 10), toon("#f4ead2")), top.x, top.y + H * 0.15, top.z + W * 0.05).rotateX(0.35));
    if (f === "thorns") {
      for (let i = 0; i < 4; i++) rig.add(at(piece(cone(W * 0.05, H * 0.32, 6), toon("#5e9e4f")), back.x, back.y + H * 0.1, back.z + (i - 1.5) * W * 0.18).rotateX(-0.25));
    }
    if (f === "moss") {
      for (const [x, z, s] of [
        [-0.2, 0.1, 0.3],
        [0.18, -0.12, 0.36],
        [0.02, 0.15, 0.24],
      ])
        rig.add(at(piece(sphere(0.5, 10), toon("#5fa85a")), top.x + x * W, top.y - H * 0.04, top.z + z * W, [W * s, H * 0.12, W * s]));
    }
    if (f === "crown") {
      const c = new THREE.Group();
      c.position.set(top.x, top.y + H * 0.02, top.z);
      const k = Math.max(W, 0.6);
      c.add(at(piece(cyl(k * 0.25, k * 0.22, k * 0.1, 12), toon("#f5c542", { emissive: "#c99a10", emissiveIntensity: 0.3 })), 0, 0, 0));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        c.add(at(piece(cone(k * 0.06, k * 0.16, 6), toon("#f5c542")), Math.sin(a) * k * 0.22, k * 0.1, Math.cos(a) * k * 0.22));
      }
      c.add(at(piece(sphere(k * 0.05, 8), toon("#d64b6b", { emissive: "#d64b6b", emissiveIntensity: 0.4 })), 0, k * 0.04, k * 0.24));
      rig.add(c);
    }
    if (f === "wings" && bodyId !== "mire_bat") {
      for (const x of [-1, 1]) {
        const g = new THREE.Group();
        g.position.set(x * sides * 0.7, back.y, back.z);
        g.add(at(piece(sphere(0.5, 10), own(SPECIES_COLOR.mire_bat)), x * W * 0.25, 0, 0, [W * 0.5, H * 0.08, W * 0.3]));
        rig.add(g);
        if (x === 1) wingL = g;
        else wingR = g;
      }
    }
    if (f === "shine" && bodyId !== "green_slime") rig.add(at(piece(sphere(0.5, 12), toon("#bff5c4", { opacity: 0.55 }), { outline: false, shadow: false }), 0, top.y, top.z, [W * 0.5, H * 0.2, W * 0.5]));
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
