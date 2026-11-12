// Draws the 3D game with three.js: the map, the player, monsters, pets, shots,
// effects, and a camera that follows behind you. Floating numbers, HP bars and
// labels are drawn on a flat canvas laid over the 3D view.
// Reads the engine's state each frame; never changes it.

import * as THREE from "three";
import { MONSTERS } from "@/lib/game/data/world";
import { TILE3, type Map3D } from "@/lib/game/data/maps3d";
import type { Look } from "../side/hero";
import { loadPack, makeRiggedHero, onPackReady, packReady } from "./rigged";
import { MONSTER_LOOKS } from "../side/sprites";
import { WEAPON_FEEL, type Engine3D, type Monster, type PetUnit } from "./engine3d";
import {
  U,
  makeBuilding,
  makeBush,
  makeCrystal,
  makeFence,
  makeFlower,
  makeHero,
  makeLamp,
  makeMonster,
  makeMushroom,
  makeReed,
  makeRock,
  makeSignPost,
  makeTorch,
  makeTree,
  makeWell,
  bodySpecies,
  piece,
  toon,
  type HeroModel,
  type HeroPose,
  type MonsterModel,
} from "./models";

const PLAYER_H = 82;

/** Turn a game position into a scene position. Game y is up-negative. */
const toScene = (x: number, y: number, z: number, out = new THREE.Vector3()) => out.set(x * U, -y * U, z * U);

/** Give a model materials of its own (so it can fade or tint) and return them. */
/** The animated pack character when it has loaded, else the code-built one. */
function heroFor(look: Look): HeroModel {
  return makeRiggedHero(look) ?? makeHero(look);
}

function ownMaterials(root: THREE.Object3D): THREE.MeshToonMaterial[] {
  const out: THREE.MeshToonMaterial[] = [];
  const seen = new Map<THREE.Material, THREE.MeshToonMaterial>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.outline) return;
    const mat = m.material as THREE.MeshToonMaterial;
    if (!(mat instanceof THREE.MeshToonMaterial)) return;
    let c = seen.get(mat);
    if (!c) {
      c = mat.clone();
      seen.set(mat, c);
      out.push(c);
    }
    m.material = c;
  });
  return out;
}

function setOutlines(root: THREE.Object3D, on: boolean) {
  root.traverse((o) => {
    if (o.userData.outline) o.visible = on;
  });
}

interface MonsterView {
  model: MonsterModel;
  shadow: THREE.Mesh;
  species: string;
}

export interface DrawInfo {
  look: Look;
  name: string;
  npcLooks: Record<string, Look>;
}

export class World3D {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
  /** Camera angle around the player, and how far it looks down. Changed by the mouse / touch drag. */
  camYaw = Math.PI / 2;
  camPitch = 0.36;
  camDist = 6.6;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camReady = false;
  private mapGroup = new THREE.Group();
  private dyn = new THREE.Group();
  private mapId = "";
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private glow: THREE.PointLight;
  private sky: THREE.Mesh;
  private hero: HeroModel | null = null;
  private heroMats: THREE.MeshToonMaterial[] = [];
  private heroShadow: THREE.Mesh;
  private heroLook = "";
  private npcs: { model: HeroModel; x: number; z: number; id: string }[] = [];
  private monsters = new Map<number, MonsterView>();
  private pets = new Map<string, MonsterView>();
  private clones: { model: HeroModel; mats: THREE.MeshToonMaterial[] }[] = [];
  private shots: Record<string, THREE.Mesh[]> = {};
  private fxPool: Record<string, { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }[]> = {};
  private gates: { x: number; mesh: THREE.Object3D }[] = [];
  private exitPortals: THREE.Object3D[] = [];
  private swampBubbles: THREE.InstancedMesh | null = null;
  private grassMat: THREE.MeshToonMaterial | null = null;
  private grassTime = { value: 0 };
  private portalSpin: THREE.Object3D[] = [];
  /** Big things (trees, houses) that hide when they'd block the camera's view of you. */
  private occluders: { obj: THREE.Object3D; x: number; z: number; r: number }[] = [];
  private overlay: CanvasRenderingContext2D;
  private tmp = new THREE.Vector3();
  private npcsStale = false;
  private heroBody: string | undefined;
  private offPack: () => void;

