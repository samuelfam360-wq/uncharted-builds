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
