import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PLANET_RADIUS, WATER_Y } from './planet';
import { applyWind } from '../render/wind';
import { loadModel } from './assets';

// Real tree models are ~2,400 triangles against the 56 of the old cylinder-and-blob, so the
// count comes down hard. Chunked culling means only the ~2% over the horizon is ever drawn, but
// there is no reason to carry more instances than the world needs.
const TREE_COUNT = 650;
const BUSH_COUNT = 550;
const GRASS_COUNT = 46000;
const TREE_MODELS = ['Tree_Broad', 'Tree_Tall', 'Tree_Slim'];
const BUSH_MODELS = ['Bush', 'Bush_Berry'];
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export interface Props {
  group: THREE.Group;
}

/**
 * Somewhere vegetation is kept down. People clear the ground they build on, and the approach to
 * a monument is kept open, so flora thins toward the centre instead of growing through walls.
 */
export interface Clearing {
  position: THREE.Vector3;
  /** Beyond this the clearing has no effect. */
  radius: number;
  /** Density right at the centre. 0 = bare earth, 0.35 = thinned but still green. */
  floor: number;
}

/** Probability a plant survives at this point, given every clearing near it. */
function densityAt(pos: THREE.Vector3, clearings: Clearing[]): number {
  let keep = 1;
  for (const c of clearings) {
    const d = pos.distanceTo(c.position);
    if (d >= c.radius) continue;
    // Smoothstep out from the centre so the edge of a clearing is a gradient, not a circle.
    const t = d / c.radius;
    const eased = t * t * (3 - 2 * t);
    keep = Math.min(keep, c.floor + (1 - c.floor) * eased);
  }
  return keep;
}

/**
 * Flattens a model into ONE geometry with its material colours baked into vertex colours.
 *
 * Each tree ships as a trunk mesh and a foliage mesh with separate materials. Instancing them
 * separately would mean two InstancedMesh objects per tree type per chunk; baking the colours
 * into the vertices lets a whole tree be a single instanced draw while keeping its two tones.
 */
function bakeToVertexColors(root: THREE.Object3D): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const col = mat.color ?? new THREE.Color(0xffffff);
    const n = geo.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    for (const key of Object.keys(geo.attributes)) {
      if (key !== 'position' && key !== 'normal' && key !== 'color') geo.deleteAttribute(key);
    }
    parts.push(geo);
  });
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts, false);
  if (merged) merged.computeBoundingSphere();
  return merged;
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
  minFlat: number,
  clearings: Clearing[]
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
    if (Math.random() > densityAt(pos, clearings)) continue;
    spots.push({ pos: pos.clone(), up });
  }
  return spots;
}

// A blade is a two-triangle strip that tapers AND leans, so a tuft reads as grass rather than
// as a fan of flat rectangles. The lean is baked into the geometry because bending it in the
// shader would fight the wind injection, which already moves the tips.
function blade(width: number, height: number, lean: number): THREE.BufferGeometry {
  const w = width / 2;
  const t = width * 0.14;
  const mid = height * 0.55;
  const geo = new THREE.BufferGeometry();
  // base-left, base-right, mid-right, mid-left, tip: a slight S so the silhouette curves over.
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        -w, 0, 0,
        w, 0, 0,
        t, mid, lean * 0.35,
        -t, mid, lean * 0.35,
        0, height, lean,
      ],
      3
    )
  );
  geo.setIndex([0, 1, 2, 0, 2, 3, 3, 2, 4]);
  geo.computeVertexNormals();
  return geo;
}

function grassTuft(): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = [];
  // A couple of tall wispy blades among shorter ones is what stops a field looking mown.
  const n = 5;
  for (let i = 0; i < n; i++) {
    const tall = i === 0 || (i === 1 && Math.random() < 0.5);
    const h = tall ? 1.15 + Math.random() * 0.55 : 0.5 + Math.random() * 0.45;
    const b = blade(0.2 + Math.random() * 0.1, h, (0.12 + Math.random() * 0.3) * (tall ? 1.4 : 1));
    b.rotateY((i / n) * Math.PI * 2 + Math.random() * 0.7);
    b.translate((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3);
    blades.push(b);
  }
  return mergeGeometries(blades, false)!;
}

// Frustum culling is per-object, so one globe-spanning InstancedMesh is always drawn in full;
// splitting the scatter into cells turns that into a cull of nearly everything.
//
// The cell has to be SMALL RELATIVE TO THE VIEW or the cull does nothing: at 96 cells the median
// cell radius measured 12.6 units against a visible cap of ~23, so any cell touching the frustum
// dumped its whole contents and flora drew 1.1M triangles. Finer cells trade a few more frustum
// tests, which are almost free, for a large cut in triangles.
const CHUNKS = 260;

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

