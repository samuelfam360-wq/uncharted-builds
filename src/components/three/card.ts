// The "2D Art" body style: the exact Canva chibi hero from the 2D game,
// standing in the 3D world as a picture that always faces the camera.
// It turns to face left or right with the way the hero walks.

import * as THREE from "three";
import type { ClassId } from "@/lib/game/types";
import type { Look } from "../side/hero";
import type { HeroModel, HeroPose } from "./models";

/** Which classes have 2D art, and where the feet are in each pose (share of the width). */
const FEET: Record<ClassId, { idle: number; walk: number; attack: number; size?: number }> = {
  swordsman: { idle: 0.398, walk: 0.512, attack: 0.313 },
  mage: { idle: 0.595, walk: 0.606, attack: 0.307 },
  assassin: { idle: 0.557, walk: 0.622, attack: 0.26, size: 0.97 },
  tanker: { idle: 0.443, walk: 0.509, attack: 0.32 },
  ranger: { idle: 0.485, walk: 0.646, attack: 0.442 },
  gunslinger: { idle: 0.544, walk: 0.507, attack: 0.636 },
  tamer: { idle: 0.661, walk: 0.641, attack: 0.351 },
  lancer: { idle: 0.468, walk: 0.455, attack: 0.25, size: 1.13 },
  saint: { idle: 0.513, walk: 0.572, attack: 0.37 },
  blacksmith: { idle: 0.508, walk: 0.565, attack: 0.441 },
  monk: { idle: 0.527, walk: 0.575, attack: 0.35 },
  free: { idle: 0.53, walk: 0.61, attack: 0.509 },
};

const ART_H = 260; // the tallest pose of each sheet is saved this tall
const HERO_H = 1.75; // world units for a full-height pose (a bit taller than the anime hero: the big hair)

type Pic = "idle" | "walk" | "attack";
const loader = new THREE.TextureLoader();
/** A picture of its own for one hero (the browser keeps the file, so this is cheap). */
function texture(classId: ClassId, pic: Pic) {
  const t = loader.load(`/art/canva/hero-${classId}-${pic}.webp`);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export function hasCardArt(classId: ClassId | undefined): classId is ClassId {
  return !!classId && classId in FEET;
}

export function makeCardHero(look: Look, classId: ClassId): HeroModel {
  const feet = FEET[classId];
  const root = new THREE.Group();
  root.userData.ownsMaterials = true;
  // each hero has its own copies of the pictures, so turning one left doesn't turn the others
  const pics = {} as Record<Pic, THREE.Texture>;
  for (const p of ["idle", "walk", "attack"] as Pic[]) pics[p] = texture(classId, p);
  const mat = new THREE.SpriteMaterial({ map: pics.idle, transparent: true, alphaTest: 0.08, depthWrite: true });
  const sprite = new THREE.Sprite(mat);
  root.add(sprite);

  let pic: Pic = "idle";
  let left = false;
  const show = (p: Pic) => {
    pic = p;
    mat.map = pics[p];
    mat.needsUpdate = true;
  };
  // size and feet from the picture (once it has loaded)
  const fit = (sx = 1, sy = 1) => {
    const img = pics[pic].image as { width: number; height: number } | undefined;
    if (!img?.width) return;
    const h = HERO_H * (feet.size ?? 1) * (img.height / ART_H);
    sprite.scale.set(((img.width / img.height) * h) * sx, h * sy, 1);
    const fx = feet[pic];
    sprite.center.set(left ? 1 - fx : fx, 0);
  };

  // face left or right on screen, the way the hero is facing
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  sprite.onBeforeRender = (_r, _s, camera) => {
    root.getWorldDirection(fwd);
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const nowLeft = fwd.dot(right) < -0.05 ? true : fwd.dot(right) > 0.05 ? false : left;
    if (nowLeft !== left) left = nowLeft;
    for (const t of Object.values(pics)) {
      t.repeat.x = left ? -1 : 1;
      t.offset.x = left ? 1 : 0;
    }
    const fx = feet[pic];
    sprite.center.set(left ? 1 - fx : fx, 0);
  };

  const model: HeroModel = {
    root,
    weapon: null,
    set(weapon, horn = false) {
      // the picture already holds the class's weapon
      model.weapon = weapon;
      model.horn = horn;
    },
    animate(pose: HeroPose, t: number, _walkT: number, progress: number) {
      let sx = 1;
      let sy = 1;
      sprite.position.set(0, 0, 0);
      mat.rotation = 0;
      if (pose === "walk") {
        show(Math.floor(t / 170) % 2 ? "walk" : "idle");
        sprite.position.y = Math.abs(Math.sin((t / 170) * Math.PI)) * 0.04;
      } else if (pose === "jump" || pose === "fall") {
        show("walk");
        sy = pose === "jump" ? 1.04 : 0.98;
      } else if (pose === "attack" || pose === "cast") {
        show("attack");
        sprite.position.y = Math.sin(Math.min(1, progress) * Math.PI) * 0.02;
      } else if (pose === "dead") {
        show("idle");
        mat.rotation = left ? -Math.PI / 2 : Math.PI / 2;
        sy = 1;
      } else if (pose === "hurt") {
        show("idle");
        mat.rotation = left ? -0.08 : 0.08;
      } else if (pose === "block") {
        show("idle");
        sx = 0.97;
        sy = 0.96;
      } else {
        show("idle");
        sy = 1 + Math.sin(t / 380) * 0.015;
      }
      fit(sx, sy);
    },
    dispose() {
      for (const t of Object.values(pics)) t.dispose();
      mat.dispose();
    },
  };
  void look; // the picture is the look: hair, eyes and colours come with the art
  return model;
}
