// Anime heroes (the "Default" and "Chibi" body styles), saved as .vrm files (the
// VRoid format). They use the anime shading that comes with the model (MToon),
// with the hero's neon colour as an edge light. Their moves are the KayKit pack's
// moves, moved over onto the anime skeleton, so every style moves the same way.
//
// Every hero is the MakerLab Swordsman for now (made from the Swordsman's 2D art,
// rigged in Maker Studio): one look for everyone first, improved step by step.
// If it can't load, the free pixiv VRoid sample (which may be used in games,
// changed and shared) stands in.
//
// Loading a model takes a moment, so a hero starts as the Block hero and swaps
// to the anime one when it is ready.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MToonMaterial, VRMLoaderPlugin, VRMUtils, type VRM, type VRMHumanBoneName } from "@pixiv/three-vrm";
import type { WeaponType } from "@/lib/game/types";
import type { Look } from "../side/hero";
import { makeHornWeapon } from "./hornWeapons";
import { WEAPON_LOOK, makeHero, makeWeapon, type HeroModel, type HeroPose } from "./models";
import { attackClip, loadPack, makeRiggedHero, onPackReady, packMoves } from "./rigged";

const BASE = "/models/vroid/";
/** The hero every anime look uses for now. */
export const HERO = "swordsman-makerlab.vrm";
/** Stands in if the hero can't load. */
export const SAMPLE = "sample.vrm";
/** Models that are already chibi: the Chibi style only makes them a little smaller. */
const BUILT_CHIBI = new Set([HERO]);

/** Height in the scene: the anime hero is a little taller than the Block one (1.4); the chibi a little shorter. */
const HEIGHT = { Default: 1.5, Chibi: 1.25 };

// ---------- loading ----------

const files = new Map<string, Promise<ArrayBuffer | null>>();
function fileBytes(name: string): Promise<ArrayBuffer | null> {
  let f = files.get(name);
  if (!f) {
    f = fetch(BASE + name)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
    files.set(name, f);
  }
  return f;
}

/** A fresh copy of a model (each hero needs its own skeleton, face and hair physics). */
async function loadVrm(name: string): Promise<VRM | null> {
  const bytes = await fileBytes(name);
  if (!bytes) return null;
  const loader = new GLTFLoader();
  loader.register((p) => new VRMLoaderPlugin(p));
  try {
    const gltf = await loader.parseAsync(bytes, BASE);
    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) return null;
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    vrm.scene.traverse((o) => (o.frustumCulled = false));
    vrm.scene.userData.vrmFile = name;
    return vrm;
  } catch (err) {
    console.warn(`Anime model ${name} failed to load.`, err);
    return null;
  }
}

async function loadHeroVrm(): Promise<VRM | null> {
  return (await loadVrm(HERO)) ?? loadVrm(SAMPLE);
}

// ---------- colours: skin, hair, eyes and the neon glow ----------

/** Repaint a texture in a new colour, keeping its light and dark shading. */
function recolor(src: THREE.Texture, color: string, keep = 1): THREE.Texture {
  const img = src.image as CanvasImageSource & { width: number; height: number };
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < px.length; i += 16)
    if (px[i + 3] > 128) {
      sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      n++;
    }
  const mean = Math.max(1, sum / Math.max(1, n));
  const c = new THREE.Color(color).convertLinearToSRGB();
  for (let i = 0; i < px.length; i += 4) {
    const k = 1 + ((0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / mean - 1) * keep;
    px[i] = c.r * 255 * k;
    px[i + 1] = c.g * 255 * k;
    px[i + 2] = c.b * 255 * k;
  }
  g.putImageData(data, 0, 0);
  const t = new THREE.CanvasTexture(canvas);
  t.flipY = src.flipY;
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = src.wrapS;
  t.wrapT = src.wrapT;
  t.magFilter = src.magFilter;
  t.minFilter = src.minFilter;
  return t;
}

/**
 * For a model painted in one picture, like the MakerLab Swordsman: the bright
 * cyan neon trims on the clothes are repainted in the hero's glow colour, and
 * (if the hair has no material of its own) the teal hair on the head in the hair colour.
 * The head is found from the skin weights (the parts that move with the head bone).
 */