export async function createProps(
  gradientMap: THREE.Texture,
  planetMesh: THREE.Mesh,
  clearings: Clearing[] = []
): Promise<Props> {
  const group = new THREE.Group();
  const sampler = new MeshSurfaceSampler(planetMesh).build();

  // Trees are cleared hardest - nobody leaves a canopy over their roof - while grass creeps
  // back in, so it keeps a higher floor and a tighter radius than the trees do.
  const treeClear = clearings;
  // Grass creeps back where trees cannot, so it keeps a higher floor and a tighter radius. The
  // bump is small on purpose: at +0.25 it swamped the monument clearings entirely, leaving them
  // at 79% of open ground, which read as no clearing at all.
  const grassClear = clearings.map((c) => ({
    position: c.position,
    radius: c.radius * 0.85,
    floor: Math.min(1, c.floor + 0.1),
  }));
  const trees = scatter(sampler, TREE_COUNT, WATER_Y + 2.4, 17, 0.86, treeClear);
  const bushes = scatter(sampler, BUSH_COUNT, WATER_Y + 1.2, 19, 0.82, grassClear);
  const grass = scatter(sampler, GRASS_COUNT, WATER_Y + 0.6, 17, 0.8, grassClear);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  // One material for every plant: the shape and two-tone colouring live in the baked vertex
  // colours, so trees and bushes share a single toon material and still look distinct.
  const floraMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
  applyWind(floraMat, 0.05, 0);

  // White base so the per-instance colours below come through unmultiplied.
  const grassMat = new THREE.MeshToonMaterial({
    color: '#ffffff',
    gradientMap,
    side: THREE.DoubleSide,
  });
  applyWind(grassMat, 0.12, 1);

  const names = [...TREE_MODELS, ...BUSH_MODELS];
  const loaded = await Promise.all(names.map((n) => loadModel(`/models/flora/${n}.glb`)));
  const geoms = loaded.map((l) => bakeToVertexColors(l.root)).filter(Boolean) as THREE.BufferGeometry[];
  const treeGeoms = geoms.slice(0, TREE_MODELS.length);
  const bushGeoms = geoms.slice(TREE_MODELS.length);

  const cells = chunkCells(CHUNKS);

  /** Instances one flora geometry per chunk, so a chunk off the horizon costs nothing. */
  function plant(
    spots: Spot[],
    variants: THREE.BufferGeometry[],
    minScale: number,
    range: number,
    sink: number
  ): void {
    if (variants.length === 0) return;
    partition(spots, cells).forEach((bucket) => {
      if (bucket.length === 0) return;
      // ONE species per cell rather than per plant. Splitting a cell three ways would leave a
      // draw call per tree at this cell size, and a cell of a single species reads as a grove,
      // which is closer to how trees actually grow than an evenly mixed forest.
      const vi = Math.floor(Math.random() * variants.length);
      {
        const list = bucket;
        const mesh = new THREE.InstancedMesh(variants[vi], floraMat, list.length);
        list.forEach((sp, i) => {
          const sc = minScale + Math.random() * range;
          q.setFromUnitVectors(WORLD_UP, sp.up);
          q.multiply(
            new THREE.Quaternion().setFromAxisAngle(WORLD_UP, Math.random() * Math.PI * 2)
          );
          scale.set(sc, sc, sc);
          // Sunk slightly so the base never floats on the faceted ground.
          m.compose(sp.pos.clone().addScaledVector(sp.up, -sink), q, scale);
          mesh.setMatrixAt(i, m);
        });
        mesh.instanceMatrix.needsUpdate = true;
        // Without this the bounding sphere covers only the source geometry at the origin and
        // three culls the whole chunk the moment that origin leaves the frustum.
        mesh.computeBoundingSphere();
        group.add(mesh);
      }
    });
  }

  plant(trees, treeGeoms, 0.7, 0.7, 0.15);
  plant(bushes, bushGeoms, 0.6, 0.6, 0.1);

  // A field of one flat green reads as a carpet. Tinting per instance costs nothing but an
  // instanceColor buffer and is the single biggest change to how the ground looks; drier tones
  // are mixed in near the coast where salt is killing it.
  const GRASS_TONES = [
    new THREE.Color('#6fae5c'),
    new THREE.Color('#5d9b4d'),
    new THREE.Color('#7cb96a'),
    new THREE.Color('#87a95a'),
    new THREE.Color('#9aad63'),
  ];
  const DRY = new THREE.Color('#b3a86a');
  const tuftGeo = grassTuft();
  const tint = new THREE.Color();
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
      tint.copy(GRASS_TONES[Math.floor(Math.random() * GRASS_TONES.length)]);
      // Within ~2.5 units of the waterline the salt has got into it.
      const alt = s.pos.length() - PLANET_RADIUS;
      const salt = 1 - THREE.MathUtils.clamp((alt - WATER_Y) / 2.5, 0, 1);
      if (salt > 0) tint.lerp(DRY, salt * 0.7);
      grassMesh.setColorAt(i, tint);
    });
    grassMesh.instanceMatrix.needsUpdate = true;
    if (grassMesh.instanceColor) grassMesh.instanceColor.needsUpdate = true;
    grassMesh.computeBoundingSphere();
    group.add(grassMesh);
  });

  return { group };
}
