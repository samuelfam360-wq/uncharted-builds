// Horn Rabbit weapons: the Special grade weapon made from the Horned Rabbit's horn.
// One design for every weapon type, built from the same parts: a spiral ivory horn,
// a leather grip, a ruff of rabbit fur, and one ring that glows in the hero's colour.
// Each is laid out in the hand the same way as the ordinary weapon in models.ts.

import * as THREE from "three";
import type { WeaponType } from "@/lib/game/types";
import { toon } from "./models";

type Held = { right?: THREE.Object3D; left?: THREE.Object3D };

interface Kit {
  horn: THREE.MeshToonMaterial;
  bone: THREE.Material;
  leather: THREE.Material;
  strap: THREE.Material;
  fur: THREE.Material;
  furTip: THREE.Material;
  wood: THREE.Material;
  hide: THREE.Material;
  string: THREE.Material;
  glow: THREE.Material;
  light: THREE.Material;
}

let hornMat: THREE.MeshToonMaterial | null = null;

function kit(glow: string): Kit {
  if (!hornMat) hornMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toon("#ffffff").gradientMap });
  const c = new THREE.Color(glow);
  return {
    horn: hornMat,
    bone: toon("#efe3c6"),
    leather: toon("#7a4a2a"),
    strap: toon("#4f2d18"),
    fur: toon("#fbf3e6"),
    furTip: toon("#e8b07a"),
    wood: toon("#8a5a34"),
    hide: toon("#b98a5c"),
    string: toon("#f3ead8"),
    // brighter than white, so the bloom picks the ring out
    glow: new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(1.6) }),
    light: new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(2) }),
  };
}

const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => new THREE.Mesh(g, m);
function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}

const hornGeos = new Map<string, THREE.BufferGeometry>();

/**
 * A rabbit horn: thick at y = 0, growing along +y, curling toward +x and tapering
 * to a point, with a ridge that winds round it like a screw. flat < 1 squeezes it into a blade.
 */
function horn(k: Kit, len: number, r0: number, o: { bend?: number; turns?: number; flat?: number; tip?: number; ridge?: number } = {}) {
  const { bend = 0.25, turns = 5, flat = 1, tip = 0.004, ridge = 0.13 } = o;
  const key = [len, r0, bend, turns, flat, tip, ridge].join("|");
  let g = hornGeos.get(key);
  if (!g) {
    const N = 28;
    const R = 12;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const base = new THREE.Color("#dcc091");
    const mid = new THREE.Color("#fbeed0");
    const end = new THREE.Color("#ffffff");
    const c = new THREE.Color();
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const cx = bend * len * t * t;
      const cy = len * t;
      // the way the horn is heading here, and the direction across it
      const tx = 2 * bend * t;
      const l = Math.hypot(tx, 1);
      const nx = 1 / l;
      const ny = -tx / l;
      const r = r0 * Math.pow(1 - t, 0.75) + tip;
      for (let j = 0; j < R; j++) {
        const a = (j / R) * Math.PI * 2;
        const wind = turns * Math.PI * 2 * t + a;
        const swell = 1 + ridge * Math.sin(wind) * (1 - t * 0.6);
        const u = Math.cos(a) * r * swell;
        const w = Math.sin(a) * r * swell * flat;
        pos.push(cx + nx * u, cy + ny * u, w);
        if (t < 0.5) c.copy(base).lerp(mid, t * 2);
        else c.copy(mid).lerp(end, (t - 0.5) * 2);
        c.multiplyScalar(0.78 + 0.22 * (0.5 + 0.5 * Math.sin(wind)));
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < N; i++)
      for (let j = 0; j < R; j++) {
        const a = i * R + j;
        const b = i * R + ((j + 1) % R);
        idx.push(a, a + R, b, b, a + R, b + R);
      }
    g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    hornGeos.set(key, g);
  }
  return mesh(g, k.horn);
}

/** A little ruff of rabbit fur round the join. */
function tuft(k: Kit, r: number, n = 9, size = 0.035) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const s = size * (0.85 + ((i * 7) % 5) * 0.07);
    const b = mesh(new THREE.IcosahedronGeometry(s, 1), i % 3 === 0 ? k.furTip : k.fur);
    b.position.set(Math.cos(a) * r, ((i % 2) - 0.5) * size * 0.7, Math.sin(a) * r);
    b.scale.y = 1.25;
    g.add(b);
  }
  return g;
}

