import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PLANET_RADIUS, WATER_Y, sampleHeight, type Terrace } from './planet';
import { loadModel, applyToonMaterial } from './assets';

interface WonderSpec {
  name: string;
  path: string;
}

const WONDERS: WonderSpec[] = [
  { name: 'Giza', path: '/models/Giza.glb' },
  { name: 'ChichenItza', path: '/models/ChichenItza.glb' },
  { name: 'Colosseum', path: '/models/Colosseum.glb' },
  { name: 'GreatWall', path: '/models/GreatWall.glb' },
  { name: 'MachuPicchu', path: '/models/MachuPicchu.glb' },
  { name: 'Petra', path: '/models/Petra.glb' },
  { name: 'TajMahal', path: '/models/TajMahal.glb' },
];

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const MIN_SPAWN_ANGLE = 0.6;
const MIN_HEIGHT = 5;
const MAX_HEIGHT = 10;
const MAX_FOOTPRINT = 18;

// The .glb exports are Blender dioramas: each ships a 300-420 unit ground plate plus its
// own scatter trees. The planet already has terrain and props, so keep only the monument.
const DIORAMA_MATERIALS = new Set([
  'W_grass',
  'W_sand',
  'W_jungle',
  'W_jungle_dk',
  'W_wood',
  'W_moss',
]);

// ponytail: matches on the exporter's material names, so a renamed material silently keeps
// its plate. Visible as a giant slab rather than a subtle bug; revisit if the assets change.
function stripDiorama(root: THREE.Object3D): void {
  const doomed: THREE.Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && DIORAMA_MATERIALS.has((mesh.material as THREE.Material).name)) {
      doomed.push(mesh);
    }
  });
  for (const mesh of doomed) {
    mesh.removeFromParent();
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }
}

