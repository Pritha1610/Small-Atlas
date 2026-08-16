import * as THREE from 'three';
import { PLANET_RADIUS, WATER_Y } from './planet';
import { windTime } from '../render/wind';

// The sea is what is killing this world, so it stays oversized - but only just enough. These
// were tuned against sea level and the settlement bands, not by eye: at 2.2/0.95/0.35 the crests
// reached altitude 4.6 and put 39 of 46 settlements inside the wave envelope, drowning shore
// towns that are meant to be dry. Now the crests top out around 3, which still washes clean over
// the stilt houses and rafts at the waterline (which is the point) and leaves the shore alone.
/** Peak displacement of the long swell, in world units. Player is ~1.65 tall. */
const SWELL = 1.25;
/** Peak displacement of the shorter chop riding on top of it. */
const CHOP = 0.5;
/** Fast, small-scale turbulence so the surface never looks like a smooth rolling sheet. */
const TURB = 0.2;

/**
 * Height of the water surface above its rest radius at a point, matching the shader below.
 * The controller clamps the player to a FIXED water radius, so anything that floats has to be
 * offset with this or it detaches from the surface in a trough.
 */
export function waveHeight(p: THREE.Vector3, t: number): number {
  const swell =
    Math.sin(p.x * 0.12 + t * 0.78) +
    Math.sin(p.z * 0.09 + t * 1.02) +
    Math.sin(p.y * 0.074 + t * 0.6);
  const chop = Math.sin(p.x * 0.42 - t * 1.35) * Math.sin(p.z * 0.38 + t * 1.05);
  const turb =
    Math.sin(p.x * 1.04 + p.z * 0.94 + t * 2.3) * Math.sin(p.y * 0.88 - t * 1.9);
  return (swell / 3) * SWELL + chop * CHOP + turb * TURB;
}

/** Opacity directly beneath the viewer: low enough to read a drowned settlement through it. */
const NEAR_ALPHA = 0.68;
/**
 * View distance at which the sea has closed up completely, in world units.
 * Sized against the actual sightline, not guessed: with the camera a few units above a water
 * sphere of radius PLANET_RADIUS + WATER_Y, the horizon is only ~23 units away, so NO visible
 * water is ever further off than that. Values well past the horizon put the whole ocean on the
 * shallow part of the ramp and let distant terrain show through, which is the bug this fixes.
 * Closing by 24 leaves a near band to read wrecks through and seals everything beyond.
 */
const OPAQUE_AT = 24;
/** Distance at which the water starts thickening. Below this you get the full near clarity. */
const CLEAR_TO = 5;

export function createWater(gradientMap: THREE.Texture): THREE.Mesh {
  const material = new THREE.MeshToonMaterial({
    // Deeper and greener than open-sky blue: this ocean is meant to look heavy, not tropical.
    color: '#12506b',
    transparent: true,
    opacity: NEAR_ALPHA,
    gradientMap,
  });

  // Same displacement as waveHeight(), evaluated per vertex on the GPU. Injected into the
  // existing toon material rather than replacing it, so banding and fog keep working, and it
  // costs one uniform write per frame instead of touching 25k vertices on the CPU.
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windTime;
    shader.vertexShader =
      'uniform float uTime;\nvarying vec3 vWaterWorld;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float t = uTime;
          float swell = sin(position.x * 0.12 + t * 0.78)
                      + sin(position.z * 0.09 + t * 1.02)
                      + sin(position.y * 0.074 + t * 0.6);
          float chop = sin(position.x * 0.42 - t * 1.35) * sin(position.z * 0.38 + t * 1.05);
          float turb = sin(position.x * 1.04 + position.z * 0.94 + t * 2.3)
                     * sin(position.y * 0.88 - t * 1.9);
          float h = (swell / 3.0) * ${SWELL.toFixed(3)}
                  + chop * ${CHOP.toFixed(3)}
                  + turb * ${TURB.toFixed(3)};
          transformed += normalize(position) * h;
          vWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        }`
      );

    // Opacity by how much WATER the eye is actually looking through, which is what decides
    // whether you can see something under it.
    //
    // View distance alone was not enough: looking out at the horizon the surface point can be
    // only 15 units away while the ray skims through water for hundreds, so distant hills kept
    // showing through a "near" fragment. Grazing angle is the dominant term - the same reason
    // real water is a mirror at the horizon and clear at your feet - so clarity needs BOTH a
    // steep view and a short distance. Anything else closes up.
    shader.fragmentShader =
      'varying vec3 vWaterWorld;\n' +
      shader.fragmentShader.replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        `vec4 diffuseColor = vec4( diffuse, opacity );
        {
          vec3 toEye = cameraPosition - vWaterWorld;
          float viewDist = length(toEye);
          // Sphere, so the surface normal is just the outward radial direction.
          float ndv = clamp(dot(normalize(vWaterWorld), normalize(toEye)), 0.0, 1.0);
          float steep = smoothstep(0.10, 0.55, ndv);
          float near = 1.0 - smoothstep(${CLEAR_TO.toFixed(1)}, ${OPAQUE_AT.toFixed(1)}, viewDist);
          diffuseColor.a = mix(1.0, ${NEAR_ALPHA.toFixed(3)}, steep * near);
        }`
      );
    // Recomputing normals from the displaced surface would need neighbour samples; on a
    // 4-band toon material the banding reads as moving water without them, so the flat-shaded
    // sphere normals are left alone. ponytail: add finite-difference normals if it ever looks
    // too static under a low sun.
  };

  // The old 48x32 sphere had ~20-unit quads at this radius, far too coarse for the chop to show
  // up at all, and the turbulence layer is finer still. ~48k triangles on one draw call.
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(PLANET_RADIUS + WATER_Y, 220, 110),
    material
  );
  mesh.renderOrder = 1;
  return mesh;
}
