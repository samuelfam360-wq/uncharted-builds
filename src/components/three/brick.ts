// The "Brick" body style: a toy hero snapped together from plastic bricks,
// with round studs on top, a printed face and the hero's neon glow on the trims.
// Our own design; it moves with the same poses as the code-built hero.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Look } from "../side/hero";
import { makeHornWeapon } from "./hornWeapons";
import { animateRig, makeWeapon, piece, type HeroModel } from "./models";

const geoCache = new Map<string, THREE.BufferGeometry>();
const brickGeo = (w: number, h: number, d: number) => {
  const key = `${w}|${h}|${d}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.12);
    geoCache.set(key, g);
  }
  return g;
};
const STUD = new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16);

/** Shiny plastic with a soft edge light in the glow colour. */
function plastic(color: string, glow?: string, rim = 0.45) {
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.2 });
  if (glow) {
    const rc = new THREE.Color(glow);
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uRim = { value: rc };
      sh.fragmentShader =
        "uniform vec3 uRim;\n" +
        sh.fragmentShader.replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
          { float f = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
            totalEmissiveRadiance += uRim * smoothstep(0.6, 1.0, f) * ${rim.toFixed(2)}; }`,
        );
    };
    m.customProgramCacheKey = () => `brick-rim-${rim}`;
  }
  return m;
}
const neon = (glow: string) => new THREE.MeshBasicMaterial({ color: new THREE.Color(glow).multiplyScalar(1.6), toneMapped: false });

const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number) => {
  o.position.set(x, y, z);
  return o;
};
const brick = (w: number, h: number, d: number, m: THREE.Material) => piece(brickGeo(w, h, d), m);
function studs(parent: THREE.Object3D, m: THREE.Material, y: number, spots: [number, number][]) {
  for (const [x, z] of spots) parent.add(at(piece(STUD, m, { outline: false }), x, y, z));
}

/** The printed face: round shiny eyes, rosy cheeks and a smile. */
function faceTexture(eyes: string): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  for (const x of [84, 172]) {
    g.fillStyle = "#1f1a2e";
    g.beginPath();
    g.ellipse(x, 118, 22, 28, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = eyes;
    g.beginPath();
    g.ellipse(x, 128, 14, 15, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(x - 7, 106, 8, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(x + 8, 134, 4, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "rgba(255,120,140,0.55)";
  for (const x of [58, 198]) {
    g.beginPath();
    g.ellipse(x, 160, 20, 11, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = "#1f1a2e";
  g.lineWidth = 7;
  g.lineCap = "round";
  g.beginPath();
  g.arc(128, 160, 22, 0.2 * Math.PI, 0.8 * Math.PI);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const darker = (hex: string, k: number) => "#" + new THREE.Color(hex).lerp(new THREE.Color("#000000"), k).getHexString();

export function makeBrickHero(L: Look): HeroModel {
  const glow = L.glow ?? "#ffffff";
  const root = new THREE.Group();
  root.userData.ownsMaterials = true; // its materials are its own (the game can fade them)
  const body = new THREE.Group();
  root.add(body);
  const skin = plastic(L.skin, glow, 0.25);
  const shirt = plastic(darker(L.shirt, 0.45), glow);
  const pants = plastic(darker(L.shirt, 0.72), glow);
  const hair = plastic(L.hair, glow, 0.35);
  const trim = neon(glow);

  // legs: one brick each, with a longer foot
  const legL = new THREE.Group();
  const legR = new THREE.Group();
  for (const [g, x] of [
    [legL, 0.09],
    [legR, -0.09],
  ] as const) {
    g.position.set(x, 0.4, 0);
    g.add(at(brick(0.16, 0.32, 0.19, pants), 0, -0.16, 0));
    g.add(at(brick(0.16, 0.08, 0.24, pants), 0, -0.36, 0.025));
    g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.165, 0.018, 0.195), trim), 0, -0.29, 0));
    body.add(g);
  }
  // hips, torso and the glowing belt
  body.add(at(brick(0.36, 0.08, 0.2, pants), 0, 0.42, 0));
  const torso = brick(0.38, 0.32, 0.21, shirt);
  body.add(at(torso, 0, 0.62, 0));
  body.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.385, 0.026, 0.215), trim), 0, 0.475, 0));
  body.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.2, 0.012), trim), 0, 0.64, 0.108));
  studs(body, shirt, 0.795, [
    [0.13, 0.05],
    [0.13, -0.05],
    [-0.13, 0.05],
    [-0.13, -0.05],
  ]);
  if (L.female) body.add(at(brick(0.3, 0.06, 0.06, shirt), 0, 0.66, 0.12));

  // arms (pivot at the shoulder) with a square hand
  const armL = new THREE.Group();
  const armR = new THREE.Group();
  for (const [g, x] of [
    [armL, 0.25],
    [armR, -0.25],
  ] as const) {
    g.position.set(x, 0.74, 0);
    g.add(at(brick(0.11, 0.24, 0.13, shirt), 0, -0.1, 0));
    g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.02, 0.135), trim), 0, -0.2, 0));
    g.add(at(brick(0.1, 0.08, 0.11, skin), 0, -0.26, 0.01));
    body.add(g);
  }

  // head: a square brick with a printed face, hair on top with studs
  const head = new THREE.Group();
  head.position.set(0, 0.97, 0);
  body.add(head);
  head.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 12), skin), 0, -0.17, 0));
  head.add(brick(0.3, 0.28, 0.28, skin));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.27), new THREE.MeshBasicMaterial({ map: faceTexture(L.eyes), transparent: true, depthWrite: false }));
  face.position.z = 0.141;
  face.userData.detail = true;
  head.add(face);
  const hs = L.hairStyle;
  if (hs !== "Shaved") {
    head.add(at(brick(0.33, 0.09, 0.31, hair), 0, 0.17, -0.005));
    head.add(at(brick(0.33, 0.06, 0.05, hair), 0, 0.115, 0.135)); // fringe
    const backLen = hs === "Long" || hs === "Braided" ? 0.42 : hs === "Medium" || L.female ? 0.28 : 0.2;
    head.add(at(brick(0.33, backLen, 0.06, hair), 0, 0.2 - backLen / 2, -0.15));
    for (const s of [1, -1]) head.add(at(brick(0.04, 0.18, 0.28, hair), s * 0.16, 0.08, -0.01));
    if (hs === "Ponytail") head.add(at(brick(0.08, 0.26, 0.08, hair), 0, 0.02, -0.22));
    if (hs === "Spiky")
      for (const [x, z] of [
        [0.09, 0.07],
        [-0.09, 0.07],
        [0, -0.06],
      ])
        head.add(at(piece(new THREE.ConeGeometry(0.06, 0.14, 4), hair), x, 0.28, z));
    studs(head, hair, 0.23, [
      [0.08, 0.08],
      [-0.08, 0.08],
      [0.08, -0.08],
      [-0.08, -0.08],
    ]);
  } else {
    studs(head, skin, 0.155, [[0, 0]]);
  }

  // weapon slots in the hands
  const handR = new THREE.Group();
  handR.position.set(0, -0.27, 0.02);
  armR.add(handR);
  const handL = new THREE.Group();
  handL.position.set(0, -0.27, 0.02);
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
    dispose() {
      root.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (m && !o.userData.outline) m.dispose();
      });
    },
  };
  return model;
}