function paintOnePicture(vrm: VRM, look: Look, hairToo: boolean) {
  const head = vrm.humanoid.getRawBoneNode("head");
  const meshes: [THREE.SkinnedMesh, MToonMaterial][] = [];
  vrm.scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.geometry.attributes.uv) return;
    // a VRM mesh has its material and its outline material
    for (const mat of Array.isArray(m.material) ? m.material : [m.material])
      if (mat instanceof MToonMaterial && mat.map && !/HAIR|SKIN|FACE|EYE/i.test(mat.name)) meshes.push([m, mat]);
  });
  const done = new Map<THREE.Texture, THREE.Texture>();
  for (const [mesh, mat] of meshes) {
    const src = mat.map!;
    let out = done.get(src);
    if (!out) {
      const img = src.image as CanvasImageSource & { width: number; height: number };
      const w = img.width;
      const h = img.height;
      // the head's part of the picture
      const mask = document.createElement("canvas");
      mask.width = w;
      mask.height = h;
      const mg = mask.getContext("2d", { willReadFrequently: true })!;
      mg.fillStyle = mg.strokeStyle = "#fff";
      // a little wider than the triangles, so the seams between the picture's pieces change too
      mg.lineWidth = Math.max(2, w / 400);
      mg.lineJoin = "round";
      const bone = head ? mesh.skeleton.bones.indexOf(head as THREE.Bone) : -1;
      const geo = mesh.geometry;
      const uv = geo.attributes.uv;
      const si = geo.attributes.skinIndex;
      const sw = geo.attributes.skinWeight;
      const onHead = (v: number) => {
        let k = 0;
        for (let c = 0; c < 4; c++) if (si.getComponent(v, c) === bone) k += sw.getComponent(v, c);
        return k > 0.5;
      };
      const idx = geo.index;
      const tris = idx ? idx.count : uv.count;
      const at = (i: number) => (idx ? idx.getX(i) : i);
      const y = (v: number) => (src.flipY ? 1 - uv.getY(v) : uv.getY(v)) * h;
      if (bone >= 0 && hairToo)
        for (let i = 0; i + 2 < tris; i += 3) {
          const a = at(i), b = at(i + 1), c = at(i + 2);
          if (!onHead(a) || !onHead(b) || !onHead(c)) continue;
          mg.beginPath();
          mg.moveTo(uv.getX(a) * w, y(a));
          mg.lineTo(uv.getX(b) * w, y(b));
          mg.lineTo(uv.getX(c) * w, y(c));
          mg.closePath();
          mg.fill();
          mg.stroke();
        }
      const m = mg.getImageData(0, 0, w, h).data;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const g = canvas.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      const data = g.getImageData(0, 0, w, h);
      const px = data.data;
      const hair = new THREE.Color(look.hair).convertLinearToSRGB().getHSL({ h: 0, s: 0, l: 0 });
      const glow = new THREE.Color(look.glow ?? "#5fd6f0").convertLinearToSRGB().getHSL({ h: 0, s: 0, l: 0 });
      const c = new THREE.Color();
      const o = { h: 0, s: 0, l: 0 };
      for (let i = 0; i < px.length; i += 4) {
        c.setRGB(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255);
        c.getHSL(o);
        if (o.h < 0.45 || o.h > 0.58 || o.s < 0.3) continue; // not teal or cyan
        if (m[i] > 127) {
          // the hair's teal (the blue eyes are a little bluer and stay as they are)
          if (o.h < 0.49 || o.h > 0.556 || o.l < 0.1 || o.l > 0.88) continue;
          c.setHSL(hair.h, Math.min(1, hair.s * (0.5 + o.s * 0.5)), Math.min(0.95, Math.max(0.04, hair.l + (o.l - 0.5) * 0.7)));
        } else {
          if (!look.glow || o.l < 0.45) continue; // only the bright trims glow
          c.setHSL(glow.h, Math.max(glow.s, 0.6) * o.s, Math.min(0.95, glow.l + (o.l - 0.5) * 0.6));
        }
        px[i] = c.r * 255;
        px[i + 1] = c.g * 255;
        px[i + 2] = c.b * 255;
      }
      g.putImageData(data, 0, 0);
      out = new THREE.CanvasTexture(canvas);
      out.flipY = src.flipY;
      out.colorSpace = THREE.SRGBColorSpace;
      out.wrapS = src.wrapS;
      out.wrapT = src.wrapT;
      out.magFilter = src.magFilter;
      out.minFilter = src.minFilter;
      done.set(src, out);
    }
    mat.map = out;
    if (mat.shadeMultiplyTexture === src) mat.shadeMultiplyTexture = out;
  }
}