/** A leather-wrapped grip along y, centred at 0. */
function grip(k: Kit, len: number, r: number) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(r, r, len, 10), k.leather));
  const n = Math.max(2, Math.round(len / 0.035));
  for (let i = 0; i < n; i++) {
    const band = mesh(new THREE.TorusGeometry(r * 1.04, r * 0.16, 6, 12), k.strap);
    band.rotation.x = Math.PI / 2;
    band.rotation.z = 0.25;
    band.position.y = -len / 2 + ((i + 0.5) / n) * len;
    g.add(band);
  }
  return g;
}

/** The glowing ring that marks every Horn Rabbit weapon. */
function ring(k: Kit, r: number, thick = 0.008) {
  const m = mesh(new THREE.TorusGeometry(r, thick, 8, 24), k.glow);
  m.rotation.x = Math.PI / 2;
  return m;
}
const knob = (k: Kit, r: number) => mesh(new THREE.IcosahedronGeometry(r, 1), k.bone);

/** Turn a part that was built pointing up so that it points down the arm, as held blades do. */
function down(part: THREE.Object3D, y: number, scale = 1) {
  const g = new THREE.Group();
  part.rotation.z = Math.PI;
  part.position.y = y;
  g.add(part);
  g.scale.setScalar(scale);
  return g;
}

function dagger(k: Kit, side: number) {
  const d = new THREE.Group();
  d.add(at(horn(k, 0.3, 0.036, { bend: 0.3 * side, turns: 4, flat: 0.45 }), 0, 0.015, 0));
  d.add(at(tuft(k, 0.034, 8, 0.024), 0, 0, 0));
  d.add(at(ring(k, 0.033, 0.006), 0, 0.03, 0));
  d.add(at(grip(k, 0.1, 0.017), 0, -0.065, 0));
  d.add(at(knob(k, 0.024), 0, -0.125, 0));
  return d;
}

function bracelet(k: Kit, healing: boolean) {
  const b = new THREE.Group();
  const band = mesh(new THREE.TorusGeometry(0.1, 0.026, 10, 28), k.bone);
  band.rotation.x = Math.PI / 2;
  b.add(band);
  const line = mesh(new THREE.TorusGeometry(0.127, 0.006, 8, 28), k.glow);
  line.rotation.x = Math.PI / 2;
  b.add(line);
  if (healing) {
    // gentle: one small curled horn holding a light, and a fur trim
    b.add(at(horn(k, 0.11, 0.024, { bend: 0.6, turns: 3 }), 0.1, 0.01, 0));
    b.add(at(mesh(new THREE.IcosahedronGeometry(0.022, 1), k.light), 0.185, 0.085, 0));
    b.add(at(tuft(k, 0.1, 14, 0.022), 0, -0.03, 0));
  } else {
    // fierce: a row of horn spikes over the knuckles
    for (let i = -2; i <= 2; i++) {
      const a = i * 0.42;
      const h = horn(k, 0.1 - Math.abs(i) * 0.012, 0.024, { bend: 0.1, turns: 3 });
      h.rotation.z = -Math.PI / 2;
      h.rotation.y = -a;
      h.position.set(Math.cos(a) * 0.11, 0, Math.sin(a) * 0.11);
      b.add(h);
    }
    b.add(at(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 20, 1, true), k.leather), 0, -0.04, 0));
  }
  const g = new THREE.Group();
  g.add(b);
  g.scale.setScalar(0.7);
  g.position.y = 0.06;
  return g;
}

