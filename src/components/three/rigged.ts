// Animated characters from the free KayKit Adventurers pack (CC0, by Kay Lousberg).
// Five bodies share one skeleton, so one file of moves drives them all. The
// pack's colours are recoloured for each player (skin, hair, class colour), and
// our own code-built weapons go in their hands.
//
// Until the files have loaded, the code-built hero from models.ts is shown.

import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { WeaponType } from "@/lib/game/types";
import { BODY_OPTIONS } from "@/lib/game/data/classes";
import type { Look } from "../side/hero";
import { WEAPON_LOOK, makeWeapon, type HeroModel, type HeroPose } from "./models";

export const BODIES = BODY_OPTIONS;
export type Body = (typeof BODIES)[number];

const FILE: Record<Body, string> = {
  Knight: "knight",
  Barbarian: "barbarian",
  Mage: "mage",
  Rogue: "rogue",
  "Hooded Rogue": "rogue_hooded",
};

export function bodyOf(name: string | undefined): Body {
  return (BODIES as readonly string[]).includes(name ?? "") ? (name as Body) : "Rogue";
}

// The texture is a grid of colour swatches, 8 across and 4 down.
// These are the swatches for skin, hair and the main cloth of each body.
type Cell = [col: number, row: number];
const SKIN_CELL: Cell = [0, 0];
const HAIR_CELL: Cell = [1, 0];
const CLOTH_CELLS: Record<Body, Cell[]> = {
  Knight: [[0, 1]],
  Barbarian: [
    [0, 1],
    [1, 1],
  ],
  Mage: [
    [0, 1],
    [1, 1],
  ],
  Rogue: [
    [0, 1],
    [1, 1],
  ],
  "Hooded Rogue": [
    [0, 1],
    [1, 1],
  ],
};

/** Height of the player in the scene (matches the code-built hero). */
const HEIGHT = 1.4;

// ---------- loading ----------

interface Pack {
  bodies: Record<Body, GLTF>;
  clips: Record<string, THREE.AnimationClip>;
  scale: number;
}
let pack: Pack | null = null;
let loading: Promise<Pack | null> | null = null;
const listeners = new Set<() => void>();