function dress(vrm: VRM, look: Look) {
  let hasHair = false;
  vrm.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (/HAIR/i.test(m.name)) hasHair = true;
  });
  paintOnePicture(vrm, look, !hasHair);
  const glow = new THREE.Color(look.glow ?? "#ffffff");
  const skin = new THREE.Color(look.skin).lerp(new THREE.Color("#fff1e8"), 0.2);
  const done = new Map<string, THREE.Texture>();
  const ids = new Map<THREE.Texture, number>();
  const paint = (t: THREE.Texture | null, color: string, keep: number) => {
    if (!t) return t;
    if (!ids.has(t)) ids.set(t, ids.size);
    const k = `${ids.get(t)}:${color}:${keep}`;
    const key = done.get(k);
    if (key) return key;
    const r = recolor(t, color, keep);
    done.set(k, r);
    return r;
  };
  // the class's clothes (from its 2D art); shoes stay dark leather
  const cloth = (name: string) =>
    !look.outfit ? null : /Tops/i.test(name) ? look.outfit.top : /Bottoms/i.test(name) ? look.outfit.bottom : /Shoes/i.test(name) ? "#3a2a22" : null;
  vrm.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!(m instanceof MToonMaterial)) continue;
      const name = m.name;
      if (/HAIR/i.test(name)) {
        m.map = paint(m.map, look.hair, 1);
        if (m.shadeMultiplyTexture) m.shadeMultiplyTexture = paint(m.shadeMultiplyTexture, look.hair, 1);
      } else if (/SKIN/i.test(name)) {
        m.map = paint(m.map, `#${skin.getHexString()}`, 1);
        if (m.shadeMultiplyTexture) m.shadeMultiplyTexture = paint(m.shadeMultiplyTexture, `#${skin.getHexString()}`, 1);
      } else if (/EyeIris/i.test(name)) {
        m.map = paint(m.map, look.eyes, 1);
      }
      if (m.isOutline || /FACE|EYE|Face_/i.test(name)) continue;
      // the neon look: an edge light in the hero's colour, and a darker outfit
      m.parametricRimColorFactor = glow.clone();
      m.parametricRimFresnelPowerFactor = /CLOTH/.test(name) ? 3.5 : 4.5;
      m.parametricRimLiftFactor = 0.05;
      m.rimLightingMixFactor = 1;
      const outfit = cloth(name);
      if (outfit) {
        m.map = paint(m.map, outfit, 0.9);
        if (m.shadeMultiplyTexture) m.shadeMultiplyTexture = paint(m.shadeMultiplyTexture, outfit, 0.9);
        m.color.set("#ffffff");
        m.shadeColorFactor.set(new THREE.Color(outfit).multiplyScalar(0.55));
      } else if (/CLOTH/.test(name)) {
        m.color.multiply(new THREE.Color("#4a5296"));
        m.shadeColorFactor.multiply(new THREE.Color("#3a3f78"));
      }
    }
  });
}

// ---------- chibi: big head, short sturdy body ("like a dwarf, but cute") ----------

const CHIBI_SCALE: Partial<Record<VRMHumanBoneName, number>> = {
  spine: 1.1, // a sturdier upper body (it also grows everything above it)
  head: 1.6,
  leftUpperArm: 0.8,
  rightUpperArm: 0.8,
  leftUpperLeg: 0.6,
  rightUpperLeg: 0.6,
};

// ---------- moves: the pack's animations, moved onto the anime skeleton ----------

/**
 * Which pack bones drive each anime bone. A hand takes the wrist, the hand and the
 * weapon slot together, so a weapon points the same way as on the Block heroes; the
 * hips take the pack's root too (it sways in a few moves).
 */
