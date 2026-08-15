import * as THREE from 'three';
import { fbm, ridged } from './noise';
import { makeOutline } from '../render/toon';

export const PLANET_RADIUS = 50;
export const WATER_Y = 1.2;

// The noise is sampled on the unit direction vector, so one noise cell spans 50/freq world
// units and fbm's mean is well below 0.5 at low frequencies. Every constant below was tuned
// against measured statistics rather than picked by eye.
const CONT_FREQ = 1.4;
const SEA_T = 0.4752; // calibrated for ~35% land
const SHELF = 0.065;
const SHELF_SEA = 0.05;
const PLAIN_H = 5; // coastal plain must clear wonders.ts WATER_CLEARANCE or nothing places
const INLAND_SLOPE = 20;
const OCEAN_D = 5.5;
const MTN_FREQ = 1.2;
const MTN_AMP = 20;
const MTN_POW = 1.6; // pushes ground between ridges down, which is what makes real valleys
const MTN_MASK_FREQ = 1.3;
const HILL_FREQ = 2.3;
const HILL_AMP = 2.4;
const PLAT_MASK_FREQ = 1.6;
const PLAT_STEP = 3;
const VAL_FREQ = 2.55;
const VAL_DEPTH = 3;
// Offsets decorrelate the masks; added before the frequency multiply so they shift many cells.
const O1 = 17.3;
const O2 = -31.7;
const O3 = 53.1;

const sstep = (x: number, a: number, b: number): number => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Smooth quantisation into flat treads separated by quick risers, i.e. mesas.
function terraceStep(h: number, step: number, lo: number, hi: number): number {
  const s = h / step;
  const i = Math.floor(s);
  return (i + sstep(s - i, lo, hi)) * step;
}

export function sampleHeight(dir: THREE.Vector3): number {
  const { x, y, z } = dir;

  // Continents: one low-frequency field decides land vs ocean, so land forms coherent masses
  // with real coastlines instead of noise speckle.
  const s = fbm(x, y, z, 3, CONT_FREQ) - SEA_T;

  let base: number;
  let land: number;
  if (s > 0) {
    land = sstep(s, 0, SHELF);
    base = land * PLAIN_H + Math.max(0, s - SHELF) * INLAND_SLOPE;
  } else {
    land = 0;
    base = -OCEAN_D * sstep(-s, 0, SHELF_SEA);
  }

  // Mountains, gated into belts and multiplied by land so no peak rises out of open sea.
  const belt = sstep(fbm(x + O1, y + O1, z + O1, 2, MTN_MASK_FREQ), 0.47, 0.62);
  const mm = belt * land;
  let h = base;
  if (mm > 0.001) {
    h += Math.pow(ridged(x, y, z, 4, MTN_FREQ, 2.03), MTN_POW) * mm * MTN_AMP;
  }

  h += (fbm(x, y, z, 3, HILL_FREQ) - 0.5) * HILL_AMP * (0.2 + 0.8 * land);

  // Plateaus: quantise into flat bands away from the peaks. This is what gives the wonders
  // naturally level ground to stand on.
  const pm =
    sstep(fbm(x + O2, y + O2, z + O2, 2, PLAT_MASK_FREQ), 0.42, 0.54) * land * (1 - 0.65 * belt);
  if (pm > 0.001) {
    h += (terraceStep(h, PLAT_STEP, 0.38, 0.62) - h) * pm;
  }

  // Valleys: the crest of a low-octave ridged field is a naturally connected dendritic
  // network, so subtracting it carves channels that run between peaks down to the sea.
  if (land > 0.001) {
    h -= sstep(ridged(x + O3, y + O3, z + O3, 2, VAL_FREQ), 0.72, 1) * VAL_DEPTH * land;
  }

  return h;
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
  [6.0, FOREST],
  [8.7, ROCK],
  [14.1, PEAK],
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
  // detail 39 gives a ~1.5-unit edge, about one player height, which is the coarsest mesh
  // that can actually express a valley or a terrace riser.
  const geo = new THREE.IcosahedronGeometry(PLANET_RADIUS, 39);
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

export interface Terrace {
  dir: THREE.Vector3;
  angle: number;
}

// Levels a tangent-plane pad under each wonder so flat-based models seat flush, blending out
// so the terrace eases into the terrain instead of ending in a cliff. Terrain noise dwarfs
// sphere curvature at these footprints, so flattening the ground beats bending the models.
export function carveTerraces(planet: Planet, terraces: Terrace[]): void {
  const geo = planet.mesh.geometry;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = geo.attributes.color as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const color = new THREE.Color();

  for (const t of terraces) {
    const centerR = PLANET_RADIUS + sampleHeight(t.dir);
    // ponytail: a wide blend seats models better but each terrace drags a cap of terrain with
    // it, and seven of them can reshape the whole planet. 2x keeps the total footprint sane.
    const blend = t.angle * 2;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      dir.copy(p).normalize();
      const a = Math.acos(THREE.MathUtils.clamp(dir.dot(t.dir), -1, 1));
      if (a >= blend) continue;
      const w = 1 - THREE.MathUtils.smoothstep(a, t.angle, blend);
      const target = centerR / Math.cos(a);
      const r = THREE.MathUtils.lerp(p.length(), target, w);
      pos.setXYZ(i, dir.x * r, dir.y * r, dir.z * r);
    }
  }

  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    dir.copy(p).normalize();
    terrainColor(p.length() - PLANET_RADIUS, color);
    const flicker = fbm(dir.x * 3.1, dir.y * 3.1, dir.z * 3.1, 1, 1) * 0.06 + 0.97;
    colors.setXYZ(i, color.r * flicker, color.g * flicker, color.b * flicker);
  }

  pos.needsUpdate = true;
  colors.needsUpdate = true;
  geo.computeVertexNormals();
  geo.disposeBoundsTree();
  geo.computeBoundsTree();
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