  constructor(
    private canvas: HTMLCanvasElement,
    private overlayCanvas: HTMLCanvasElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.overlay = overlayCanvas.getContext("2d")!;
    // the animated characters: until they load, the simple code-built ones are shown
    void loadPack();
    this.offPack = onPackReady(() => {
      this.heroLook = "";
      this.npcsStale = true;
      for (const c of this.clones) this.dyn.remove(c.model.root);
      this.clones = [];
    });

    this.hemi = new THREE.HemisphereLight("#d8efff", "#86a86a", 1.5);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight("#fff4de", 2.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -16;
    sc.right = 16;
    sc.top = 16;
    sc.bottom = -16;
    sc.near = 1;
    sc.far = 60;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    this.glow = new THREE.PointLight("#ffcf8a", 0, 9, 1.4);
    this.scene.add(this.glow);

    // sky: a soft gradient dome
    const skyMat = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color("#5fb8ff") }, bottom: { value: new THREE.Color("#e9f7ff") } },
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y * 1.6 + 0.1, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), skyMat);
    this.scene.add(this.sky);
    this.heroShadow = this.blobShadow(0.32);
    this.scene.add(this.mapGroup, this.dyn, this.heroShadow);
  }

  private blobShadow(r: number) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 20), new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.18, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 1;
    return m;
  }

  resize(w: number, h: number, dpr: number) {
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.overlayCanvas.width = Math.round(w * dpr);
    this.overlayCanvas.height = Math.round(h * dpr);
  }

  // ---------- building a map ----------

  private disposeGroup(g: THREE.Object3D) {
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.userData.dispose) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    g.clear();
  }

  buildMap(m: Map3D) {
    this.mapId = m.id;
    this.disposeGroup(this.mapGroup);
    this.gates = [];
    this.exitPortals = [];
    this.portalSpin = [];
    this.occluders = [];
    this.swampBubbles = null;
    for (const v of this.monsters.values()) this.dyn.remove(v.model.root, v.shadow);
    this.monsters.clear();
    const cave = m.terrain === "stone";
    const W = m.w;
    const D = m.d;
    const g = this.mapGroup;

    // light and air
    const skyMat = this.sky.material as THREE.ShaderMaterial;
    if (cave) {
      this.scene.background = new THREE.Color("#1d1830");
      this.scene.fog = new THREE.Fog("#1d1830", 8, 34);
      this.sky.visible = false;
      this.hemi.color.set("#9a8cff");
      this.hemi.groundColor.set("#2a3a3a");
      this.hemi.intensity = 1.2;
      this.sun.intensity = 0.7;
      this.sun.color.set("#b8a8ff");
      this.glow.intensity = 6;
    } else {
      this.scene.background = null;
      this.scene.fog = new THREE.Fog("#dff2ff", 30, 90);
      this.sky.visible = true;
      skyMat.uniforms.top.value.set("#5fb8ff");
      skyMat.uniforms.bottom.value.set("#e9f7ff");
      this.hemi.color.set("#d8efff");
      this.hemi.groundColor.set("#86a86a");
      this.hemi.intensity = 1.5;
      this.sun.intensity = 2.0;
      this.sun.color.set("#fff4de");
      this.glow.intensity = 0;
    }

    // the ground, with gentle colour patches
    const pad = cave ? 0 : 30;
    const geo = new THREE.PlaneGeometry(W + pad * 2, D + pad * 2, Math.round((W + pad * 2) / 2), Math.round((D + pad * 2) / 2));
    geo.rotateX(-Math.PI / 2);
    geo.translate(W / 2, 0, D / 2);
    const colors: number[] = [];
    const base = new THREE.Color(cave ? "#4a4560" : "#8fd36a");
    const alt = new THREE.Color(cave ? "#3c3a52" : "#a6e07a");
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const n = Math.sin(x * 0.35) * Math.cos(z * 0.3) + Math.sin(x * 0.11 + z * 0.17) * 0.6;
      const c = base.clone().lerp(alt, (n + 1.6) / 3.2);
      // outside the playable area the ground rises into hills
      if (!cave) {
        const out = Math.max(0, -x, x - W, -z, z - D);
        if (out > 0) pos.setY(i, Math.min(6, Math.pow(out / 6, 1.6) * 2) * (0.7 + 0.3 * Math.sin(x * 0.4 + z * 0.3)));
      }
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const groundMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: (toon("#ffffff").gradientMap as THREE.Texture) ?? null });
    const ground = new THREE.Mesh(geo, groundMat);
    ground.receiveShadow = true;
    ground.userData.dispose = true;
    g.add(ground);

    // paths
    for (const path of m.paths) {
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const seg = new THREE.Mesh(new THREE.PlaneGeometry(1.6, len + 1.4), new THREE.MeshToonMaterial({ color: "#e6cf98", gradientMap: toon("#fff").gradientMap }));
        seg.userData.dispose = true;
        seg.rotation.x = -Math.PI / 2;
        seg.rotation.z = -Math.atan2(b.x - a.x, b.z - a.z);
        seg.position.set((a.x + b.x) / 2, 0.012 + i * 0.0005, (a.z + b.z) / 2);
        seg.receiveShadow = true;
        g.add(seg);
      }
    }

    // grass tufts that sway
    if (!cave) this.addGrass(m);

    // poison swamp
    for (const c of m.swamp) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(c.r, 40), new THREE.MeshToonMaterial({ color: "#7b5aa6", gradientMap: toon("#fff").gradientMap, emissive: "#3a1f5a", emissiveIntensity: 0.5 }));
      disc.userData.dispose = true;
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(c.x, 0.03, c.z);
      disc.receiveShadow = true;
      g.add(disc);
      const rim = new THREE.Mesh(new THREE.RingGeometry(c.r - 0.05, c.r + 0.35, 40), new THREE.MeshToonMaterial({ color: "#5a7a3a", gradientMap: toon("#fff").gradientMap }));
      rim.userData.dispose = true;
      rim.rotation.x = -Math.PI / 2;
      rim.position.set(c.x, 0.018, c.z);
      g.add(rim);
    }
    if (m.swamp.length) {
      const n = 60;
      const bub = new THREE.InstancedMesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshToonMaterial({ color: "#c79cff", gradientMap: toon("#fff").gradientMap, emissive: "#8a4fd0", emissiveIntensity: 0.6 }), n);
      bub.userData.dispose = true;
      bub.userData.spots = Array.from({ length: n }, (_, i) => {
        const c = m.swamp[i % m.swamp.length];
        const a = i * 2.399;
        const r = Math.sqrt(((i * 7919) % 100) / 100) * c.r * 0.9;
        return { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r, p: (i * 0.137) % 1 };
      });
      g.add(bub);
      this.swampBubbles = bub;
    }

    // cave walls, ceiling and gates
    if (cave) {
      const rock = toon("#4d4766");
      for (const z of [-0.5, D + 0.5]) {
        const wall = piece(new THREE.BoxGeometry(W + 2, 6, 1), rock, { outline: false });
        wall.position.set(W / 2, 3, z);
        wall.receiveShadow = true;
        g.add(wall);
        // bumpy rocks along the walls
        for (let x = 1; x < W; x += 2.2) g.add(place(makeRock(1.2 + ((x * 13) % 7) / 10, true), x, 0, z < 0 ? 0.25 : D - 0.25));
      }
      for (const x of [-0.5, W + 0.5]) {
        const wall = piece(new THREE.BoxGeometry(1, 6, D + 2), rock, { outline: false });
        wall.position.set(x, 3, D / 2);
        g.add(wall);
      }
      const ceil = piece(new THREE.BoxGeometry(W + 2, 0.5, D + 2), toon("#2a2540"), { outline: false });
      ceil.position.set(W / 2, 6, D / 2);
      g.add(ceil);
      for (const r of m.rooms) {
        if (r.gateX === null) continue;
        const gate = new THREE.Group();
        for (let z = 0.4; z < D; z += 0.55) gate.add(place(piece(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 6), toon("#8c95a6")), 0, 1.6, z));
        gate.add(place(piece(new THREE.BoxGeometry(0.2, 0.2, D), toon("#5a5a6a")), 0, 3.1, D / 2));
        gate.position.x = r.gateX;
        g.add(gate);
        this.gates.push({ x: r.gateX * TILE3, mesh: gate });
      }
    }

    // buildings
    for (const b of m.buildings) {
      const house = makeBuilding(b.kind, b.w, b.d, b.h, b.doorX - b.x);
      house.position.set(b.x, 0, b.z);
      this.occluders.push({ obj: house, x: b.x + b.w / 2, z: b.z + b.d / 2, r: Math.max(b.w, b.d) / 2 });
      house.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      g.add(house);
    }

    // decor
    for (const d of m.decor) {
      let o: THREE.Object3D;
      const s = d.s ?? 1;
      switch (d.kind) {
        case "tree":
          o = makeTree(s);
          break;
        case "pine":
          o = makeTree(s, true);
          break;
        case "bush":
          o = makeBush(s);
          break;
        case "rock":
          o = makeRock(s, cave);
          break;
        case "flower":
          o = makeFlower(s, d.x * 3.1 + d.z);
          break;
        case "mushroom":
          o = makeMushroom(s, Math.floor(d.x + d.z) % 2 === 0);
          break;
        case "fence":
          o = makeFence();
          break;
        case "torch":
          o = makeTorch();
          break;
        case "lamp":
          o = makeLamp();
          break;
        case "crystal":
          o = makeCrystal(s);
          break;
        case "well":
          o = makeWell();
          break;
        case "reed":
          o = makeReed(s);
          break;
      }
      o.position.set(d.x, 0, d.z);
      o.rotation.y = d.rot ?? 0;
      g.add(o);
      if (d.kind === "tree" || d.kind === "pine") this.occluders.push({ obj: o, x: d.x, z: d.z, r: 0.9 * s });
    }

    // signs
    for (const s of m.signs) {
      const sp = makeSignPost();
      sp.position.set(s.x, 0, s.z);
      sp.rotation.y = Math.PI / 6;
      g.add(sp);
    }

    // portals: a glowing ring on the ground and a swirl
    for (const p of m.portals) {
      const pg = new THREE.Group();
      pg.position.set(p.x, 0, p.z);
      const color = p.kind === "cave" ? "#b38cff" : p.kind === "dungeon_exit" ? "#ffd34d" : "#7fe0ff";
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.0, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthWrite: false }));
      ring.userData.dispose = true;
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.04;
      pg.add(ring);
      const swirl = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(0.55 + i * 0.12, 0.03, 6, 32, Math.PI * 1.2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7 - i * 0.15 }));
        t.userData.dispose = true;
        t.position.y = 0.6 + i * 0.35;
        t.rotation.x = Math.PI / 2;
        t.rotation.z = i * 2;
        swirl.add(t);
      }
      pg.add(swirl);
      this.portalSpin.push(swirl);
      if (p.kind === "cave") {
        // the dark cave mouth behind it
        const mouth = piece(new THREE.SphereGeometry(2.4, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), toon("#7d7890"));
        mouth.position.set(1.6, 0, 0);
        mouth.scale.set(0.8, 1, 1.1);
        pg.add(mouth);
        const hole = new THREE.Mesh(new THREE.CircleGeometry(1.3, 24, 0, Math.PI), new THREE.MeshBasicMaterial({ color: "#120e1e" }));
        hole.userData.dispose = true;
        hole.position.set(-0.32, 0, 0);
        hole.rotation.y = -Math.PI / 2;
        pg.add(hole);
      }
      if (p.kind === "dungeon_exit") this.exitPortals.push(pg);
      g.add(pg);
    }

    // villagers
    for (const v of this.npcs) this.dyn.remove(v.model.root);
    this.npcs = [];
  }

  private addGrass(m: Map3D) {
    const n = Math.round(m.w * m.d * 0.9);
    const blade = new THREE.ConeGeometry(0.035, 0.24, 3);
    blade.translate(0, 0.12, 0);
    const mat = new THREE.MeshToonMaterial({ color: "#74c95a", gradientMap: toon("#fff").gradientMap });
    const time = this.grassTime;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = time;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec4 wpos = instanceMatrix * vec4(0.0,0.0,0.0,1.0);
            float sway = sin(uTime * 1.6 + wpos.x * 0.7 + wpos.z * 0.5) * 0.06 * position.y / 0.24;
            transformed.x += sway;
            transformed.z += sway * 0.5;
          #endif`,
        );
    };
    this.grassMat = mat;
    const inst = new THREE.InstancedMesh(blade, mat, n);
    inst.userData.dispose = true;
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const p = new THREE.Vector3();
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    let k = 0;
    for (let i = 0; i < n * 2 && k < n; i++) {
      const x = 0.5 + rnd() * (m.w - 1);
      const z = 0.5 + rnd() * (m.d - 1);
      if (m.swamp.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 0.3)) continue;
      if (m.buildings.some((b) => x > b.x - 0.2 && x < b.x + b.w + 0.2 && z > b.z - 0.2 && z < b.z + b.d + 0.2)) continue;
      if (m.paths.some((path) => path.some((pt, j) => j < path.length - 1 && distToSeg(x, z, pt, path[j + 1]) < 0.9))) continue;
      p.set(x, 0, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI);
      const s = 0.7 + rnd() * 0.8;
      sc.set(s, s * (0.8 + rnd() * 0.6), s);
      mtx.compose(p, q, sc);
      inst.setMatrixAt(k++, mtx);
    }
    inst.count = k;
    inst.receiveShadow = true;
    this.mapGroup.add(inst);
  }

  // ---------- each frame ----------

  render(e: Engine3D, now: number, info: DrawInfo, dt: number) {
    if (e.map.id !== this.mapId) {
      this.buildMap(e.map);
      this.camReady = false;
    }
    this.syncNpcs(e, info, now);
    this.syncHero(e, info, now);
    this.syncMonsters(e, now);
    this.syncPets(e, now);
    this.syncClones(e, now);
    this.syncShots(e, now);
    this.syncFx(e, now);
    this.grassTime.value = now / 1000;
    for (const s of this.portalSpin) s.rotation.y = now / 600;
    for (const g of this.gates) g.mesh.visible = e.closedGates().includes(g.x);
    for (const x of this.exitPortals) x.visible = !!e.run?.cleared;
    if (this.swampBubbles) {
      const spots = this.swampBubbles.userData.spots as { x: number; z: number; p: number }[];
      const mtx = new THREE.Matrix4();
      spots.forEach((s, i) => {
        const t = (now / 2200 + s.p) % 1;
        mtx.makeScale(0.4 + t, 0.4 + t, 0.4 + t);
        mtx.setPosition(s.x, 0.04 + t * 0.35, s.z);
        this.swampBubbles!.setMatrixAt(i, mtx);
      });
      this.swampBubbles.instanceMatrix.needsUpdate = true;
    }
    this.updateCamera(e, dt);
    this.hideOccluders(e);
    // sun and its shadow follow the player
    const p = e.player;
    const px = p.x * U;
    const pz = p.z * U;
    this.sun.position.set(px + 8, 18, pz + 6);
    this.sun.target.position.set(px, 0, pz);
    this.glow.position.set(px, 2.2, pz);
    this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
    this.drawOverlay(e, now, info);
  }

  private updateCamera(e: Engine3D, dt: number) {
    const p = e.player;
    // look a little above your head, so you sit low on the screen and can see what's ahead
    const target = this.tmp.set(p.x * U, Math.max(0, -p.y * U) * 0.5 + 1.75, p.z * U);
    const cave = e.map.terrain === "stone";
    const pitch = Math.max(0.08, Math.min(1.25, this.camPitch));
    this.camPitch = pitch;
    let dist = this.camDist;
    const fx = Math.sin(this.camYaw);
    const fz = Math.cos(this.camYaw);
    let cx = target.x - fx * dist * Math.cos(pitch);
    let cz = target.z - fz * dist * Math.cos(pitch);
    let cy = target.y + dist * Math.sin(pitch);
    if (cave) {
      // stay inside the tunnel
      const D = e.map.d;
      cz = Math.max(0.4, Math.min(D - 0.4, cz));
      cx = Math.max(0.4, Math.min(e.map.w - 0.4, cx));
      if (cy > 5.4) {
        cy = 5.4;
        dist = Math.min(dist, (5.4 - target.y) / Math.max(0.1, Math.sin(pitch)));
      }
    }
    const want = new THREE.Vector3(cx, Math.max(0.4, cy), cz);
    const k = this.camReady ? 1 - Math.pow(0.0001, dt / 1000) : 1;
    this.camPos.lerp(want, k);
    this.camLook.lerp(target, this.camReady ? Math.min(1, k * 1.5) : 1);
    if (!this.camReady) {
      this.camPos.copy(want);
      this.camLook.copy(target);
    }
    this.camReady = true;
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  /** Trees and houses between the camera and you (or right at the camera) step out of the way. */
  private hideOccluders(e: Engine3D) {
    const cx = this.camera.position.x;
    const cz = this.camera.position.z;
    const px = e.player.x * U;
    const pz = e.player.z * U;
    for (const o of this.occluders) {
      const d = distToSeg(o.x, o.z, { x: cx, z: cz }, { x: px, z: pz });
      const nearPlayer = Math.hypot(o.x - px, o.z - pz) < o.r * 0.6;
      o.obj.visible = !(d < o.r + 0.5 && !nearPlayer);
    }
  }

  private syncNpcs(e: Engine3D, info: DrawInfo, now: number) {
    if (this.npcs.length !== e.map.npcs.length || this.npcsStale || this.npcs.some((v, i) => v.id !== e.map.npcs[i]?.id)) {
      this.npcsStale = false;
      for (const v of this.npcs) this.dyn.remove(v.model.root);
      this.npcs = e.map.npcs.map((n) => {
        const model = heroFor(info.npcLooks[n.id]);
        model.set("unarmed");
        model.root.position.set(n.x, 0, n.z);
        this.dyn.add(model.root);
        return { model, x: n.x, z: n.z, id: n.id };
      });
    }
    const p = e.player;
    for (const v of this.npcs) {
      // villagers turn to look at you when you're close
      const dx = p.x * U - v.x;
      const dz = p.z * U - v.z;
      const want = Math.hypot(dx, dz) < 5 ? Math.atan2(dx, dz) : Math.PI / 2 + Math.sin(now / 3000 + v.x) * 0.6;
      const r = v.model.root.rotation;
      r.y += angle(r.y, want) * 0.08;
      v.model.animate("idle", now + v.x * 100, 0, 0);
    }
  }

  private syncHero(e: Engine3D, info: DrawInfo, now: number) {
    const key = JSON.stringify(info.look) + packReady();
    if (!this.hero || key !== this.heroLook) {
      if (this.hero) this.dyn.remove(this.hero.root);
      this.hero = heroFor(info.look);
      this.heroMats = ownMaterials(this.hero.root);
      this.heroLook = key;
      this.dyn.add(this.hero.root);
    }
    const h = this.hero;
    this.heroBody = info.look.body;
    const p = e.player;
    h.set(e.weapon);
    toScene(p.x, p.y, p.z, h.root.position);
    h.root.rotation.y = p.yaw;
    const feel = WEAPON_FEEL[e.weapon];
    let pose: HeroPose = "idle";
    let prog = 0;
    if (p.dead) pose = "dead";
    else if (now < p.hurtUntil) pose = "hurt";
    else if (now < p.castUntil) pose = "cast";
    else if (now < p.attackUntil) {
      pose = "attack";
      prog = (now - p.attackStart) / Math.max(1, Math.min(feel.interval - 40, 360));
    } else if (p.blocking) pose = "block";
    else if (!p.onGround) pose = p.vy < 0 ? "jump" : "fall";
    else if (Math.hypot(p.vx, p.vz) > 5) pose = "walk";
    h.animate(pose, now, p.walkT, prog);
    // hidden: see-through; hurt: blink
    const hidden = now < p.invisibleUntil;
    const blink = now < p.invulnUntil && !p.dead && Math.floor(now / 90) % 2 === 0;
    const op = hidden ? 0.35 : blink ? 0.55 : 1;
    for (const m of this.heroMats) {
      m.transparent = op < 1;
      m.opacity = op;
    }
    setOutlines(h.root, op === 1);
    this.heroShadow.position.set(p.x * U, 0.02, p.z * U);
    const air = Math.min(1, -p.y / 200);
    this.heroShadow.scale.setScalar(1 - air * 0.4);
  }

  private viewFor(species: string): MonsterView {
    const model = makeMonster(species);
    const look = MONSTER_LOOKS[bodySpecies(species)];
    const shadow = this.blobShadow(Math.max(0.2, (look.body.w * U) / 2));
    this.dyn.add(model.root, shadow);
    return { model, shadow, species };
  }

  private syncMonsters(e: Engine3D, now: number) {
    const alive = new Set<number>();
    for (const m of e.monsters) {
      alive.add(m.uid);
      let v = this.monsters.get(m.uid);
      if (!v) {
        v = this.viewFor(m.id);
        this.monsters.set(m.uid, v);
      }
      this.placeMonster(v, m, now);
    }
    for (const [uid, v] of this.monsters) {
      if (alive.has(uid)) continue;
      this.dyn.remove(v.model.root, v.shadow);
      this.monsters.delete(uid);
    }
  }

  private placeMonster(v: MonsterView, m: Monster, now: number) {
    const root = v.model.root;
    const dead = m.state === "dead";
    const fade = dead ? Math.max(0, 1 - (now - m.diedAt) / 900) : 1;
    root.visible = fade > 0;
    v.shadow.visible = fade > 0;
    toScene(m.x, m.y, m.z, root.position);
    // turn smoothly
    root.rotation.y += angle(root.rotation.y, m.yaw) * 0.25;
    const pose = dead ? "dead" : m.state === "windup" ? "windup" : now - m.struckAt < 240 ? "attack" : m.state === "chase" || m.patrolDir !== null ? "walk" : "rest";
    v.model.animate(pose, now + m.uid * 77, m.walkT);
    const flash = now < m.flashUntil;
    const windup = m.state === "windup";
    for (const mat of v.model.mats) {
      mat.emissive.set(flash ? "#ffffff" : windup ? "#ff3020" : "#000000");
      mat.emissiveIntensity = flash ? 0.8 : windup ? 0.25 + 0.2 * Math.sin(now / 50) : 0;
      if (dead) {
        mat.transparent = true;
        mat.opacity = fade;
      }
    }
    v.shadow.position.set(m.x * U, 0.021, m.z * U);
  }

  private syncPets(e: Engine3D, now: number) {
    const keep = new Set<string>();
    for (const pt of e.pets) {
      const key = `${pt.id}|${pt.species}`;
      keep.add(key);
      let v = this.pets.get(key);
      if (!v) {
        v = this.viewFor(pt.species);
        this.pets.set(key, v);
      }
      this.placePet(v, pt, now);
    }
    for (const [k, v] of this.pets) {
      if (keep.has(k)) continue;
      this.dyn.remove(v.model.root, v.shadow);
      this.pets.delete(k);
    }
  }

  private placePet(v: MonsterView, pt: PetUnit, now: number) {
    const root = v.model.root;
    toScene(pt.x, pt.y, pt.z, root.position);
    const flying = MONSTER_LOOKS[bodySpecies(pt.species)].flying;
    if (flying) root.position.y += 0.6 + Math.sin(now / 300) * 0.08;
    root.rotation.y += angle(root.rotation.y, pt.yaw) * 0.25;
    // a boss pet (or one bred from a boss) is a baby: much smaller. Primal Bond: giant for a moment
    const gl = (pt.giantUntil ?? 0) - now;
    const grow = gl > 0 ? Math.min(1, (1200 - gl) / 150, gl / 200) : 0;
    const ps = (pt.species.split("+").some((s) => MONSTERS[s]?.isBoss) ? 0.4 : 0.8) * (1 + 2 * grow);
    root.scale.setScalar(ps);
    const pose = now - pt.struckAt < 240 ? "attack" : pt.moving ? "walk" : "rest";
    v.model.animate(pose, now, pt.walkT);
    v.shadow.position.set(pt.x * U, 0.021, pt.z * U);
    v.shadow.scale.setScalar(ps);
  }

  private syncClones(e: Engine3D, now: number) {
    while (this.clones.length < e.clones.length) {
      const model = heroFor({ skin: "#8a7bff", hair: "#5a4ad0", eyes: "#ffffff", shirt: "#6b5ae0", hairStyle: "Short", female: false, build: "Average", body: this.heroBody });
      const mats = ownMaterials(model.root);
      for (const m of mats) {
        m.transparent = true;
        m.opacity = 0.55;
      }
      setOutlines(model.root, false);
      this.dyn.add(model.root);
      this.clones.push({ model, mats });
    }
    this.clones.forEach((c, i) => {
      const cl = e.clones[i];
      c.model.root.visible = !!cl;
      if (!cl) return;
      c.model.set(e.weapon);
      toScene(cl.x, cl.y, cl.z, c.model.root.position);
      c.model.root.rotation.y = cl.yaw;
      const struck = now - (cl.nextAt - WEAPON_FEEL[e.weapon].interval);
      c.model.animate(struck >= 0 && struck < 300 ? "attack" : "idle", now, 0, struck / 300);
    });
  }

  private shotMesh(kind: string): THREE.Mesh {
    const color = { arrow: "#f4ead2", bullet: "#ffe066", magic: "#8fb4ff", holy: "#fff3b0", star: "#ffe066", venom: "#9be37a" }[kind] ?? "#ffffff";
    let geo: THREE.BufferGeometry;
    if (kind === "arrow") geo = new THREE.CylinderGeometry(0.02, 0.02, 0.6, 5).rotateX(Math.PI / 2);
    else if (kind === "bullet") geo = new THREE.SphereGeometry(0.07, 8, 6);
    else if (kind === "star") geo = new THREE.OctahedronGeometry(0.16);
    else geo = new THREE.SphereGeometry(0.15, 12, 8);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(kind === "arrow" ? 0.08 : 0.26, 10, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false }));
    m.add(halo);
    this.dyn.add(m);
    return m;
  }

  private syncShots(e: Engine3D, now: number) {
    const used: Record<string, number> = {};
    for (const pr of e.projectiles) {
      const list = (this.shots[pr.kind] ??= []);
      const i = (used[pr.kind] = (used[pr.kind] ?? 0) + 1) - 1;
      if (!list[i]) list[i] = this.shotMesh(pr.kind);
      const m = list[i];
      m.visible = true;
      toScene(pr.x, pr.y, pr.z, m.position);
      m.lookAt(m.position.x + pr.vx, m.position.y - pr.vy, m.position.z + pr.vz);
      if (pr.kind === "star") m.rotation.z = now / 80;
    }
    for (const [k, list] of Object.entries(this.shots)) list.forEach((m, i) => (m.visible = i < (used[k] ?? 0)));
  }

  private fxMesh(kind: string) {
    let geo: THREE.BufferGeometry;
    if (kind === "slash") geo = new THREE.TorusGeometry(1, 0.06, 6, 24, Math.PI * 0.9);
    else if (kind === "area") geo = new THREE.RingGeometry(0.85, 1, 48);
    else if (kind === "parry") geo = new THREE.TorusGeometry(1, 0.08, 6, 32);
    else if (kind === "heal") geo = new THREE.TorusGeometry(1, 0.05, 6, 32);
    else geo = new THREE.IcosahedronGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    this.dyn.add(mesh);
    return { mesh, mat };
  }

  private syncFx(e: Engine3D, now: number) {
    const used: Record<string, number> = {};
    for (const f of e.fx) {
      const key = f.kind === "level" ? "burst" : f.kind;
      const list = (this.fxPool[key] ??= []);
      const i = (used[key] = (used[key] ?? 0) + 1) - 1;
      if (!list[i]) list[i] = this.fxMesh(key);
      const { mesh, mat } = list[i];
      const t = Math.min(1, (now - f.born) / f.life);
      mesh.visible = true;
      mat.color.set(f.color);
      const r = f.r * U;
      toScene(f.x, f.y, f.z, mesh.position);
      mesh.rotation.set(0, 0, 0);
      if (key === "slash") {
        mesh.rotation.set(Math.PI / 2 - 0.4, 0, 0);
        mesh.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), f.yaw - Math.PI / 2);
        mesh.rotateZ(-t * 1.2);
        mesh.scale.setScalar(r * (0.7 + t * 0.4));
        mat.opacity = 0.9 * (1 - t);
      } else if (key === "area") {
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0.06;
        mesh.scale.setScalar(r * (0.4 + t * 0.6));
        mat.opacity = 0.8 * (1 - t);
      } else if (key === "parry") {
        mesh.rotation.y = f.yaw;
        mesh.scale.setScalar(r * (0.6 + t));
        mat.opacity = 1 - t;
      } else if (key === "heal") {
        mesh.rotation.x = Math.PI / 2;
        mesh.position.y += t * 0.8 - 0.3;
        mesh.scale.setScalar(r * (1 - t * 0.3));
        mat.opacity = 0.8 * (1 - t);
      } else {
        mesh.scale.setScalar(r * (0.3 + t * 0.9));
        mat.opacity = 0.7 * (1 - t);
      }
    }
    for (const [k, list] of Object.entries(this.fxPool)) list.forEach((x, i) => (x.mesh.visible = i < (used[k] ?? 0)));
  }

  // ---------- the flat layer: numbers, HP bars, names ----------

  /** Screen spot (overlay pixels) of a game position, or null when behind the camera. */
  private screen(x: number, y: number, z: number): { x: number; y: number } | null {
    const v = toScene(x, y, z, this.tmp).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    const c = this.overlayCanvas;
    return { x: ((v.x + 1) / 2) * c.width, y: ((1 - v.y) / 2) * c.height };
  }

  private drawOverlay(e: Engine3D, now: number, info: DrawInfo) {
    const ctx = this.overlay;
    const c = this.overlayCanvas;
    ctx.clearRect(0, 0, c.width, c.height);
    const k = c.width / Math.max(1, c.clientWidth || c.width);
    const font = (px: number) => `900 ${Math.round(px * k)}px ui-rounded, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const label = (text: string, s: { x: number; y: number }, color: string, px: number, stroke = "#2f2a3b") => {
      ctx.font = font(px);
      ctx.lineWidth = Math.max(2, px * 0.22) * k;
      ctx.strokeStyle = stroke;
      ctx.strokeText(text, s.x, s.y);
      ctx.fillStyle = color;
      ctx.fillText(text, s.x, s.y);
    };
    const p = e.player;
    const camPos = this.camera.position;
    const far = (x: number, z: number) => Math.hypot(x * U - camPos.x, z * U - camPos.z) > 30;

    // portal names
    for (const portal of e.map.portals) {
      if (portal.kind === "dungeon_exit" && !e.run?.cleared) continue;
      if (far(portal.x * TILE3, portal.z * TILE3)) continue;
      const s = this.screen(portal.x * TILE3, -150, portal.z * TILE3);
      if (s) label(portal.label, s, "#ffffff", 15);
    }
    // the player's name
    if (!p.dead) {
      const s = this.screen(p.x, 12, p.z);
      if (s) {
        ctx.font = font(12);
        const w = ctx.measureText(info.name).width + 12 * k;
        ctx.fillStyle = "rgba(47,42,59,0.75)";
        roundRect(ctx, s.x - w / 2, s.y - 9 * k, w, 18 * k, 6 * k);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.fillText(info.name, s.x, s.y + 0.5 * k);
      }
    }
    // monsters: wind-up warnings, stuns, HP bars, status dots
    for (const m of e.monsters) {
      if (m.state === "dead" || far(m.x, m.z)) continue;
      const look = MONSTER_LOOKS[m.id];
      const s = this.screen(m.x, m.y - look.body.h - 18, m.z);
      if (!s) continue;
      if (m.state === "windup") {
        const basic = MONSTERS[m.id].attacks[0].name === m.attack?.name;
        ctx.fillStyle = basic ? "#ff6b5e" : "#ffcf3d";
        ctx.strokeStyle = "#2f2a3b";
        ctx.lineWidth = 3 * k;
        ctx.beginPath();
        ctx.arc(s.x, s.y - 22 * k, 13 * k, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.font = font(18);
        ctx.fillText("!", s.x, s.y - 21 * k);
      }
      if (m.state === "stunned") {
        for (let i = 0; i < 3; i++) {
          const a = now / 200 + (i * Math.PI * 2) / 3;
          ctx.fillStyle = "#ffe066";
          ctx.beginPath();
          ctx.arc(s.x + Math.cos(a) * 20 * k, s.y - 8 * k + Math.sin(a) * 6 * k, 5 * k, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (now < m.showHpUntil && !MONSTERS[m.id].isBoss) {
        const w = Math.max(46, look.body.w * 0.8) * k;
        ctx.fillStyle = "#2f2a3b";
        roundRect(ctx, s.x - w / 2 - 2 * k, s.y - 2 * k, w + 4 * k, 10 * k, 4 * k);
        ctx.fill();
        ctx.fillStyle = "#ff5a5a";
        ctx.fillRect(s.x - w / 2, s.y, w * Math.max(0, m.hp / m.maxHp), 6 * k);
      }
      const marks = Object.keys(m.statuses);
      marks.forEach((st, i) => {
        ctx.fillStyle = st === "poison" ? "#a45cff" : st === "burn" ? "#ff8a3d" : st === "slow" ? "#5fb3ff" : "#ffd34d";
        ctx.beginPath();
        ctx.arc(s.x - (marks.length - 1) * 7 * k + i * 14 * k, s.y - 10 * k, 5 * k, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    // a heart over each of your pets
    for (const pt of e.pets) {
      const look = MONSTER_LOOKS[bodySpecies(pt.species)];
      const s = this.screen(pt.x, pt.y - look.body.h * 1.15 - (look.flying ? 70 : 14), pt.z);
      if (!s) continue;
      const r = 6 * k;
      ctx.fillStyle = "#ff7aa8";
      ctx.beginPath();
      ctx.moveTo(s.x, s.y + r);
      ctx.bezierCurveTo(s.x - 1.5 * r, s.y - 0.3 * r, s.x - 0.8 * r, s.y - 1.5 * r, s.x, s.y - 0.6 * r);
      ctx.bezierCurveTo(s.x + 0.8 * r, s.y - 1.5 * r, s.x + 1.5 * r, s.y - 0.3 * r, s.x, s.y + r);
      ctx.fill();
    }
    // floating numbers and words
    for (const t of e.texts) {
      const age = (now - t.born) / t.life;
      const s = this.screen(t.x, t.y - age * 50, t.z);
      if (!s) continue;
      ctx.globalAlpha = Math.min(1, (1 - age) * 3);
      const pop = age < 0.1 ? 0.7 + age * 3 : 1;
      label(t.text, s, t.color, t.size * 0.8 * pop);
      ctx.globalAlpha = 1;
    }
    void PLAYER_H;
  }

  dispose() {
    this.offPack();
    this.disposeGroup(this.mapGroup);
    this.renderer.dispose();
  }
}

function place<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Signed smallest turn from a to b. */
function angle(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function distToSeg(x: number, z: number, a: { x: number; z: number }, b: { x: number; z: number }) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l));
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}