const CHAINS: Partial<Record<VRMHumanBoneName, string[]>> = {
  hips: ["root", "hips"],
  spine: ["spine"],
  chest: ["chest"],
  head: ["head"],
  leftUpperArm: ["upperarml"],
  leftLowerArm: ["lowerarml"],
  leftHand: ["wristl", "handl", "handslotl"],
  rightUpperArm: ["upperarmr"],
  rightLowerArm: ["lowerarmr"],
  rightHand: ["wristr", "handr", "handslotr"],
  leftUpperLeg: ["upperlegl"],
  leftLowerLeg: ["lowerlegl"],
  leftFoot: ["footl"],
  leftToes: ["toesl"],
  rightUpperLeg: ["upperlegr"],
  rightLowerLeg: ["lowerlegr"],
  rightFoot: ["footr"],
  rightToes: ["toesr"],
};
/**
 * The pack's heroes are chunky, so their arms hang out wide; slim anime arms look
 * better closer to the body. Turn (radians) added to each upper arm, around the front.
 */
const ARMS_IN: Partial<Record<VRMHumanBoneName, number>> = { leftUpperArm: -0.36, rightUpperArm: 0.36 };
const plain = (s: string) => s.replace(/\./g, "").toLowerCase();
/** For each bone, the next bone along the limb: their line is the bone's direction. */
const NEXT: Partial<Record<VRMHumanBoneName, VRMHumanBoneName>> = {
  leftUpperArm: "leftLowerArm",
  leftLowerArm: "leftHand",
  rightUpperArm: "rightLowerArm",
  rightLowerArm: "rightHand",
  leftUpperLeg: "leftLowerLeg",
  leftLowerLeg: "leftFoot",
  rightUpperLeg: "rightLowerLeg",
  rightLowerLeg: "rightFoot",
  spine: "chest",
  chest: "head",
};
/** The nearest moved bone above each one (the anime skeleton has extra bones in between). */
const UP: Partial<Record<VRMHumanBoneName, VRMHumanBoneName>> = {
  spine: "hips",
  chest: "spine",
  head: "chest",
  leftUpperArm: "chest",
  leftLowerArm: "leftUpperArm",
  leftHand: "leftLowerArm",
  rightUpperArm: "chest",
  rightLowerArm: "rightUpperArm",
  rightHand: "rightLowerArm",
  leftUpperLeg: "hips",
  leftLowerLeg: "leftUpperLeg",
  leftFoot: "leftLowerLeg",
  leftToes: "leftFoot",
  rightUpperLeg: "hips",
  rightLowerLeg: "rightUpperLeg",
  rightFoot: "rightLowerLeg",
  rightToes: "rightFoot",
};

const CHAINS_UP = (b: VRMHumanBoneName) => UP[b];

const clipCache = new Map<string, Record<string, THREE.AnimationClip>>();

/**
 * Re-aims every key of every pack move for the anime skeleton. A bone's turn away
 * from its rest pose, measured in the world, is copied over. The two skeletons rest
 * in slightly different poses (the anime one in a T-pose, the pack's arms lower), so
 * each bone also gets the turn that takes the anime rest pose to the pack's.
 */
