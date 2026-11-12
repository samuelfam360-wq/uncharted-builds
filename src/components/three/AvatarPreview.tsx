"use client";

// A small live 3D view of your hero for the character creation screen:
// it changes as you click, and you can drag to turn it.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { WeaponType } from "@/lib/game/types";
import type { Look } from "../side/hero";
import { makeHero, type HeroModel } from "./models";
import { glowPower, loadPack, makeRiggedHero, onPackReady } from "./rigged";

interface View {
  setHero(look: Look, weapon: WeaponType): void;
  dispose(): void;
}

function makeView(canvas: HTMLCanvasElement): View {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#3a3390");
  scene.fog = new THREE.Fog("#3a3390", 6, 16);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 1.0, 4.4);
  camera.lookAt(0, 0.72, 0);
  // the same dusk light as the game
  scene.add(new THREE.HemisphereLight("#c9c4ff", "#5f7f6a", 1.15));
  const sun = new THREE.DirectionalLight("#ffe2c8", 0.6);
  sun.position.set(2, 5, 4);
  scene.add(sun);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(5, 40), new THREE.MeshToonMaterial({ color: "#4b43a8" }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  // a glowing ring under the hero, in the hero's glow colour
  const ringMat = new THREE.MeshBasicMaterial({ color: "#ffffff" });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.54, 48), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  scene.add(ring);

  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { samples: 4, type: THREE.HalfFloatType }));
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.2, 1.05));
  composer.addPass(new OutputPass());

  let hero: HeroModel | null = null;
  let last: { look: Look; weapon: WeaponType } | null = null;
  let yaw = 0.35;
  let dragX: number | null = null;
  let spinning = true;

  const build = () => {
    if (!last) return;
    if (hero) scene.remove(hero.root);
    hero = makeRiggedHero(last.look) ?? makeHero(last.look);
    hero.set(last.weapon);
    scene.add(hero.root);
    const glow = last.look.glow ?? "#ffffff";
    ringMat.color.set(glow).multiplyScalar(glowPower(glow));
  };
  void loadPack();
  const offPack = onPackReady(build);

  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const down = (e: PointerEvent) => {
    dragX = e.clientX;
    spinning = false;
    canvas.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (dragX === null) return;
    yaw += (e.clientX - dragX) * 0.012;
    dragX = e.clientX;
  };
  const up = () => (dragX = null);
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);

  let raf = 0;
  let prev = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    if (spinning) yaw += dt * 0.35;
    if (hero) {
      hero.root.rotation.y = yaw;
      hero.animate("idle", now, 0, 0);
    }
    composer.render();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    setHero(look, weapon) {
      last = { look, weapon };
      build();
    },
    dispose() {
      cancelAnimationFrame(raf);
      offPack();
      ro.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      composer.dispose();
      renderer.dispose();
    },
  };
}

export default function AvatarPreview({ look, weapon }: { look: Look; weapon: WeaponType }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    try {
      viewRef.current = makeView(canvasRef.current);
    } catch {
      viewRef.current = null; // no 3D on this device: the choices still work
    }
    return () => {
      viewRef.current?.dispose();
      viewRef.current = null;
    };
  }, []);

  const key = JSON.stringify(look) + weapon;
  useEffect(() => {
    viewRef.current?.setHero(look, weapon);
    // the look is rebuilt only when its content changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <canvas
      ref={canvasRef}
      className="block h-72 w-full cursor-grab touch-none rounded-lg border border-line sm:h-80"
      aria-label="Your hero. Drag to turn."
      data-testid="avatar"
    />
  );
}
