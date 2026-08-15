import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PLANET_RADIUS, WATER_Y } from './planet';
import { applyWind } from '../render/wind';

const GREENS = [
  new THREE.Color('#3f8a4a'),
  new THREE.Color('#5aa55a'),
  new THREE.Color('#2e7d3f'),
  new THREE.Color('#68b36b'),
];

const TREE_COUNT = 1600;
const GRASS_COUNT = 46000;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export interface Props {
  group: THREE.Group;
}

interface Spot {
  pos: THREE.Vector3;
  up: THREE.Vector3;
}

// Samples the real planet mesh rather than the analytic height, so props sit on the ground as
// it actually is after the wonder terraces have reshaped it. Rejects anything outside the
// height band or on ground too steep to look planted.
function scatter(
  sampler: MeshSurfaceSampler,
  count: number,
  minH: number,
  maxH: number,
  minFlat: number
): Spot[] {
  const spots: Spot[] = [];
  const pos = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const maxTries = count * 12;
  for (let i = 0; i < maxTries && spots.length < count; i++) {
    sampler.sample(pos, normal);
    const h = pos.length() - PLANET_RADIUS;
    if (h < minH || h > maxH) continue;
    const up = pos.clone().normalize();
    if (normal.dot(up) < minFlat) continue;
    spots.push({ pos: pos.clone(), up });
  }
  return spots;
}

// A blade is a quad that tapers toward the tip: two triangles, but it reads as grass rather
// than as a rectangle standing on end.
function blade(width: number, height: number): THREE.BufferGeometry {
  const w = width / 2;
  const t = width * 0.16;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, t, height, 0, -t, height, 0], 3)
  );
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.computeVertexNormals();
  return geo;
}

function grassTuft(): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const b = blade(0.26, 0.75 + Math.random() * 0.5);
    b.rotateX((Math.random() - 0.5) * 0.5);
    b.rotateY((i / 4) * Math.PI * 2 + Math.random() * 0.4);
    b.translate((Math.random() - 0.5) * 0.25, 0, (Math.random() - 0.5) * 0.25);
    blades.push(b);
  }
  return mergeGeometries(blades, false)!;
}

// Frustum culling is per-object, so one globe-spanning InstancedMesh is always drawn in full.
// At R=150 the horizon is only ~33 units away and the visible ground is ~1% of the sphere, so
// splitting the scatter into cells turns that into a cull of nearly everything. One cell is
// roughly the size of the visible cap; finer than that just adds objects to frustum-test.
const CHUNKS = 96;

function chunkCells(n: number): THREE.Vector3[] {
  const cells: THREE.Vector3[] = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    cells.push(new THREE.Vector3(Math.cos(phi * i) * r, y, Math.sin(phi * i) * r));
  }
  return cells;
}

function partition(spots: Spot[], cells: THREE.Vector3[]): Spot[][] {
  const buckets: Spot[][] = cells.map(() => []);
  for (const s of spots) {
    let best = 0;
    let bestDot = -2;
    for (let i = 0; i < cells.length; i++) {
      const d = s.up.dot(cells[i]);
      if (d > bestDot) {
        bestDot = d;
        best = i;
      }
    }
    buckets[best].push(s);
  }
  return buckets;
}

export function createProps(gradientMap: THREE.Texture, planetMesh: THREE.Mesh): Props {
  const group = new THREE.Group();
  const sampler = new MeshSurfaceSampler(planetMesh).build();

  const trees = scatter(sampler, TREE_COUNT, WATER_Y + 2.4, 17, 0.86);
  const grass = scatter(sampler, GRASS_COUNT, WATER_Y + 0.6, 17, 0.8);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const p = new THREE.Vector3();

  const trunkMat = new THREE.MeshToonMaterial({ color: '#8a6a4a', gradientMap });
  const foliageMat = new THREE.MeshToonMaterial({ color: '#4f8f4c', gradientMap });
  applyWind(foliageMat, 0.05, 0);

  const grassMat = new THREE.MeshToonMaterial({
    color: '#6fae5c',
    gradientMap,
    side: THREE.DoubleSide,
  });
  applyWind(grassMat, 0.12, 1);

  const trunkGeo = new THREE.CylinderGeometry(0.14, 0.22, 1.0, 6);
  const foliageGeo = new THREE.IcosahedronGeometry(0.85, 0);
  const tuftGeo = grassTuft();

  const cells = chunkCells(CHUNKS);

  partition(trees, cells).forEach((bucket) => {
    if (bucket.length === 0) return;
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, bucket.length);
    const foliageMesh = new THREE.InstancedMesh(foliageGeo, foliageMat, bucket.length);
    bucket.forEach((s, i) => {
      const sc = 0.75 + Math.random() * 0.9;
      q.setFromUnitVectors(WORLD_UP, s.up);
      scale.set(sc, sc, sc);
      p.copy(s.pos).addScaledVector(s.up, 0.55 * sc);
      m.compose(p, q, scale);
      trunkMesh.setMatrixAt(i, m);
      p.copy(s.pos).addScaledVector(s.up, 1.6 * sc);
      m.compose(p, q, scale);
      foliageMesh.setMatrixAt(i, m);
      foliageMesh.setColorAt(i, GREENS[Math.floor(Math.random() * GREENS.length)]);
    });
    trunkMesh.instanceMatrix.needsUpdate = true;
    foliageMesh.instanceMatrix.needsUpdate = true;
    if (foliageMesh.instanceColor) foliageMesh.instanceColor.needsUpdate = true;
    // Without this the bounding sphere covers only the base geometry at the origin and three
    // culls the whole chunk the moment the origin leaves the frustum.
    trunkMesh.computeBoundingSphere();
    foliageMesh.computeBoundingSphere();
    group.add(trunkMesh, foliageMesh);
  });

  partition(grass, cells).forEach((bucket) => {
    if (bucket.length === 0) return;
    const grassMesh = new THREE.InstancedMesh(tuftGeo, grassMat, bucket.length);
    bucket.forEach((s, i) => {
      const sc = 0.55 + Math.random() * 0.5;
      q.setFromUnitVectors(WORLD_UP, s.up);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(WORLD_UP, Math.random() * Math.PI * 2));
      scale.set(sc, sc, sc);
      m.compose(s.pos, q, scale);
      grassMesh.setMatrixAt(i, m);
    });
    grassMesh.instanceMatrix.needsUpdate = true;
    grassMesh.computeBoundingSphere();
    group.add(grassMesh);
  });

  return { group };
}
