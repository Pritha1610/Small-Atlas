import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { PLANET_RADIUS, WATER_Y } from './planet';
import { loadModel, applyToonMaterial } from './assets';
import type { Speaker } from './settlements';

/**
 * Three rare figures, one each at an extreme of the world: the highest ground, the furthest
 * point from where you woke up, and the loneliest stretch of open water. They are not part of
 * any settlement and there is exactly one of each, so finding one means you went somewhere.
 *
 * They use a different 62-bone rig from the settled cast and carry their own animation set, so
 * they are self-contained; the trade is that they have no bailing or shivering, only standing
 * and waiting, which suits people who are not part of a community anyway.
 */
interface Rare {
  file: string;
  name: string;
  voice: Speaker['voice'];
  /** Where in the world this one belongs. */
  place: 'peak' | 'far' | 'sea';
  tint?: Record<string, string>;
}

const RARE: Rare[] = [
  {
    file: 'Walker',
    name: 'The Walker',
    voice: 'adult',
    place: 'far',
    tint: { Skin: '#9c6b45', Red: '#5c4a3a', Brown: '#2a2119', LimeGreen: '#4a5f52' },
  },
  {
    file: 'Drifter',
    name: 'The Drifter',
    voice: 'teen',
    place: 'sea',
    tint: { Skin: '#a5714a' },
  },
  {
    file: 'SaltReader',
    name: 'The Salt-Reader',
    voice: 'elder',
    place: 'peak',
    tint: { Skin: '#8f6240' },
  },
];

/** Height they are scaled to, matching the settled cast rather than their native 1.8-2.0. */
const TARGET_HEIGHT = 1.7;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export interface Specials {
  group: THREE.Group;
  speakers: Speaker[];
  update(playerPos: THREE.Vector3, dt: number): void;
}

export async function createSpecials(
  gradientMap: THREE.Texture,
  planetMesh: THREE.Mesh,
  spawnDir: THREE.Vector3
): Promise<Specials> {
  const group = new THREE.Group();
  const speakers: Speaker[] = [];
  const mixers: { root: THREE.Object3D; mixer: THREE.AnimationMixer }[] = [];

  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true;
  const waterR = PLANET_RADIUS + WATER_Y;

  function surface(dir: THREE.Vector3): THREE.Vector3 | null {
    ray.set(dir.clone().multiplyScalar(PLANET_RADIUS + 48), dir.clone().negate());
    ray.near = 0;
    ray.far = 96;
    const hit = ray.intersectObject(planetMesh, false);
    return hit.length > 0 ? hit[0].point.clone() : null;
  }

  // One sweep of the globe, keeping the best candidate for each extreme.
  let peak: THREE.Vector3 | null = null;
  let far: THREE.Vector3 | null = null;
  let sea: THREE.Vector3 | null = null;
  let peakR = -Infinity;
  let farAngle = -Infinity;
  let seaDepth = -Infinity;
  const probe = new THREE.Vector3();
  for (let i = 0; i < 9000; i++) {
    probe.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
    const p = surface(probe);
    if (!p) continue;
    const r = p.length();
    if (r > peakR) {
      peakR = r;
      peak = p.clone();
    }
    if (r > waterR + 1) {
      const a = probe.angleTo(spawnDir);
      if (a > farAngle) {
        farAngle = a;
        far = p.clone();
      }
    } else {
      // Loneliest water: deepest seabed, which is always well away from any shore.
      const depth = waterR - r;
      if (depth > seaDepth) {
        seaDepth = depth;
        sea = probe.clone().multiplyScalar(waterR);
      }
    }
  }

  const loaded = await Promise.all(RARE.map((r) => loadModel(`/models/special/${r.file}.glb`)));

  RARE.forEach((spec, i) => {
    const spot = spec.place === 'peak' ? peak : spec.place === 'far' ? far : sea;
    if (!spot) return;

    const { root, animations } = loaded[i];
    applyToonMaterial(root, gradientMap);
    if (spec.tint) {
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const hex = spec.tint?.[(mesh.material as THREE.Material).name];
        if (hex) (mesh.material as THREE.MeshToonMaterial).color.set(hex);
      });
    }

    // Measure the SOURCE with its matrices refreshed. Measuring a fresh clone instead reads
    // stale world matrices and returns nonsense - it put two of the three at 4-5 units tall.
    root.updateMatrixWorld(true);
    const size = new THREE.Vector3();
    new THREE.Box3().setFromObject(root).getSize(size);
    const scale = TARGET_HEIGHT / Math.max(size.y, 0.001);

    const body = cloneSkinned(root);
    body.scale.setScalar(scale);

    const dir = spot.clone().normalize();
    body.position.copy(spot);
    body.quaternion
      .setFromUnitVectors(WORLD_UP, dir)
      .multiply(new THREE.Quaternion().setFromAxisAngle(WORLD_UP, Math.random() * Math.PI * 2));
    group.add(body);

    const idle = animations.find((c) => /idle/i.test(c.name)) ?? animations[0];
    if (idle) {
      const mixer = new THREE.AnimationMixer(body);
      const action = mixer.clipAction(idle);
      action.time = Math.random() * idle.duration;
      action.play();
      mixers.push({ root: body, mixer });
    }

    speakers.push({
      id: `rare-${spec.file}`,
      name: spec.name,
      voice: spec.voice,
      band: 'any',
      position: spot.clone(),
    });
  });

  return {
    group,
    speakers,
    update(playerPos, dt) {
      // Three of them, but the same rule as everyone else: no skinning work off-screen.
      for (const m of mixers) {
        if (m.root.position.distanceToSquared(playerPos) < 45 * 45) m.mixer.update(dt);
      }
    },
  };
}