function retarget(vrm: VRM): Record<string, THREE.AnimationClip> | null {
  const moves = packMoves();
  if (!moves) return null;
  const hipsNode = vrm.humanoid.getNormalizedBoneNode("hips");
  if (!hipsNode) return null;
  // one set of moves per model file (the bodies differ in size)
  const cacheKey = `${vrm.scene.userData.vrmFile ?? ""}:${hipsNode.name}`;
  const hit = clipCache.get(cacheKey);
  if (hit) return hit;

  const rest = moves.rest;
  rest.updateMatrixWorld(true);
  const byName = new Map<string, THREE.Object3D>();
  rest.traverse((o) => byName.set(plain(o.name), o));
  const rigHips = byName.get("hips");
  if (!rigHips) return null;
  const rigHipsY = rigHips.getWorldPosition(new THREE.Vector3()).y;
  const vrmHipsRest = hipsNode.position.clone();
  vrm.scene.updateMatrixWorld(true);
  const vrmHipsY = hipsNode.getWorldPosition(new THREE.Vector3()).y / vrm.scene.scale.y;
  const ratio = vrmHipsY / Math.max(0.01, rigHipsY);

  // the turn from the anime rest pose to the pack's rest pose, bone by bone
  const rigOf = new Map<VRMHumanBoneName, THREE.Object3D>();
  for (const [bone, chain] of Object.entries(CHAINS)) {
    const n = byName.get(chain![0] === "root" ? "hips" : chain![0]);
    if (n) rigOf.set(bone as VRMHumanBoneName, n);
  }
  const wpos = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
  const restTurn = new Map<VRMHumanBoneName, THREE.Quaternion>();
  const turnOf = (b: VRMHumanBoneName): THREE.Quaternion => {
    const hit = restTurn.get(b);
    if (hit) return hit;
    const next = NEXT[b];
    let a: THREE.Quaternion;
    const r0 = rigOf.get(b);
    const r1 = next ? rigOf.get(next) : undefined;
    const v0 = vrm.humanoid.getNormalizedBoneNode(b);
    const v1 = next ? vrm.humanoid.getNormalizedBoneNode(next) : null;
    if (r0 && r1 && v0 && v1) {
      const dr = wpos(r1).sub(wpos(r0)).normalize();
      const dv = wpos(v1).sub(wpos(v0)).normalize();
      a = new THREE.Quaternion().setFromUnitVectors(dv, dr);
    } else {
      // a bone at the end of a limb keeps the turn of the bone above it
      const up = UP[b];
      a = up ? turnOf(up).clone() : new THREE.Quaternion();
    }
    restTurn.set(b, a);
    return a;
  };

  // a pack bone's turn away from rest, as a turn in the world (its parent at rest)
  const restOf = (n: THREE.Object3D) => ({
    parent: n.parent ? n.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion(),
    inv: n.getWorldQuaternion(new THREE.Quaternion()).invert(),
  });

  const q = new THREE.Quaternion();
  const q2 = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  const out: Record<string, THREE.AnimationClip> = {};
  for (const [name, clip] of Object.entries(moves.clips)) {
    const byTrack = new Map<string, THREE.KeyframeTrack>();
    for (const t of clip.tracks) {
      const dot = t.name.lastIndexOf(".");
      byTrack.set(`${plain(t.name.slice(0, dot))}.${t.name.slice(dot + 1)}`, t);
    }
    /** A pack bone's local value at a time (its rest value where it doesn't move). */
    const sample = (node: string, prop: "quaternion" | "position" | "scale", time: number, out4: number[]) => {
      const t = byTrack.get(`${node}.${prop}`);
      if (t) {
        const r = t.createInterpolant().evaluate(time);
        for (let i = 0; i < r.length; i++) out4[i] = r[i];
        if (prop === "quaternion") q2.fromArray(out4).normalize().toArray(out4);
        return;
      }
      const n = byName.get(node)!;
      (prop === "quaternion" ? n.quaternion : prop === "position" ? n.position : n.scale).toArray(out4);
    };
    const tracks: THREE.KeyframeTrack[] = [];
    for (const [boneKey, chain] of Object.entries(CHAINS)) {
      const bone = boneKey as VRMHumanBoneName;
      const target = vrm.humanoid.getNormalizedBoneNode(bone);
      const nodes = chain!.filter((c) => byName.has(c));
      if (!target || !nodes.length) continue;
      // every key time of any bone in the chain
      const times = [...new Set(nodes.flatMap((c) => [...(byTrack.get(`${c}.quaternion`)?.times ?? [])]))].sort((x, y) => x - y);
      if (!times.length) continue;
      const rests = nodes.map((c) => restOf(byName.get(c)!));
      const up = CHAINS_UP(bone);
      const before = up ? turnOf(up).clone().invert() : new THREE.Quaternion();
      const after = turnOf(bone);
      const tilt = ARMS_IN[bone] ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ARMS_IN[bone]!) : null;
      const vals = new Float32Array(times.length * 4);
      const tmp = [0, 0, 0, 1];
      times.forEach((time, i) => {
        const acc = new THREE.Quaternion();
        nodes.forEach((c, k) => {
          sample(c, "quaternion", time, tmp);
          q.fromArray(tmp).premultiply(rests[k].parent).multiply(rests[k].inv);
          acc.multiply(q);
        });
        acc.premultiply(before).multiply(after);
        if (tilt) acc.premultiply(tilt);
        acc.toArray(vals, i * 4);
      });
      tracks.push(new THREE.QuaternionKeyframeTrack(`${target.name}.quaternion`, times, vals));

      if (bone === "hips") {
        // where the hips are: the root's move and the hips' own, scaled to the anime body
        const hips = byName.get("hips")!;
        const root = byName.get("root");
        const restW = hips.getWorldPosition(new THREE.Vector3());
        const ptimes = [...new Set(["hips", "root"].flatMap((c) => [...(byTrack.get(`${c}.position`)?.times ?? [])]))].sort((x, y) => x - y);
        if (ptimes.length) {
          const pv = new Float32Array(ptimes.length * 3);
          const p3 = [0, 0, 0];
          const r4 = [0, 0, 0, 1];
          const s3 = [1, 1, 1];
          ptimes.forEach((time, i) => {
            sample("hips", "position", time, p3);
            const v = new THREE.Vector3().fromArray(p3);
            if (root) {
              const rp = [0, 0, 0];
              sample("root", "position", time, rp);
              sample("root", "quaternion", time, r4);
              sample("root", "scale", time, s3);
              m.compose(new THREE.Vector3().fromArray(rp), new THREE.Quaternion().fromArray(r4), new THREE.Vector3().fromArray(s3));
              v.applyMatrix4(m);
              if (root.parent) v.applyMatrix4(root.parent.matrixWorld);
            } else if (hips.parent) v.applyMatrix4(hips.parent.matrixWorld);
            v.sub(restW).multiplyScalar(ratio).add(vrmHipsRest);
            v.toArray(pv, i * 3);
          });
          tracks.push(new THREE.VectorKeyframeTrack(`${target.name}.position`, ptimes, pv));
        }
      }
    }
    out[name] = new THREE.AnimationClip(name, clip.duration, tracks);
  }
  clipCache.set(cacheKey, out);
  return out;
}