function fibonacciSpherePoint(i: number, n: number): THREE.Vector3 {
  const y = 1 - (i / (n - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const phi = Math.PI * (3 - Math.sqrt(5));
  const theta = phi * i;
  return new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r).normalize();
}

const WATER_CLEARANCE = WATER_Y + 4;
const FOOTPRINT_CHECK_ANGLE = MAX_FOOTPRINT / 2 / PLANET_RADIUS;
const MAX_SITE_RELIEF = 3;

// How bad a site is; lower is better. Terrain relief across the footprint, since noise
// (amplitude 9) dwarfs sphere curvature at these footprints, plus heavy penalties for being
// underwater or on top of the player. Penalties stay finite so every candidate is rankable
// and the fallback can always pick the least-bad one.
function siteScore(dir: THREE.Vector3, spawnDir: THREE.Vector3): number {
  const ref = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const t1 = ref.clone().sub(dir.clone().multiplyScalar(dir.dot(ref))).normalize();
  const t2 = dir.clone().cross(t1).normalize();
  const h0 = sampleHeight(dir);
  let lo = h0;
  let hi = h0;
  for (const t of [t1, t1.clone().negate(), t2, t2.clone().negate()]) {
    const probe = dir.clone().addScaledVector(t, FOOTPRINT_CHECK_ANGLE).normalize();
    const h = sampleHeight(probe);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  const drowned = Math.max(0, WATER_CLEARANCE - lo);
  const crowding = dir.angleTo(spawnDir) < MIN_SPAWN_ANGLE ? 1 : 0;
  return hi - lo + drowned * 100 + crowding * 1000;
}

// Searches outward from the wonder's evenly-spaced slot, widening until it finds dry flat
// ground, and keeps the best site seen so it can never fall back to an underwater one.
function findClearDirection(seed: THREE.Vector3, spawnDir: THREE.Vector3): THREE.Vector3 {
  const ref = Math.abs(seed.y) < 0.9 ? WORLD_UP : new THREE.Vector3(1, 0, 0);
  const t1 = ref.clone().sub(seed.clone().multiplyScalar(seed.dot(ref))).normalize();
  const t2 = seed.clone().cross(t1).normalize();
  const best = seed.clone();
  const probe = new THREE.Vector3();
  let bestScore = Infinity;
  for (let i = 0; i < 240; i++) {
    const spread = (i / 240) * 1.2;
    const a = Math.random() * Math.PI * 2;
    probe
      .copy(seed)
      .addScaledVector(t1, Math.cos(a) * spread)
      .addScaledVector(t2, Math.sin(a) * spread)
      .normalize();
    const score = siteScore(probe, spawnDir);
    if (score < bestScore) {
      bestScore = score;
      best.copy(probe);
    }
    if (score <= MAX_SITE_RELIEF) break;
  }
  return best;
}

export interface WonderSite {
  name: string;
  position: THREE.Vector3;
}

export interface Wonders {
  group: THREE.Group;
  collisionMesh: THREE.Mesh;
  terraces: Terrace[];
  sites: WonderSite[];
}

export async function createWonders(gradientMap: THREE.Texture, spawnDir: THREE.Vector3): Promise<Wonders> {
  const group = new THREE.Group();
  const loaded = await Promise.all(WONDERS.map((w) => loadModel(w.path)));

  const collisionGeometries: THREE.BufferGeometry[] = [];
  const terraces: Terrace[] = [];
  const sites: WonderSite[] = [];

  if (import.meta.env.DEV) {
    const stats = loaded.map(({ root }, i) => {
      let tris = 0;
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) tris += (mesh.geometry.attributes.position?.count ?? 0) / 3;
      });
      return { name: WONDERS[i].name, triangles: Math.round(tris) };
    });
    console.table(stats);
  }

  loaded.forEach(({ root }, i) => {
    stripDiorama(root);
    applyToonMaterial(root, gradientMap);

    const seed = fibonacciSpherePoint(i, WONDERS.length);
    const dir = findClearDirection(seed, spawnDir);
    const h = sampleHeight(dir);
    const pos = dir.clone().multiplyScalar(PLANET_RADIUS + h);

    const yawQ = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, Math.random() * Math.PI * 2);
    const alignQ = new THREE.Quaternion().setFromUnitVectors(WORLD_UP, dir);
    const quat = alignQ.clone().multiply(yawQ);

    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = box.getCenter(new THREE.Vector3());
    const height = Math.max(size.y, 0.001);
    const span = Math.max(size.x, size.z, 0.001);
    const targetHeight = MIN_HEIGHT + Math.random() * (MAX_HEIGHT - MIN_HEIGHT);
    // Sprawling models (Giza's spread pyramids, the Great Wall's 388-unit run) would cover a
    // quarter of the planet if sized by height alone, so the footprint caps the scale too.
    const scale = Math.min(targetHeight / height, MAX_FOOTPRINT / span);

    // Centre horizontally as well as seating the base, so the model, its terrace and its
    // collision box all share an origin instead of drifting off each other.
    root.position.x -= center.x;
    root.position.y -= box.min.y;
    root.position.z -= center.z;

    const container = new THREE.Group();
    container.add(root);
    container.scale.setScalar(scale);
    container.position.copy(pos);
    container.quaternion.copy(quat);
    group.add(container);

    terraces.push({ dir: dir.clone(), angle: (span * scale) / 2 / PLANET_RADIUS });
    sites.push({ name: WONDERS[i].name, position: pos.clone() });

    // Collide against the monument's real geometry, not a bounding box: a box walls the player
    // off in open ground and, once he steps inside it, backface culling makes it vanish. Real
    // geometry also lets him walk into the Colosseum and up Chichen Itza's steps.
    container.updateMatrixWorld(true);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geo = mesh.geometry.clone();
      geo.applyMatrix4(mesh.matrixWorld);
      geo.deleteAttribute('normal');
      collisionGeometries.push(geo);
    });
  });

  const merged = mergeGeometries(collisionGeometries, false)!;
  merged.computeBoundsTree();
  // DoubleSide so a player who ends up inside a wall is still pushed back out.
  const proxyMesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  proxyMesh.visible = false;
  group.add(proxyMesh);

  return { group, collisionMesh: proxyMesh, terraces, sites };
}