/** Starts loading the pack (once). Resolves to null if it can't load; the code-built hero stays. */
export function loadPack(base = "/models/kaykit/"): Promise<Pack | null> {
  if (loading) return loading;
  const loader = new GLTFLoader();
  const get = (f: string) => loader.loadAsync(`${base}${f}.glb`);
  loading = Promise.all([get("moves"), ...BODIES.map((b) => get(FILE[b]))])
    .then(([moves, ...gl]) => {
      const bodies = Object.fromEntries(BODIES.map((b, i) => [b, gl[i]])) as Record<Body, GLTF>;
      const clips = Object.fromEntries(moves.animations.map((c) => [c.name, c]));
      const box = new THREE.Box3().setFromObject(bodies.Rogue.scene);
      pack = { bodies, clips, scale: HEIGHT / Math.max(0.01, box.max.y - box.min.y) };
      for (const f of listeners) f();
      return pack;
    })
    .catch((err) => {
      console.warn("Character pack failed to load; using the simple models.", err);
      return null;
    });
  return loading;
}
export function packReady() {
  return !!pack;
}
export function onPackReady(f: () => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

// ---------- recolouring ----------

let gradient: THREE.DataTexture | null = null;
function gradientMap() {
  if (gradient) return gradient;
  const data = new Uint8Array([120, 120, 120, 255, 200, 200, 200, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Paint one swatch in a new colour, keeping its light-to-dark shading. */
function tint(px: Uint8ClampedArray, w: number, h: number, [col, row]: Cell, color: string) {
  const c = new THREE.Color(color);
  const tr = c.r * 255,
    tg = c.g * 255,
    tb = c.b * 255;
  const x0 = Math.floor((col * w) / 8),
    x1 = Math.floor(((col + 1) * w) / 8);
  const y0 = Math.floor((row * h) / 4),
    y1 = Math.floor(((row + 1) * h) / 4);
  // the swatch's own brightness, measured at its middle
  let ref = 0;
  let n = 0;
  for (let y = y0 + ((y1 - y0) >> 2); y < y1 - ((y1 - y0) >> 2); y += 4)
    for (let x = x0 + 4; x < x0 + ((x1 - x0) >> 1); x += 4) {
      const i = (y * w + x) * 4;
      ref += lum(px[i], px[i + 1], px[i + 2]);
      n++;
    }
  ref = Math.max(1, ref / Math.max(1, n));
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      const k = lum(px[i], px[i + 1], px[i + 2]) / ref;
      px[i] = tr * k;
      px[i + 1] = tg * k;
      px[i + 2] = tb * k;
    }
}

const textures = new Map<string, THREE.Texture>();
function recoloured(body: Body, src: THREE.Texture, look: Look): THREE.Texture {
  const key = `${body}|${look.skin}|${look.hair}|${look.shirt}`;
  const hit = textures.get(key);
  if (hit) return hit;
  const img = src.image as CanvasImageSource & { width: number; height: number };
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, canvas.width, canvas.height);
  tint(data.data, canvas.width, canvas.height, SKIN_CELL, look.skin);
  tint(data.data, canvas.width, canvas.height, HAIR_CELL, look.hair);
  for (const cell of CLOTH_CELLS[body]) tint(data.data, canvas.width, canvas.height, cell, look.shirt);
  g.putImageData(data, 0, 0);
  const t = new THREE.CanvasTexture(canvas);
  t.flipY = src.flipY;
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = src.magFilter;
  t.minFilter = src.minFilter;
  t.generateMipmaps = src.generateMipmaps;
  textures.set(key, t);
  return t;
}

// ---------- outlines that bend with the skeleton ----------

let outlineMat: THREE.MeshBasicMaterial | null = null;
function outline() {
  if (outlineMat) return outlineMat;
  outlineMat = new THREE.MeshBasicMaterial({ color: "#2a2238", side: THREE.BackSide });
  outlineMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace(
      "#include <project_vertex>",
      "#ifdef USE_SKINNING\n transformed += normalize(objectNormal) * 0.02;\n#else\n transformed += normalize(normal) * 0.02;\n#endif\n#include <project_vertex>",
    );
  };
  return outlineMat;
}

// ---------- which move to play ----------

function attackClip(weapon: WeaponType, alt: boolean): string {
  switch (weapon) {
    case "sword":
      return alt ? "1H_Melee_Attack_Chop" : "1H_Melee_Attack_Slice_Diagonal";
    case "daggers":
      return "Dualwield_Melee_Attack_Slice";
    case "hammer":
      return "2H_Melee_Attack_Chop";
    case "lance":
      return "2H_Melee_Attack_Stab";
    case "large_shield":
      return "1H_Melee_Attack_Chop";
    case "bow":
      return "2H_Ranged_Shoot";
    case "pistol":
      return "1H_Ranged_Shoot";
    case "staff":
    case "tamer_wand":
    case "healing_bracelet":
      return "Spellcast_Shoot";
    default:
      return alt ? "Unarmed_Melee_Attack_Punch_B" : "Unarmed_Melee_Attack_Punch_A";
  }
}

/**
 * An animated pack character. Same shape as the code-built hero, so the scene
 * can use either. Returns null if the pack hasn't loaded yet.
 */
export function makeRiggedHero(look: Look): HeroModel | null {
  if (!pack) return null;
  const body = bodyOf(look.body);
  const src = pack.bodies[body];
  const root = new THREE.Group();
  const char = cloneSkinned(src.scene) as THREE.Group;
  char.scale.setScalar(pack.scale);
  root.add(char);

  const meshes: THREE.Mesh[] = [];
  char.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (const m of meshes) {
    const old = m.material as THREE.MeshStandardMaterial;
    m.material = new THREE.MeshToonMaterial({ map: old.map ? recoloured(body, old.map, look) : null, gradientMap: gradientMap() });
    m.castShadow = true;
    m.receiveShadow = false;
    m.frustumCulled = false;
    let o: THREE.Mesh;
    if ((m as THREE.SkinnedMesh).isSkinnedMesh) {
      const sm = m as THREE.SkinnedMesh;
      const so = new THREE.SkinnedMesh(sm.geometry, outline());
      so.bind(sm.skeleton, sm.bindMatrix);
      o = so;
    } else {
      o = new THREE.Mesh(m.geometry, outline());
    }
    o.userData.outline = true;
    o.castShadow = false;
    o.frustumCulled = false;
    o.position.copy(m.position);
    o.quaternion.copy(m.quaternion);
    o.scale.copy(m.scale);
    m.parent!.add(o);
  }

  // weapon slots: our own weapons, in the pack's hand bones
  // (the loader drops the dots from names: "handslot.r" becomes "handslotr")
  const slotR = char.getObjectByName("handslotr") ?? char.getObjectByName("handslot.r");
  const slotL = char.getObjectByName("handslotl") ?? char.getObjectByName("handslot.l");
  const holdR = new THREE.Group();
  const holdL = new THREE.Group();
  // our weapons are built pointing down the arm (-y); the pack's hand slots point the blade along +y
  holdR.rotation.set(Math.PI, 0, 0);
  holdL.rotation.set(Math.PI, 0, 0);
  holdR.scale.setScalar(1.25 / pack.scale);
  holdL.scale.setScalar(1.25 / pack.scale);
  slotR?.add(holdR);
  slotL?.add(holdL);

  const mixer = new THREE.AnimationMixer(char);
  const actions = new Map<string, THREE.AnimationAction>();
  const action = (name: string) => {
    let a = actions.get(name);
    if (!a) {
      const clip = pack!.clips[name];
      if (!clip) return null;
      a = mixer.clipAction(clip);
      actions.set(name, a);
    }
    return a;
  };

  let current: THREE.AnimationAction | null = null;
  let currentPose: HeroPose | "" = "";
  let lockedUntil = 0; // a one-shot move holds the body until this time
  let lastT = -1;
  let lastProg = 1;
  let swings = 0;

  const play = (name: string, opts: { once?: boolean; fade?: number; speed?: number; restart?: boolean } = {}) => {
    const a = action(name);
    if (!a) return 0;
    if (a !== current || opts.restart) {
      a.reset();
      a.enabled = true;
      a.setEffectiveWeight(1);
      a.setLoop(opts.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      a.clampWhenFinished = !!opts.once;
      a.timeScale = opts.speed ?? 1;
      if (current && current !== a) a.crossFadeFrom(current, opts.fade ?? 0.2, false);
      a.play();
      current = a;
    } else {
      a.timeScale = opts.speed ?? 1;
    }
    return (a.getClip().duration / Math.max(0.01, a.timeScale)) * 1000;
  };

  const model: HeroModel = {
    root,
    weapon: null,
    set(weapon) {
      if (model.weapon === weapon) return;
      model.weapon = weapon;
      holdR.clear();
      holdL.clear();
      // a staff or wand keeps its gem at the top
      const upright = weapon === "staff" || weapon === "tamer_wand";
      holdR.rotation.x = upright ? 0 : Math.PI;
      const w = makeWeapon(weapon);
      if (w.right) holdR.add(w.right);
      if (w.left) holdL.add(w.left);
    },
    animate(pose, t, walkT, progress) {
      const dt = lastT < 0 ? 0 : Math.min(0.1, Math.max(0, (t - lastT) / 1000));
      lastT = t;
      const weapon = model.weapon ?? "unarmed";
      // a fresh attack: the pose just started, or its progress jumped back to the start
      const newAttack = pose === "attack" && (currentPose !== "attack" || progress < lastProg - 0.05);
      lastProg = pose === "attack" ? progress : 1;

      if (pose !== "dead" && currentPose === "dead") lockedUntil = 0; // back on your feet
      const urgent = pose === "dead" || pose === "hurt" || newAttack || (pose === "cast" && currentPose !== "cast");
      if (t >= lockedUntil || urgent) {
        if (pose === "dead") {
          if (currentPose !== "dead") play("Death_A", { once: true, fade: 0.15 });
          lockedUntil = Infinity;
        } else if (pose === "hurt") {
          if (currentPose !== "hurt") lockedUntil = t + play("Hit_A", { once: true, fade: 0.08, speed: 1.4, restart: true }) * 0.8;
        } else if (newAttack) {
          swings++;
          const name = attackClip(weapon, swings % 2 === 0);
          // fast and snappy: the hit lands early in the move, like the game's timing
          lockedUntil = t + play(name, { once: true, fade: 0.06, speed: WEAPON_LOOK[weapon] === "shoot" ? 1.6 : 1.8, restart: true }) * 0.85;
        } else if (pose === "cast") {
          if (currentPose !== "cast") lockedUntil = t + play("Spellcast_Raise", { once: true, fade: 0.1, speed: 1.5, restart: true }) * 0.9;
        } else if (pose === "block") {
          play("Blocking", { fade: 0.1 });
        } else if (pose === "jump" || pose === "fall") {
          play("Jump_Idle", { fade: 0.15 });
        } else if (pose === "walk") {
          play("Running_A", { fade: 0.18, speed: 1.05 });
        } else {
          play(weapon === "unarmed" ? "Unarmed_Idle" : "Idle", { fade: 0.25 });
        }
        if (pose !== "attack" || newAttack) currentPose = pose;
      }
      if (pose === "dead") currentPose = "dead";
      void walkT;
      mixer.update(dt);
    },
  };
  return model;
}
