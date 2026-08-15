import * as THREE from 'three';

export const windTime = { value: 0 };

// Sways geometry in the vertex shader by injecting into the existing MeshToonMaterial rather
// than replacing it, so toon banding, fog and instancing all keep working untouched and the
// per-frame cost is a single uniform write instead of thousands of matrix updates.
// heightScale 0 sways a whole instance uniformly (tree canopies); above 0 bends from the base
// upward so only the tips move (grass).
export function applyWind(material: THREE.Material, amount: number, heightScale: number): void {
  const influence =
    heightScale > 0 ? `clamp(transformed.y / ${heightScale.toFixed(3)}, 0.0, 1.0)` : '1.0';

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windTime;
    shader.vertexShader =
      'uniform float uTime;\n' +
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
        }`
      );
  };
}
