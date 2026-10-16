import * as THREE from 'three';

export const windTime = { value: 0 };
/**
 * Where the player is pushing through the grass: xyz the feet, w the reach (0 = nobody). One
 * uniform write a frame; the bending is all in the vertex shader below.
 */
export const pushFrom = { value: new THREE.Vector4(0, 0, 0, 0) };
/** How far a blade at the player's feet is pushed aside, in world units. */
const PUSH = 0.45;

// Sways geometry in the vertex shader by injecting into the existing MeshToonMaterial rather
// than replacing it, so toon banding, fog and instancing all keep working untouched and the
// per-frame cost is a single uniform write instead of thousands of matrix updates.
// heightScale 0 sways a whole instance uniformly (tree canopies); above 0 bends from the base
// upward so only the tips move (grass).
export function applyWind(material: THREE.Material, amount: number, heightScale: number): void {
  const influence =
    heightScale > 0 ? `clamp(transformed.y / ${heightScale.toFixed(3)}, 0.0, 1.0)` : '1.0';
  // Only things that bend from the base (grass) part around the player. A tree that leaned out of
  // your way would be stranger than one that did not.
  const push =
    heightScale > 0
      ? `
          #ifdef USE_INSTANCING
          {
            vec3 away = wp - uPush.xyz;
            float d = length(away);
            if (uPush.w > 0.0 && d < uPush.w && d > 1e-3) {
              float k = 1.0 - d / uPush.w;
              k *= k;
              // Into the tuft's own frame. Only the direction is wanted, so the scale the
              // transpose leaves in does not matter; the push is divided by it afterwards.
              vec3 local = transpose(mat3(instanceMatrix)) * (away / d);
              vec2 side = normalize(local.xz + vec2(1e-5));
              float sx = max(length(instanceMatrix[0].xyz), 1e-3);
              transformed.xz += side * k * infl * ${PUSH.toFixed(3)} / sx;
              transformed.y *= 1.0 - 0.45 * k * infl;
            }
          }
          #endif`
      : '';

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windTime;
    shader.uniforms.uPush = pushFrom;
    shader.vertexShader =
      'uniform float uTime;\nuniform vec4 uPush;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 wp = vec3(0.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix[3].xyz;
          #endif
          // Fast per-instance flutter, so neighbours are never quite in step.
          float phase = wp.x * 0.35 + wp.y * 0.21 + wp.z * 0.29;
          float sway = sin(uTime * 1.6 + phase) + 0.4 * sin(uTime * 2.7 + phase * 1.7);
          // Slow, low spatial frequency envelope travelling across the world: this is what
          // reads as a gust rolling over the field rather than everything jittering at once.
          float gust = 0.5 + 0.5 * sin(dot(wp, vec3(0.62, 0.30, -0.72)) * 0.075 - uTime * 0.8);
          sway *= 0.45 + 1.25 * gust * gust;
          float infl = ${influence};
          transformed.x += sway * infl * ${amount.toFixed(4)};
          transformed.z += sway * 0.6 * infl * ${amount.toFixed(4)};
          ${push}
        }`
      );
  };
}
