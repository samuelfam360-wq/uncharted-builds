// Skill effects drawn on the 3D player.

import * as THREE from "three";

/**
 * Green Slime's Mercy: a see-through coat of green slime over the whole body.
 * It is the body's own shape pushed a little outward, so it hugs the player and
 * moves with every animation. It wobbles, has a wet shine, and glows at the edges.
 * Returns the coat's meshes (shown or hidden together).
 */
export function makeSlimeCoat(root: THREE.Object3D, thickness: number, time: { value: number }): THREE.Mesh[] {
  const mat = new THREE.MeshPhongMaterial({
    color: "#5fd36a",
    emissive: "#1f6b2c",
    emissiveIntensity: 0.35,
    specular: "#ffffff",
    shininess: 90,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.uniforms.uThick = { value: thickness };
    sh.vertexShader = "uniform float uTime;\nuniform float uThick;\n" + sh.vertexShader;
    sh.vertexShader = sh.vertexShader.replace(
      "#include <project_vertex>",
      `{
        // swell outward, with slow blobby wobbles running up the body
        float w = sin(uTime * 3.0 + position.y * 9.0 + position.x * 5.0) * 0.5 + sin(uTime * 4.7 - position.y * 13.0 + position.z * 7.0) * 0.3;
        transformed += normalize(objectNormal) * uThick * (1.0 + 0.35 * w);
      }
      #include <project_vertex>`,
    );
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <dithering_fragment>",
      `#include <dithering_fragment>
      {
        // edges of the coat look thicker: brighter and less see-through
        float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition)));
        rim = pow(rim, 2.2);
        gl_FragColor.rgb += vec3(0.45, 0.95, 0.5) * rim * 0.7;
        gl_FragColor.a = clamp(gl_FragColor.a + rim * 0.45, 0.0, 0.85);
      }`,
    );
  };

  const bodies: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.outline || m.userData.coat || !m.visible) return;
    // weapons and the painted face stay dry
    for (let a: THREE.Object3D | null = m; a && a !== root; a = a.parent) if (a.userData.weapon || a.userData.detail) return;
    bodies.push(m);
  });
  const coat: THREE.Mesh[] = [];
  for (const m of bodies) {
    let c: THREE.Mesh;
    if ((m as THREE.SkinnedMesh).isSkinnedMesh) {
      const sm = m as THREE.SkinnedMesh;
      const sc = new THREE.SkinnedMesh(sm.geometry, mat);
      sc.bind(sm.skeleton, sm.bindMatrix);
      c = sc;
    } else {
      c = new THREE.Mesh(m.geometry, mat);
    }
    c.userData.coat = true;
    c.castShadow = false;
    c.frustumCulled = false;
    c.renderOrder = 2;
    c.position.copy(m.position);
    c.quaternion.copy(m.quaternion);
    c.scale.copy(m.scale);
    m.parent!.add(c);
    coat.push(c);
  }
  return coat;
}

/**
 * Wolf's Scars: a living red aura on the ground around the player. Three sets of
 * claw scars sweep around the rim, slow ripples roll outward, the edge breathes,
 * and small red embers drift up. The group is one unit wide: scale it to the
 * aura's reach. Call update(now) every frame.
 */
export function makeScarAura(): { group: THREE.Group; update(now: number): void; dispose(): void } {
  const group = new THREE.Group();
  const time = { value: 0 };
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: time },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vP;
      const float TAU = 6.28318530718;
      // one claw mark: a thin arc at radius r0, fat in the middle and sharp at both ends
      float claw(float r, float a, float r0, float a0, float len) {
        float d = mod(a - a0 + TAU * 0.5, TAU) - TAU * 0.5;
        float t = clamp(d / len + 0.5, 0.0, 1.0);
        float body = sin(t * 3.14159);
        float inside = step(abs(d), len * 0.5);
        float w = 0.016 * body + 0.002;
        return inside * smoothstep(w, w * 0.25, abs(r - r0)) * (0.35 + 0.65 * body);
      }
      void main() {
        float r = length(vP);
        if (r > 1.0) discard;
        float a = atan(vP.y, vP.x);
        float pulse = 0.5 + 0.5 * sin(uTime * 2.4);
        // the breathing edge
        float edge = smoothstep(0.035 + 0.02 * pulse, 0.0, abs(r - 0.965)) * (0.75 + 0.5 * pulse);
        // a soft glow that is strongest near the edge
        float glow = smoothstep(0.25, 1.0, r) * 0.2 * (0.7 + 0.3 * pulse);
        // ripples rolling outward
        float wave = fract(r * 2.0 - uTime * 0.35);
        float ripple = smoothstep(0.1, 0.0, abs(wave - 0.5)) * smoothstep(0.15, 0.6, r) * (1.0 - r) * 0.55;
        // three sets of three claw scars, sweeping round
        float scars = 0.0;
        for (int s = 0; s < 3; s++) {
          float base = uTime * 0.7 + float(s) * TAU / 3.0;
          for (int k = 0; k < 3; k++) {
            float fk = float(k);
            scars += claw(r, a, 0.66 + fk * 0.085, base - fk * 0.1, 0.95 - fk * 0.12);
          }
        }
        vec3 red = vec3(1.0, 0.1, 0.1);
        vec3 hot = vec3(1.0, 0.5, 0.4);
        vec3 col = mix(red, hot, clamp(scars, 0.0, 1.0) * 0.35) * (1.0 + 0.5 * scars + 0.3 * edge);
        float alpha = clamp(edge * 0.8 + glow + ripple + scars * 0.9, 0.0, 1.0);
        gl_FragColor = vec4(col, alpha * 0.9);
      }`,
  });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 64), mat);
  disc.rotation.x = -Math.PI / 2;
  disc.renderOrder = 1;
  group.add(disc);

  // embers drifting up
  const N = 18;
  const pos = new Float32Array(N * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const dots = new THREE.Points(
    geo,
    new THREE.PointsMaterial({ color: new THREE.Color(1.6, 0.25, 0.2), size: 0.06, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }),
  );
  dots.frustumCulled = false;
  group.add(dots);

  return {
    group,
    update(now) {
      time.value = now / 1000;
      // the group is scaled to the aura's reach, so heights are divided back to stay the same size
      const s = group.scale.x || 1;
      for (let i = 0; i < N; i++) {
        const life = (now / 1000 / (1.6 + (i % 5) * 0.25) + i * 0.37) % 1;
        const ang = i * 2.399 + now / 5000;
        const rad = 0.45 + ((i * 0.618) % 1) * 0.5;
        pos[i * 3] = Math.cos(ang) * rad;
        pos[i * 3 + 1] = (0.05 + life * 1.5) / s;
        pos[i * 3 + 2] = Math.sin(ang) * rad;
      }
      geo.attributes.position.needsUpdate = true;
      (dots.material as THREE.PointsMaterial).opacity = 0.9;
    },
    dispose() {
      disc.geometry.dispose();
      mat.dispose();
      geo.dispose();
      (dots.material as THREE.Material).dispose();
    },
  };
}
