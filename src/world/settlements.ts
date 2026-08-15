import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PLANET_RADIUS, WATER_Y, sampleHeight } from './planet';
import { loadModel, applyToonMaterial } from './assets';
import type { Band as StoryBand, Voice } from '../story/dialogue';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

// The world is drowning, and elevation is the story. Ruins sit at the waterline where the sea
// already took them, the stubborn still live on stilts and rafts just above it, and everyone
// else has retreated uphill. Each band gets the kit that belongs to it.
interface Band {
  kind: string;
  loH: number;
  hiH: number;
  kit: string[];
  /** 0 = ruin, nobody left. 1 = fully lived in. */
  life: number;
  count: [number, number];
}

const BANDS: Band[] = [
  {
    kind: 'drowned',
    loH: WATER_Y - 3.5,
    hiH: WATER_Y + 0.75,
    kit: ['S_HalfSunk', 'S_RoofShack', 'S_StiltHouse', 'S_Pontoon'],
    life: 0,
    count: [3, 6],
  },
  {
    kind: 'waterline',
    loH: WATER_Y + 0.75,
    hiH: WATER_Y + 4.5,
    kit: [
      'S_StiltHouse',
      'S_StiltCluster',
      'S_Pontoon',
      'S_RaftHome',
      'S_BoatHome',
      'S_FloatMarket',
      'S_NetHut',
      'S_WaterCollector',
    ],
    life: 1,
    count: [4, 8],
  },
  {
    kind: 'shore',
    loH: WATER_Y + 4.5,
    hiH: 12,
    kit: ['S_Shanty', 'S_AFrame', 'S_LeanTo', 'S_Container', 'S_CartHome', 'S_NetHut', 'S_RoofShack'],
    life: 0.6,
    count: [4, 8],
  },
  {
    kind: 'upland',
    loH: 12,
    hiH: 22,
    kit: ['S_Yurt', 'S_TerraceHouse', 'S_Watchtower', 'S_AFrame', 'S_CartHome', 'S_WaterCollector'],
    life: 1,
    count: [4, 9],
  },
  {
    kind: 'mountain',
    loH: 22,
    hiH: 39,
    kit: ['M_AFrameHigh', 'M_LeanToRock', 'M_SledCart', 'M_YurtStone', 'S_Watchtower'],
    life: 1,
    count: [3, 6],
  },
  {
    kind: 'cave',
    loH: 10,
    hiH: 30,
    kit: ['C_CaveHearth', 'C_CaveMouthTent', 'C_CaveRack', 'C_CaveWall', 'S_CliffCave', 'S_RockShelter'],
    life: 1,
    count: [3, 5],
  },
];

const NPC_ADULTS = [
  'Anzu_adult',
  'Devi_adult',
  'Hana_adult',
  'Marek_adult',
  'Odd_adult',
  'Pell_adult',
  'Suri_adult',
];
const NPC_KIDS = ['Kalyani_child', 'Ravi_child', 'Meera_kid', 'Tan_kid'];
const NPC_TEENS = ['Bhaskar_teen', 'Ilo_teen'];
const NPC_ELDERS = ['Amma_Vasi', 'Old_Neru'];

// Bailing water and hauling belong at the waterline; shivering and sitting belong to the people
// who have stopped fighting it. Picking the clip from the band is most of the storytelling.
const CLIPS_BY_BAND: Record<string, string[]> = {
  waterline: ['Work_Bail', 'Work_Haul', 'Work_Sort', 'Idle_Scan', 'Talk_Point'],
  shore: ['Work_Hammer', 'Work_Sort', 'Idle_WeightShift', 'Talk_Shrug', 'Rest_Lean'],
  upland: ['Work_Hammer', 'Work_Haul', 'Idle_ArmsCrossed', 'Talk_Explain', 'Talk_Nod'],
  mountain: ['Idle_Shiver', 'Idle_ArmsCrossed', 'Rest_Lean', 'Idle_Scan'],
  cave: ['Rest_Sit', 'Idle_Shiver', 'Work_Sort', 'Rest_Lean'],
};
const ELDER_CLIPS = ['Rest_Sit', 'Rest_Lean', 'Idle_WeightShift', 'Idle_Scan'];
const KID_CLIPS = ['Kid_Bounce', 'Kid_Fidget', 'Kid_Jump'];

const SETTLEMENT_SLOTS = 46;
const MIN_SEPARATION = 0.17; // radians between settlements
/** Only NPCs this close to the player get their mixer stepped. */
const ANIM_RANGE = 45;
// Every NPC is a skinned mesh with its own skeleton, so this is the real budget knob. A
// resident per house reads as a crowd, not as the last people in a drowning world.
const MAX_RESIDENTS = 95;
const RESIDENT_CHANCE = 0.85;