// ---------- the hero ----------

/** Builds the anime hero from a loaded model. */
function animeHero(vrm: VRM, look: Look, chibi: boolean): HeroModel | null {
  const clips = retarget(vrm);
  if (!clips) return null;
  dress(vrm, look);

  const root = new THREE.Group();
  const holder = new THREE.Group(); // the model, raised so the feet touch the ground
  root.add(holder);
  holder.add(vrm.scene);
  vrm.update(0);
  vrm.scene.updateMatrixWorld(true);

  // raw hand frames in the rest pose, for holding weapons the right way round
  const rawHandR = vrm.humanoid.getRawBoneNode("rightHand");
  const rawHandL = vrm.humanoid.getRawBoneNode("leftHand");
  const restQ = (n: THREE.Object3D | null) => (n ? n.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion());
  const handRestR = restQ(rawHandR);
  const handRestL = restQ(rawHandL);

  if (chibi && !BUILT_CHIBI.has(vrm.scene.userData.vrmFile)) {
    const foot = vrm.humanoid.getRawBoneNode("leftFoot");
    const before = foot ? foot.getWorldPosition(new THREE.Vector3()).y : 0;
    for (const [bone, s] of Object.entries(CHIBI_SCALE)) vrm.humanoid.getRawBoneNode(bone as VRMHumanBoneName)?.scale.setScalar(s!);
    vrm.scene.updateMatrixWorld(true);
    const after = foot ? foot.getWorldPosition(new THREE.Vector3()).y : 0;
    vrm.scene.position.y = before - after; // shorter legs: lower the body so the feet stay on the ground
  }
  // measure the (posed, maybe chibi) body and size it to the hero height
  vrm.scene.updateMatrixWorld(true);
  vrm.scene.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (sm.isSkinnedMesh) (sm as unknown as { boundingBox: THREE.Box3 | null }).boundingBox = null;
  });
  const box = new THREE.Box3().setFromObject(vrm.scene);
  holder.scale.setScalar(HEIGHT[chibi ? "Chibi" : "Default"] / Math.max(0.01, box.max.y - box.min.y));
  holder.position.y = -box.min.y * holder.scale.y;
  vrm.scene.updateMatrixWorld(true);
  root.updateMatrixWorld(true);

  // weapon slots in the hands: our weapons are built pointing down the arm (-y);
  // in a T-pose the fist points forward (+z), so the blade goes forward
  const slot = (raw: THREE.Object3D | null, restWorld: THREE.Quaternion) => {
    const g = new THREE.Group();
    g.userData.weapon = true;
    if (!raw) return g;
    const inv = restWorld.clone().invert();
    g.userData.inv = inv;
    const s = new THREE.Vector3();
    raw.getWorldScale(s);
    g.scale.setScalar(1.2 / Math.max(0.001, s.x));
    raw.add(g);
    return g;
  };
  const holdR = slot(rawHandR, handRestR);
  const holdL = slot(rawHandL, handRestL);
  // the same hold as the pack's heroes: the weapon points forward out of the fist
  const forward = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const aim = (g: THREE.Group) => {
    const inv = g.userData.inv as THREE.Quaternion | undefined;
    if (inv) g.quaternion.copy(inv).multiply(forward);
  };
  // bracelets are worn round the wrist: the ring's axis runs along the arm
  // (in the rest pose the arms point sideways, along x)
  const alongArm = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -Math.PI / 2));
  const wear = (g: THREE.Group) => {
    const inv = g.userData.inv as THREE.Quaternion | undefined;
    if (inv) g.quaternion.copy(inv).multiply(alongArm);
  };

  const mixer = new THREE.AnimationMixer(vrm.scene);
  const actions = new Map<string, THREE.AnimationAction>();
  const action = (name: string) => {
    let a = actions.get(name);
    if (!a) {
      const clip = clips[name];
      if (!clip) return null;
      a = mixer.clipAction(clip);
      actions.set(name, a);
    }
    return a;
  };
  let current: THREE.AnimationAction | null = null;
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
    } else a.timeScale = opts.speed ?? 1;
    return (a.getClip().duration / Math.max(0.01, a.timeScale)) * 1000;
  };

  let currentPose: HeroPose | "" = "";
  let lockedUntil = 0;
  let lastT = -1;
  let lastProg = 1;
  let swings = 0;
  let nextBlink = 0;
  const face = vrm.expressionManager;
  const here = new THREE.Vector3();
  const last = new THREE.Vector3();
  let placed = false;

  const model: HeroModel = {
    root,
    weapon: null,
    set(weapon, horn = false) {
      if (model.weapon === weapon && !!model.horn === horn) return;
      model.weapon = weapon;
      model.horn = horn;
      holdR.clear();
      holdL.clear();
      const band = weapon === "healing_bracelet" || weapon === "strength_bracelet";
      for (const g of [holdR, holdL]) (band ? wear : aim)(g);
      const w = horn ? makeHornWeapon(weapon, look.glow) : makeWeapon(weapon);
      for (const [hold, piece] of [
        [holdR, w.right],
        [holdL, w.left],
      ] as const) {
        if (!piece) continue;
        if (band) {
          // snug round the wrist joint (the ring is built a little forward of the fist)
          piece.scale.setScalar(0.42);
          piece.position.set(0, -0.06 * 0.42, 0);
        }
        hold.add(piece);
      }
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
    animate(pose, t, _walkT, progress) {
      const dt = lastT < 0 ? 0 : Math.min(0.1, Math.max(0, (t - lastT) / 1000));
      lastT = t;
      const weapon = model.weapon ?? "unarmed";
      const newAttack = pose === "attack" && (currentPose !== "attack" || progress < lastProg - 0.05);
      lastProg = pose === "attack" ? progress : 1;
      if (pose !== "dead" && currentPose === "dead") lockedUntil = 0;
      const urgent = pose === "dead" || pose === "hurt" || newAttack || (pose === "cast" && currentPose !== "cast");
      if (t >= lockedUntil || urgent) {
        if (pose === "dead") {
          if (currentPose !== "dead") play("Death_A", { once: true, fade: 0.15 });
          lockedUntil = Infinity;
        } else if (pose === "hurt") {
          if (currentPose !== "hurt") lockedUntil = t + play("Hit_A", { once: true, fade: 0.08, speed: 1.4, restart: true }) * 0.8;
        } else if (newAttack) {
          swings++;
          lockedUntil = t + play(attackClip(weapon, swings % 2 === 0), { once: true, fade: 0.06, speed: WEAPON_LOOK[weapon] === "shoot" ? 1.6 : 1.8, restart: true }) * 0.85;
        } else if (pose === "cast") {
          if (currentPose !== "cast") lockedUntil = t + play("Spellcast_Raise", { once: true, fade: 0.1, speed: 1.5, restart: true }) * 0.9;
        } else if (pose === "block") play("Blocking", { fade: 0.1 });
        else if (pose === "jump" || pose === "fall") play("Jump_Idle", { fade: 0.15 });
        else if (pose === "walk") play("Running_A", { fade: 0.18, speed: 1.05 });
        else play(weapon === "unarmed" ? "Unarmed_Idle" : "Idle", { fade: 0.25 });
        if (pose !== "attack" || newAttack) currentPose = pose;
      }
      if (pose === "dead") currentPose = "dead";
      mixer.update(dt);
      // the face: a soft smile, a wince when hit, closed eyes when down, and a blink now and then
      if (face) {
        face.setValue("happy", pose === "hurt" || pose === "dead" ? 0 : 0.3);
        face.setValue("sad", pose === "hurt" ? 0.7 : 0);
        if (!nextBlink) nextBlink = t + 1500;
        const bt = t - nextBlink;
        const blink = pose === "dead" ? 1 : bt > 0 && bt < 150 ? Math.sin((bt / 150) * Math.PI) : 0;
        face.setValue("blink", blink);
        if (bt >= 150) nextBlink = t + 2200 + Math.random() * 2600;
      }
      vrm.update(dt);
      // the swinging hair works in the world: when the hero first appears or jumps
      // to a new place (a new map, a respawn), it starts again at rest instead of whipping
      root.getWorldPosition(here);
      if (!placed || here.distanceTo(last) > 4) vrm.springBoneManager?.reset();
      placed = true;
      last.copy(here);
    },
    dispose() {
      mixer.stopAllAction();
      VRMUtils.deepDispose(vrm.scene);
    },
  };
  return model;
}

