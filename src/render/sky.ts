import * as THREE from 'three';

const ZENITH = new THREE.Color('#4a90d9');
const HORIZON = new THREE.Color('#f0d9a8');
const BELOW = new THREE.Color('#c88b6a');

export interface Sky {
  mesh: THREE.Mesh;
  horizonColor: THREE.Color;
}

export function createSky(): Sky {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: ZENITH },
      uHorizon: { value: HORIZON },
      uBelow: { value: BELOW },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        // The direction from the VIEWER, taken from the local position. The dome is pinned to
        // the camera and never rotated, so local axes are world axes - and keying the gradient
        // off the world position instead would swing the horizon band around as the dome moved.
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uBelow;
      varying vec3 vDir;
      void main() {
        float h = normalize(vDir).y;
        vec3 sky = mix(uHorizon, uZenith, smoothstep(-0.05, 0.55, h));
        sky = mix(uBelow, sky, smoothstep(-0.35, -0.02, h));
        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });

  // Small, and pinned to the camera every frame (see main.ts). A world-centred dome would have
  // to be bigger than the planet, which forces a far plane big enough to swallow the whole globe
  // - and a downward-tilted frustum then drives straight through the planet and draws the far
  // side of the world, invisible behind the terrain but fully submitted. Riding the camera lets
  // the far plane sit just past the fog instead.
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(88, 32, 16), material);
  mesh.renderOrder = -1;
  // It follows the camera, so its own bounds mean nothing.
  mesh.frustumCulled = false;
  return { mesh, horizonColor: HORIZON.clone() };
}