const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

function fib(i: number, n: number): THREE.Vector3 {
  const y = 1 - (i / (n - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const phi = Math.PI * (3 - Math.sqrt(5));
  return new THREE.Vector3(Math.cos(phi * i) * r, y, Math.sin(phi * i) * r).normalize();
}

function tangents(dir: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const ref = Math.abs(dir.y) < 0.9 ? WORLD_UP : new THREE.Vector3(1, 0, 0);
  const t1 = ref.clone().sub(dir.clone().multiplyScalar(dir.dot(ref))).normalize();
  return [t1, dir.clone().cross(t1).normalize()];
}

/** Local relief over a settlement-sized footprint; caves want steep ground, everyone else flat. */
function relief(dir: THREE.Vector3, angle: number): number {
  const [t1, t2] = tangents(dir);
  let lo = Infinity;
  let hi = -Infinity;
  for (const t of [t1, t1.clone().negate(), t2, t2.clone().negate()]) {
    const h = sampleHeight(dir.clone().addScaledVector(t, angle).normalize());
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  return hi - lo;
}

/** Someone the player can talk to, exposed so the story layer can find the nearest one. */
export interface Speaker {
  id: string;
  name: string;
  voice: Voice;
  band: StoryBand;
  position: THREE.Vector3;
}

/** A place the player can examine: a settlement centre or a drowned ruin. */
export interface Landmark {
  target: string;
  position: THREE.Vector3;
}

export interface Settlements {
  group: THREE.Group;
  collisionMesh: THREE.Mesh;
  speakers: Speaker[];
  landmarks: Landmark[];
  update(playerPos: THREE.Vector3, dt: number): void;
}

interface Occupied {
  box: THREE.Box3;
  inv: THREE.Matrix4;
}

interface Resident {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
}

export async function createSettlements(
  gradientMap: THREE.Texture,
  planetMesh: THREE.Mesh,
  avoid: THREE.Vector3[]
): Promise<Settlements> {
  const group = new THREE.Group();

  // One load per model; every instance is a skeleton clone of the converted original, so the
  // toon conversion and the material set are shared rather than rebuilt per resident.
  const structureNames = [...new Set(BANDS.flatMap((b) => b.kit))];
  const npcNames = [...NPC_ADULTS, ...NPC_KIDS, ...NPC_TEENS, ...NPC_ELDERS];

  const [structures, npcs] = await Promise.all([
    Promise.all(structureNames.map((n) => loadModel(`/models/structures/${n}.glb`))),
    Promise.all(npcNames.map((n) => loadModel(`/models/npcs/${n}.glb`))),
  ]);

  const structureByName = new Map<string, THREE.Object3D>();
  structureNames.forEach((n, i) => {
    applyToonMaterial(structures[i].root, gradientMap);
    structureByName.set(n, structures[i].root);
  });

  const npcByName = new Map<string, { root: THREE.Object3D; clips: THREE.AnimationClip[] }>();
  npcNames.forEach((n, i) => {
    applyToonMaterial(npcs[i].root, gradientMap);
    npcByName.set(n, { root: npcs[i].root, clips: npcs[i].animations });
  });

  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true;
  const down = new THREE.Vector3();

  /** Exact surface point and face normal along a direction, or null where the ray misses. */
  function surfaceHit(dir: THREE.Vector3): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
    ray.set(dir.clone().multiplyScalar(PLANET_RADIUS + 48), down.copy(dir).negate());
    ray.near = 0;
    ray.far = 96;
    const hit = ray.intersectObject(planetMesh, false);
    if (hit.length === 0 || !hit[0].face) return null;
    const normal = hit[0].face.normal.clone().transformDirection(planetMesh.matrixWorld).normalize();
    return { point: hit[0].point.clone(), normal };
  }

  function surfacePoint(dir: THREE.Vector3): THREE.Vector3 | null {
    return surfaceHit(dir)?.point ?? null;
  }

  // Horizontal reach and untransformed bounds of each building, so residents can be stood
  // clear of the walls rather than inside them.
  const footprint = new Map<string, number>();
  const protoBox = new Map<string, THREE.Box3>();
  for (const [name, proto] of structureByName) {
    const box = new THREE.Box3().setFromObject(proto);
    const size = new THREE.Vector3();
    box.getSize(size);
    footprint.set(name, Math.max(size.x, size.z) / 2);
    protoBox.set(name, box.clone().expandByScalar(0.6));
  }

  /**
   * A spot to stand: outside the building's footprint and on ground flat enough that a
   * radially-upright person does not bury a foot in the slope.
   */
  function standingSpot(
    center: THREE.Vector3,
    t1: THREE.Vector3,
    t2: THREE.Vector3,
    clearance: number,
    occupied: Occupied[]
  ): { point: THREE.Vector3; dir: THREE.Vector3 } | null {
    const waterR = PLANET_RADIUS + WATER_Y;
    const local = new THREE.Vector3();
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = clearance + 1.5 + Math.random() * 4.5;
      const nd = center
        .clone()
        .addScaledVector(t1, (Math.cos(a) * r) / PLANET_RADIUS)
        .addScaledVector(t2, (Math.sin(a) * r) / PLANET_RADIUS)
        .normalize();
      const hit = surfaceHit(nd);
      if (!hit) continue;
      if (hit.normal.dot(nd) < 0.95) continue; // too steep to stand on

      // Seat on the HIGHEST ground under the body's footprint, not the centre sample: on any
      // slope the centre sits below the uphill side and a foot ends up in the dirt.
      let radius = hit.point.length();
      const [f1, f2] = tangents(nd);
      for (const t of [f1, f1.clone().negate(), f2, f2.clone().negate()]) {
        const probe = surfaceHit(nd.clone().addScaledVector(t, 0.35 / PLANET_RADIUS).normalize());
        if (probe) radius = Math.max(radius, probe.point.length());
      }
      const point = nd.clone().multiplyScalar(Math.max(radius, waterR));

      // Oriented test: a world-axis box around a building tilted on a sphere is far bigger than
      // the building, and would reject half the settlement as "occupied".
      const body = point.clone().addScaledVector(nd, 0.9);
      const blocked = occupied.some((o) => o.box.containsPoint(local.copy(body).applyMatrix4(o.inv)));
      if (blocked) continue;
      return { point, dir: nd };
    }
    return null;
  }

  const collisionGeometries: THREE.BufferGeometry[] = [];
  const residents: Resident[] = [];
  const speakers: Speaker[] = [];
  const landmarks: Landmark[] = [];
  const chosen: THREE.Vector3[] = [];

  for (let slot = 0; slot < SETTLEMENT_SLOTS; slot++) {
    const seed = fib(slot, SETTLEMENT_SLOTS);
    const [s1, s2] = tangents(seed);

    // Wander outward from the slot looking for ground that suits some band.
    let dir: THREE.Vector3 | null = null;
    let band: Band | null = null;
    for (let attempt = 0; attempt < 90; attempt++) {
      const spread = (attempt / 90) * 0.5;
      const a = Math.random() * Math.PI * 2;
      const probe = seed
        .clone()
        .addScaledVector(s1, Math.cos(a) * spread)
        .addScaledVector(s2, Math.sin(a) * spread)
        .normalize();

      if (avoid.some((v) => probe.angleTo(v) < 0.14)) continue;
      if (chosen.some((v) => probe.angleTo(v) < MIN_SEPARATION)) continue;

      const h = sampleHeight(probe);
      const rel = relief(probe, 7 / PLANET_RADIUS);
      // Caves want a steep face; everything else wants ground you could build on.
      const wantsSteep = rel > 4.5;
      const candidates = BANDS.filter(
        (b) => h >= b.loH && h < b.hiH && (b.kind === 'cave') === wantsSteep
      );
      if (candidates.length === 0) continue;
      dir = probe;
      band = pick(candidates);
      break;
    }
    if (!dir || !band) continue;
    chosen.push(dir.clone());
    const centre = surfacePoint(dir);
    if (centre) {
      landmarks.push({
        target: `place:${band.kind === 'drowned' ? 'drowned' : band.kind}`,
        position: centre.clone(),
      });
    }

    const [t1, t2] = tangents(dir);
    const n = band.count[0] + Math.floor(Math.random() * (band.count[1] - band.count[0] + 1));
    const spreadUnits = 5 + n * 0.9;
    const placed: Occupied[] = [];
    const pending: Array<{ sdir: THREE.Vector3; clearance: number }> = [];

    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * spreadUnits;
      const sdir = dir
        .clone()
        .addScaledVector(t1, (Math.cos(a) * rad) / PLANET_RADIUS)
        .addScaledVector(t2, (Math.sin(a) * rad) / PLANET_RADIUS)
        .normalize();

      const ground = surfacePoint(sdir);
      if (!ground) continue;

      const kitName = pick(band.kit);
      const proto = structureByName.get(kitName);
      if (!proto) continue;
      const model = proto.clone(true);

      // Drowned ruins sink into the sea rather than sitting on the seabed, and waterline homes
      // stand in the shallows, so both are keyed to the water sphere instead of the terrain.
      let seat = ground;
      if (band.kind === 'drowned') {
        seat = sdir.clone().multiplyScalar(PLANET_RADIUS + WATER_Y - 0.6 - Math.random() * 1.8);
      } else if (band.kind === 'waterline' && ground.length() < PLANET_RADIUS + WATER_Y) {
        seat = sdir.clone().multiplyScalar(PLANET_RADIUS + WATER_Y - 0.3);
      }

      const quat = new THREE.Quaternion()
        .setFromUnitVectors(WORLD_UP, sdir)
        .multiply(new THREE.Quaternion().setFromAxisAngle(WORLD_UP, Math.random() * Math.PI * 2));

      // Abandoned places lean. A few degrees of tilt reads as subsidence without looking broken.
      if (Math.random() > band.life) {
        const [a1] = tangents(sdir);
        quat.premultiply(
          new THREE.Quaternion().setFromAxisAngle(a1, (Math.random() - 0.5) * 0.22)
        );
      }

      model.position.copy(seat);
      model.quaternion.copy(quat);
      group.add(model);

      model.updateMatrixWorld(true);
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const geo = mesh.geometry.clone();
        geo.applyMatrix4(mesh.matrixWorld);
        geo.deleteAttribute('normal');
        if (geo.attributes.uv) geo.deleteAttribute('uv');
        collisionGeometries.push(geo);
      });
      // Stored as an oriented volume: the model's own bounds plus the inverse of its world
      // matrix, so the containment test happens in the building's frame.
      const pbox = protoBox.get(kitName);
      if (pbox) placed.push({ box: pbox, inv: model.matrixWorld.clone().invert() });

      // Ruined bands get nobody, which is what makes them read as lost. Deferred until every
      // building in this settlement exists, so a resident can be kept out of ALL of them and
      // not just the one they belong to.
      if (Math.random() < band.life * RESIDENT_CHANCE) {
        pending.push({ sdir, clearance: footprint.get(kitName) ?? 3 });
      }
    }

    for (const req of pending) {
      if (residents.length >= MAX_RESIDENTS) break;
      const roll = Math.random();
      const name =
        roll < 0.22
          ? pick(NPC_KIDS)
          : roll < 0.34
            ? pick(NPC_ELDERS)
            : roll < 0.46
              ? pick(NPC_TEENS)
              : pick(NPC_ADULTS);
      const entry = npcByName.get(name);
      if (!entry) continue;

      const spot = standingSpot(req.sdir, t1, t2, req.clearance, placed);
      if (!spot) continue; // nowhere clear to stand; better absent than inside a wall

      const npc = cloneSkinned(entry.root);
      npc.position.copy(spot.point);
      npc.quaternion
        .setFromUnitVectors(WORLD_UP, spot.dir)
        .multiply(new THREE.Quaternion().setFromAxisAngle(WORLD_UP, Math.random() * Math.PI * 2));
      group.add(npc);

      const mixer = new THREE.AnimationMixer(npc);
      const pool = NPC_KIDS.includes(name)
        ? KID_CLIPS
        : NPC_ELDERS.includes(name)
          ? ELDER_CLIPS
          : (CLIPS_BY_BAND[band.kind] ?? ELDER_CLIPS);
      const clip = THREE.AnimationClip.findByName(entry.clips, pick(pool)) ?? entry.clips[0];
      if (clip) {
        const action = mixer.clipAction(clip);
        // Offset the start so a settlement does not breathe in unison.
        action.time = Math.random() * clip.duration;
        action.play();
      }
      residents.push({ root: npc, mixer });
      speakers.push({
        id: `${name}-${speakers.length}`,
        name: name.replace(/_(adult|teen|kid|child)$/, '').replace(/_/g, ' '),
        voice: NPC_KIDS.includes(name)
          ? 'child'
          : NPC_TEENS.includes(name)
            ? 'teen'
            : NPC_ELDERS.includes(name)
              ? 'elder'
              : 'adult',
        band: band.kind as StoryBand,
        position: spot.point.clone(),
      });
    }
  }

  const merged = mergeGeometries(collisionGeometries, false);
  const collisionMesh = new THREE.Mesh(
    merged ?? new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  );
  if (merged) collisionMesh.geometry.computeBoundsTree();
  collisionMesh.visible = false;
  group.add(collisionMesh);

  return {
    group,
    collisionMesh,
    speakers,
    landmarks,
    update(playerPos: THREE.Vector3, dt: number): void {
      // Skinning is the expensive part, so only the people you could actually see are animated.
      const range = ANIM_RANGE * ANIM_RANGE;
      for (const r of residents) {
        if (r.root.position.distanceToSquared(playerPos) < range) r.mixer.update(dt);
      }
    },
  };
}