/**
 * An anime hero (Default or Chibi style). It shows the Block hero until the model
 * and the moves have loaded, then swaps; `version` goes up when it does.
 */
export function makeVroidHero(look: Look): HeroModel {
  const chibi = look.style === "Chibi";
  const root = new THREE.Group();
  root.userData.ownsMaterials = true; // each anime hero has its own copy of the model
  let inner: HeroModel = makeRiggedHero(look) ?? makeHero(look);
  root.add(inner.root);
  let weapon: { w: WeaponType; horn: boolean } | null = null;
  let gone = false;
  let ready = false;

  const swapToRigged = () => {
    if (ready || gone) return;
    const r = makeRiggedHero(look);
    if (!r) return;
    root.remove(inner.root);
    inner = r;
    root.add(r.root);
    if (weapon) r.set(weapon.w, weapon.horn);
    model.version = (model.version ?? 0) + 1;
  };
  const offPack = onPackReady(swapToRigged);

  void loadPack().then(async () => {
    const vrm = await loadHeroVrm();
    if (!vrm || gone) return;
    const anime = animeHero(vrm, look, chibi);
    if (!anime || gone) {
      VRMUtils.deepDispose(vrm.scene);
      return;
    }
    root.remove(inner.root);
    inner = anime;
    ready = true;
    root.add(anime.root);
    if (weapon) anime.set(weapon.w, weapon.horn);
    model.version = (model.version ?? 0) + 1;
  });

  const model: HeroModel = {
    root,
    weapon: null,
    version: 0,
    set(w, horn = false) {
      weapon = { w, horn };
      model.weapon = w;
      model.horn = horn;
      inner.set(w, horn);
    },
    animate(pose, t, walkT, progress) {
      inner.animate(pose, t, walkT, progress);
    },
    dispose() {
      gone = true;
      offPack();
      inner.dispose?.();
    },
  };
  return model;
}

/** Starts downloading the anime model early (for the create screen and the game). */
export function preloadVroid() {
  void fileBytes(HERO);
}
