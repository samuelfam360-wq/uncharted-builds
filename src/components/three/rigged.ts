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
import { makeHornWeapon } from "./hornWeapons";
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

function cellRect([col, row]: Cell, w: number, h: number) {
  return [Math.floor((col * w) / 8), Math.floor(((col + 1) * w) / 8), Math.floor((row * h) / 4), Math.floor(((row + 1) * h) / 4)];
}

/**
 * Paint one swatch in a new colour, keeping its light-to-dark shading.
 * keep = how much of that shading stays (1 = all, 0 = flat colour).
 */
function tint(px: Uint8ClampedArray, w: number, h: number, cell: Cell, color: string, keep = 1) {
  const c = new THREE.Color(color).convertLinearToSRGB(); // the canvas holds screen colours
  const tr = c.r * 255,
    tg = c.g * 255,
    tb = c.b * 255;
  const [x0, x1, y0, y1] = cellRect(cell, w, h);
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
      const k = 1 + (lum(px[i], px[i + 1], px[i + 2]) / ref - 1) * keep;
      px[i] = tr * k;
      px[i + 1] = tg * k;
      px[i + 2] = tb * k;
    }
}

// The neon look: dark cloth, gunmetal armour, and trims that glow in the hero's colour.
const EYE_CELL: Cell = [2, 0];
const METAL_CELLS: Cell[] = [
  [3, 0],
  [7, 0],
  [2, 1],
  [3, 1],
  [7, 1],
  [4, 0],
];
/** The small parts of each outfit that glow (cuffs, buckles, edges). */
const TRIM_CELLS: Record<Body, Cell[]> = {
  Knight: [[1, 1]],
  Barbarian: [[7, 2]],
  Mage: [
    [2, 2],
    [0, 2],
    [7, 2],
  ],
  Rogue: [[5, 2]],
  "Hooded Rogue": [[5, 2]],
};

function canvasTexture(src: THREE.Texture, paint: (px: Uint8ClampedArray, w: number, h: number) => void): THREE.Texture {
  const img = src.image as CanvasImageSource & { width: number; height: number };
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, canvas.width, canvas.height);
  paint(data.data, canvas.width, canvas.height);
  g.putImageData(data, 0, 0);
  const t = new THREE.CanvasTexture(canvas);
  t.flipY = src.flipY;
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = src.magFilter;
  t.minFilter = src.minFilter;
  t.generateMipmaps = src.generateMipmaps;
  return t;
}

const textures = new Map<string, THREE.Texture>();
function recoloured(body: Body, src: THREE.Texture, look: Look): THREE.Texture {
  const key = `${body}|${look.skin}|${look.hair}|${look.shirt}|${look.glow ?? ""}`;
  const hit = textures.get(key);
  if (hit) return hit;
  const t = canvasTexture(src, (px, w, h) => {
    tint(px, w, h, SKIN_CELL, look.skin);
    tint(px, w, h, HAIR_CELL, look.hair);
    // the pack's own small eyes are painted over: big shiny ones are added on top
    tint(px, w, h, EYE_CELL, look.skin, 0);
    if (look.glow) {
      // dark cloth with a hint of the glow colour
      const cloth = new THREE.Color("#171a2c").lerp(new THREE.Color(look.glow), 0.1);
      const cloth2 = new THREE.Color("#24283f").lerp(new THREE.Color(look.glow), 0.12);
      CLOTH_CELLS[body].forEach((cell, i) => tint(px, w, h, cell, `#${(i ? cloth2 : cloth).getHexString()}`, 0.8));
      for (const cell of METAL_CELLS) tint(px, w, h, cell, "#4a5170", 0.9);
      for (const cell of TRIM_CELLS[body]) tint(px, w, h, cell, look.glow, 0.3);
    } else {
      for (const cell of CLOTH_CELLS[body]) tint(px, w, h, cell, look.shirt);
    }
  });
  textures.set(key, t);
  return t;
}

/** White where the trims are, black elsewhere: the parts of the outfit that glow. */
const glowMaps = new Map<string, THREE.Texture>();
function glowMap(body: Body, src: THREE.Texture): THREE.Texture {
  const hit = glowMaps.get(body);
  if (hit) return hit;
  const t = canvasTexture(src, (px, w, h) => {
    for (let i = 0; i < px.length; i += 4) px[i] = px[i + 1] = px[i + 2] = 0;
    for (const cell of TRIM_CELLS[body]) {
      const [x0, x1, y0, y1] = cellRect(cell, w, h);
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          px[i] = px[i + 1] = px[i + 2] = 255;
        }
    }
  });
  glowMaps.set(body, t);
  return t;
}

/** How strong a colour must shine to read as neon: dark colours (purple, blue) are pushed harder. */
export function glowPower(color: string, target = 1.35): number {
  const c = new THREE.Color(color);
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return Math.min(6, Math.max(1, target / Math.max(0.05, l)));
}

