import * as THREE from 'three';
import { fbm } from './noise';
import { makeOutline } from '../render/toon';

export const PLANET_RADIUS = 50;
export const WATER_Y = 1.2;
const AMP = 9;

export function sampleHeight(dir: THREE.Vector3): number {
  const contour = fbm(dir.x, dir.y, dir.z, 4, 0.55) * 3.6 - 1.0;
  const hills = (fbm(dir.x, dir.y, dir.z, 2, 1.4) - 0.5) * 1.2;
  const detail = (fbm(dir.x, dir.y, dir.z, 3, 2.8) - 0.5) * 0.55;
  return (contour + hills + detail) * AMP;
}

export interface Planet {
  group: THREE.Group;
  mesh: THREE.Mesh;
}

const SEA_FLOOR = new THREE.Color('#3a5f63');
const SAND = new THREE.Color('#e8d5a0');
const GRASS = new THREE.Color('#82bb6d');
const FOREST = new THREE.Color('#4f8f4c');
const ROCK = new THREE.Color('#a09a8c');
const PEAK = new THREE.Color('#e8e6de');

const ANCHORS: Array<[number, THREE.Color]> = [
  [WATER_Y - 0.6, SEA_FLOOR],
  [WATER_Y + 0.3, SAND],
  [3.4, GRASS],
  [6.8, FOREST],
  [10.5, ROCK],
  [14, PEAK],
];

function terrainColor(h: number, out: THREE.Color): void {
  if (h <= ANCHORS[0][0]) {
    out.copy(ANCHORS[0][1]);
    return;
  }
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const [h0, c0] = ANCHORS[i];
    const [h1, c1] = ANCHORS[i + 1];
    if (h <= h1) {
      const t = THREE.MathUtils.smoothstep(h, h0, h1);
      out.copy(c0).lerp(c1, t);
      return;
    }
  }
  out.copy(ANCHORS[ANCHORS.length - 1][1]);
}

export function createPlanet(gradientMap: THREE.Texture): Planet {
  const geo = new THREE.IcosahedronGeometry(PLANET_RADIUS, 5);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const count = pos.count;

  const colors = new Float32Array(count * 3);
  const dir = new THREE.Vector3();
  const color = new THREE.Color();

  for (let i = 0; i < count; i++) {
    dir.fromBufferAttribute(pos, i).normalize();
    const h = sampleHeight(dir);
    const r = PLANET_RADIUS + h;
    pos.setXYZ(i, dir.x * r, dir.y * r, dir.z * r);
    terrainColor(h, color);
    const flicker = fbm(dir.x * 3.1, dir.y * 3.1, dir.z * 3.1, 1, 1) * 0.06 + 0.97;
    colors[i * 3] = color.r * flicker;
    colors[i * 3 + 1] = color.g * flicker;
    colors[i * 3 + 2] = color.b * flicker;
  }

  pos.needsUpdate = true;
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const flat = geo.index ? geo.toNonIndexed() : geo;
  flat.computeVertexNormals();
  flat.computeBoundsTree();

  const material = new THREE.MeshToonMaterial({
    vertexColors: true,
    gradientMap,
  });

  const mesh = new THREE.Mesh(flat, material);
  makeOutline(mesh, 0.006);

  const group = new THREE.Group();
  group.add(mesh);
  return { group, mesh };
}

export function findLandStart(radius: number, sample: (d: THREE.Vector3) => number): THREE.Vector3 {
  const dir = new THREE.Vector3();
  for (let i = 0; i < 200; i++) {
    dir.set(
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1
    ).normalize();
    const h = sample(dir);
    if (h > 3) {
      return dir.multiplyScalar(radius + h);
    }
  }
  dir.set(0.3, 0.5, 0.8).normalize();
  return dir.multiplyScalar(radius + sample(dir));
}
