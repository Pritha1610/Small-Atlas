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
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uBelow;
      varying vec3 vWorld;
      void main() {
        float h = normalize(vWorld).y;
        vec3 sky = mix(uHorizon, uZenith, smoothstep(-0.05, 0.55, h));
        sky = mix(uBelow, sky, smoothstep(-0.35, -0.02, h));
        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1260, 32, 16), material);
  mesh.renderOrder = -1;
  return { mesh, horizonColor: HORIZON.clone() };
}