/** The hero's material: toon shading, glowing trims, and a soft edge light in the glow colour. */
function heroMaterial(body: Body, map: THREE.Texture | null, look: Look): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({ map: map ? recoloured(body, map, look) : null, gradientMap: gradientMap() });
  if (!look.glow || !map) return mat;
  mat.emissive = new THREE.Color(look.glow);
  mat.emissiveMap = glowMap(body, map);
  // the rogues' glowing part is a whole glove: keep it gentler than a thin trim
  mat.emissiveIntensity = glowPower(look.glow) * (body === "Rogue" || body === "Hooded Rogue" ? 0.5 : 1);
  const rim = new THREE.Color(look.glow);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = { value: rim };
    sh.fragmentShader =
      "uniform vec3 uRim;\n" +
      sh.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          float f = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
          totalEmissiveRadiance += uRim * smoothstep(0.6, 1.0, f) * 0.6;
        }`,
      );
  };
  mat.customProgramCacheKey = () => "hero-rim";
  return mat;
}

// ---------- the painted face: big shiny eyes and rosy cheeks ----------

function facePart(geo: THREE.BufferGeometry, color: string, layer: number, opacity = 1) {
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, polygonOffset: true, polygonOffsetFactor: -4 - layer * 4, polygonOffsetUnits: -4 }),
  );
  m.position.z = layer * 0.002;
  m.renderOrder = 3 + layer;
  return m;
}

/** One big eye: a dark oval, the eye colour in its lower half, and two white sparkles. */
function bigEye(r: number, color: string) {
  const g = new THREE.Group();
  const base = facePart(new THREE.CircleGeometry(r, 28), "#1c1b4d", 0);
  base.scale.set(0.8, 1.12, 1);
  const iris = facePart(new THREE.CircleGeometry(r * 0.72, 28, Math.PI, Math.PI), color, 1);
  iris.scale.set(0.8, 1.05, 1);
  iris.position.y = -r * 0.12;
  const s1 = facePart(new THREE.CircleGeometry(r * 0.3, 16), "#ffffff", 2);
  s1.position.x = -r * 0.26;
  s1.position.y = r * 0.46;
  const s2 = facePart(new THREE.CircleGeometry(r * 0.14, 12), "#ffffff", 2);
  s2.position.x = r * 0.3;
  s2.position.y = -r * 0.5;
  g.add(base, iris, s1, s2);
  return g;
}

/**
 * Adds the face to a character standing in its rest pose. The eyes go where the
 * pack's own eyes are (found from the vertices painted with the eye swatch).
 */
function addFace(char: THREE.Object3D, meshes: THREE.Mesh[], look: Look) {
  const head = meshes.find((m) => /head/i.test(m.name)) as THREE.SkinnedMesh | undefined;
  const bone = char.getObjectByName("head");
  const uv = head?.geometry.attributes.uv;
  if (!head || !bone || !uv) return;
  char.parent?.updateMatrixWorld(true);
  const left = new THREE.Box3();
  const right = new THREE.Box3();
  const all = new THREE.Box3();
  const p = new THREE.Vector3();
  for (let i = 0; i < uv.count; i++) {
    if (head.isSkinnedMesh) head.getVertexPosition(i, p);
    else p.fromBufferAttribute(head.geometry.attributes.position, i);
    head.localToWorld(p);
    all.expandByPoint(p);
    if (Math.floor(uv.getX(i) * 8) === EYE_CELL[0] && Math.floor(uv.getY(i) * 4) === EYE_CELL[1]) (p.x > 0 ? left : right).expandByPoint(p);
  }
  if (left.isEmpty() || right.isEmpty()) return;
  // a frame on the head bone that matches the rest pose, so the parts can be placed in plain units
  const face = new THREE.Group();
  face.applyMatrix4(new THREE.Matrix4().copy(bone.matrixWorld).invert());
  face.userData.detail = true;
  bone.add(face);
  const c = left.getCenter(new THREE.Vector3());
  const r = (all.max.x - all.min.x) * 0.122;
  const gap = Math.abs(c.x) * 1.06;
  const z = Math.max(left.max.z, right.max.z);
  for (const sgn of [1, -1]) {
    const eye = bigEye(r, look.eyes);
    eye.position.set(sgn * gap, c.y - r * 0.1, z + 0.004);
    eye.rotation.y = sgn * 0.22;
    eye.scale.x = sgn;
    const cheek = facePart(new THREE.CircleGeometry(r * 0.62, 20), "#ff7f8f", 0, 0.7);
    cheek.scale.y = 0.72;
    cheek.position.set(sgn * (gap + r * 0.7), c.y - r * 1.45, z - 0.02);
    cheek.rotation.y = sgn * 0.6;
    face.add(eye, cheek);
  }
  face.traverse((o) => {
    o.userData.detail = true;
    o.frustumCulled = false;
  });
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
    m.material = heroMaterial(body, old.map, look);
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

  if (!look.noFace) addFace(char, meshes, look);

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
  holdR.userData.weapon = holdL.userData.weapon = true;
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
    set(weapon, horn = false) {
      if (model.weapon === weapon && !!model.horn === horn) return;
      model.weapon = weapon;
      model.horn = horn;
      holdR.clear();
      holdL.clear();
      // a staff or wand keeps its gem at the top
      const upright = weapon === "staff" || weapon === "tamer_wand";
      holdR.rotation.x = upright ? 0 : Math.PI;
      const w = horn ? makeHornWeapon(weapon, look.glow) : makeWeapon(weapon);
      if (w.right) holdR.add(w.right);
      if (w.left) holdL.add(w.left);
      // the weapon picks up a soft glow in the hero's colour (a horn weapon has its own glowing ring)
      if (look.glow && !horn)
        for (const hold of [holdR, holdL])
          hold.traverse((o) => {
            const mat = (o as THREE.Mesh).material as THREE.MeshToonMaterial | undefined;
            if (!mat || !(mat instanceof THREE.MeshToonMaterial)) return;
            const own = mat.clone();
            own.emissive = new THREE.Color(look.glow);
            own.emissiveIntensity = 0.45;
            (o as THREE.Mesh).material = own;
          });
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