/** The Horn Rabbit version of a weapon, ready for the hands. Empty for bare fists. */
export function makeHornWeapon(w: WeaponType, glow = "#ffd9a0"): Held {
  const k = kit(glow);
  switch (w) {
    case "sword": {
      const s = new THREE.Group();
      s.add(at(horn(k, 0.62, 0.07, { bend: 0.18, turns: 6, flat: 0.4 }), 0, 0.02, 0));
      s.add(at(tuft(k, 0.055, 10, 0.03), 0, 0, 0));
      s.add(at(ring(k, 0.06), 0, 0.05, 0));
      s.add(at(grip(k, 0.15, 0.022), 0, -0.1, 0));
      s.add(at(knob(k, 0.032), 0, -0.19, 0));
      return { right: down(s, -0.07, 0.85) };
    }
    case "daggers":
      return { right: down(dagger(k, 1), -0.04, 0.9), left: down(dagger(k, -1), -0.04, 0.9) };
    case "hammer": {
      const h = new THREE.Group();
      h.add(at(grip(k, 0.5, 0.024), 0, -0.1, 0));
      h.add(at(knob(k, 0.034), 0, -0.36, 0));
      // the head: two thick horn stumps, back to back, lashed to the shaft
      const head = new THREE.Group();
      for (const dir of [1, -1]) {
        const stump = horn(k, 0.2, 0.085, { bend: 0.1, turns: 4, tip: 0.055, ridge: 0.07 });
        stump.rotation.z = (-Math.PI / 2) * dir;
        stump.position.x = 0.02 * dir;
        head.add(stump);
      }
      const core = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.07, 14), k.leather);
      core.rotation.z = Math.PI / 2;
      head.add(core);
      for (const x of [-0.045, 0.045]) {
        const r = mesh(new THREE.TorusGeometry(0.092, 0.009, 8, 24), k.glow);
        r.rotation.y = Math.PI / 2;
        r.position.x = x;
        head.add(r);
      }
      head.position.y = 0.2;
      h.add(head);
      h.add(at(tuft(k, 0.035, 8, 0.028), 0, 0.1, 0));
      return { right: down(h, -0.2) };
    }
    case "lance": {
      const l = new THREE.Group();
      l.add(at(mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.7, 8), k.wood), 0, -0.15, 0));
      l.add(at(grip(k, 0.16, 0.025), 0, -0.3, 0));
      // one long, straight, tightly wound horn
      l.add(at(horn(k, 0.55, 0.06, { bend: 0, turns: 9, ridge: 0.14 }), 0, 0.2, 0));
      l.add(at(tuft(k, 0.05, 10, 0.036), 0, 0.19, 0));
      l.add(at(ring(k, 0.048), 0, 0.235, 0));
      l.add(at(knob(k, 0.03), 0, -0.51, 0));
      const g = down(l, -0.15);
      g.rotation.x = -Math.PI / 2;
      return { right: g };
    }
    case "large_shield": {
      const s = new THREE.Group();
      const face = mesh(new THREE.SphereGeometry(0.6, 24, 8, 0, Math.PI * 2, 0, 0.5), k.hide);
      face.rotation.x = Math.PI / 2;
      face.position.z = -0.5;
      s.add(face);
      s.add(at(mesh(new THREE.TorusGeometry(0.288, 0.024, 8, 32), k.bone), 0, 0, 0.025));
      s.add(at(mesh(new THREE.TorusGeometry(0.25, 0.007, 8, 32), k.glow), 0, 0, 0.045));
      // a horn boss in the middle, and six small horns round the rim
      const boss = horn(k, 0.2, 0.06, { bend: 0.2, turns: 4 });
      boss.rotation.x = Math.PI / 2;
      boss.position.z = 0.09;
      s.add(boss);
      const collar = tuft(k, 0.06, 10, 0.03);
      collar.rotation.x = Math.PI / 2;
      collar.position.z = 0.1;
      s.add(collar);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const h = horn(k, 0.1, 0.026, { bend: 0.25, turns: 3 });
        h.rotation.z = a - Math.PI / 2;
        h.position.set(Math.cos(a) * 0.29, Math.sin(a) * 0.29, 0.02);
        s.add(h);
      }
      s.scale.setScalar(0.72);
      s.position.set(0, -0.05, 0.07);
      const g = new THREE.Group();
      g.add(s);
      return { left: g };
    }
    case "bow": {
      const b = new THREE.Group();
      // two horns for limbs, as real horn bows are made
      const up = horn(k, 0.42, 0.034, { bend: 0.5, turns: 5, flat: 0.7 });
      up.position.y = 0.07;
      const dn = horn(k, 0.42, 0.034, { bend: 0.5, turns: 5, flat: 0.7 });
      dn.scale.y = -1;
      dn.position.y = -0.07;
      b.add(up, dn);
      b.add(grip(k, 0.16, 0.026));
      b.add(at(ring(k, 0.034, 0.006), 0, 0.085, 0));
      b.add(at(ring(k, 0.034, 0.006), 0, -0.085, 0));
      b.add(at(mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.98, 4), k.string), 0.21, 0, 0));
      b.add(at(tuft(k, 0.012, 5, 0.018), 0.21, 0.3, 0));
      // the belly of the bow faces forward, the string toward you
      b.rotation.y = Math.PI / 2;
      b.scale.setScalar(0.62);
      b.position.set(0, -0.05, 0.05);
      const g = new THREE.Group();
      g.add(b);
      return { left: g };
    }
    case "pistol": {
      const p = new THREE.Group();
      // the barrel is a horn laid on its side, hollowed at the thick end
      const barrel = horn(k, 0.36, 0.05, { bend: 0.1, turns: 4, tip: 0.03 });
      barrel.rotation.z = -Math.PI / 2;
      barrel.position.set(-0.12, 0.05, 0);
      p.add(barrel);
      const muzzle = mesh(new THREE.TorusGeometry(0.03, 0.008, 8, 20), k.glow);
      muzzle.rotation.y = Math.PI / 2;
      muzzle.position.set(0.245, 0.016, 0);
      p.add(muzzle);
      p.add(at(mesh(new THREE.BoxGeometry(0.16, 0.07, 0.06), k.leather), -0.1, 0.02, 0));
      const handle = grip(k, 0.17, 0.027);
      handle.rotation.z = 0.35;
      handle.position.set(-0.15, -0.09, 0);
      p.add(handle);
      const guard = mesh(new THREE.TorusGeometry(0.035, 0.007, 6, 16, Math.PI), k.bone);
      guard.rotation.z = Math.PI;
      guard.position.set(-0.06, -0.02, 0);
      p.add(guard);
      const fur = tuft(k, 0.045, 8, 0.016);
      fur.rotation.z = Math.PI / 2;
      fur.position.set(-0.115, 0.05, 0);
      p.add(fur);
      // the barrel points forward from the hand
      p.rotation.y = -Math.PI / 2;
      p.position.set(0, 0.07, 0.17);
      const g = new THREE.Group();
      g.add(p);
      g.scale.setScalar(0.8);
      return { right: g };
    }
    case "staff": {
      const s = new THREE.Group();
      s.add(at(mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.7, 8), k.wood), 0, 0.02, 0));
      s.add(at(grip(k, 0.2, 0.029), 0, -0.1, 0));
      // two horns curl round a light at the top
      const l = horn(k, 0.38, 0.05, { bend: 0.75, turns: 5 });
      l.position.set(-0.03, 0.36, 0);
      l.rotation.z = 0.8;
      const r = horn(k, 0.38, 0.05, { bend: -0.75, turns: 5 });
      r.position.set(0.03, 0.36, 0);
      r.rotation.z = -0.8;
      s.add(l, r);
      s.add(at(mesh(new THREE.IcosahedronGeometry(0.07, 2), k.light), 0, 0.55, 0));
      s.add(at(tuft(k, 0.045, 9, 0.03), 0, 0.37, 0));
      s.add(at(knob(k, 0.032), 0, -0.34, 0));
      s.position.y = -0.05;
      s.scale.setScalar(0.9);
      const g = new THREE.Group();
      g.add(s);
      return { right: g };
    }
    case "tamer_wand": {
      const s = new THREE.Group();
      s.add(at(grip(k, 0.2, 0.018), 0, -0.14, 0));
      s.add(at(horn(k, 0.3, 0.03, { bend: 0.35, turns: 5 }), 0, -0.03, 0));
      s.add(at(tuft(k, 0.03, 8, 0.024), 0, -0.035, 0));
      s.add(at(ring(k, 0.03, 0.006), 0, 0, 0));
      s.add(at(mesh(new THREE.IcosahedronGeometry(0.028, 1), k.light), 0.105, 0.285, 0));
      // a rabbit-tail charm hanging from the end
      s.add(at(mesh(new THREE.IcosahedronGeometry(0.04, 1), k.fur), 0, -0.29, 0));
      s.add(at(mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.04, 4), k.string), 0, -0.25, 0));
      s.position.y = 0.12;
      const g = new THREE.Group();
      g.add(s);
      return { right: g };
    }
    case "healing_bracelet":
      return { right: bracelet(k, true), left: bracelet(k, true) };
    case "strength_bracelet":
      return { right: bracelet(k, false), left: bracelet(k, false) };
    default:
      return {};
  }
}
