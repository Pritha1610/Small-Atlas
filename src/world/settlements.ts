import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PLANET_RADIUS, WATER_Y, sampleHeight } from './planet';
import { loadModel, applyToonMaterial } from './assets';
import { loadDressing, place, tangentsOf, blocked, reachOf, yawAlong, WATER_RADIUS, type Footprint } from './dressing';
import type { Band as StoryBand, Voice } from '../story/dialogue';
import type { LooseSpec } from '../physics/world';

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
    hiH: 10,
    kit: ['S_Shanty', 'S_AFrame', 'S_LeanTo', 'S_Container', 'S_CartHome', 'S_NetHut', 'S_RoofShack'],
    life: 0.6,
    count: [4, 8],
  },
  {
    kind: 'upland',
    loH: 10,
    hiH: 18,
    kit: ['S_Yurt', 'S_TerraceHouse', 'S_Watchtower', 'S_AFrame', 'S_CartHome', 'S_WaterCollector'],
    life: 1,
    count: [4, 9],
  },
  {
    kind: 'mountain',
    loH: 18,
    hiH: 34,
    kit: ['M_AFrameHigh', 'M_LeanToRock', 'M_SledCart', 'M_YurtStone', 'S_Watchtower'],
    life: 1,
    count: [3, 6],
  },
  {
    kind: 'cave',
    loH: 8,
    hiH: 28,
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

const SETTLEMENT_SLOTS = 66;
const MIN_SEPARATION = 0.17; // radians between settlements
/** Only NPCs this close to the player get their mixer stepped. */
const ANIM_RANGE = 45;
// Every NPC is a skinned mesh with its own skeleton, so this is the real budget knob. A
// resident per house reads as a crowd, not as the last people in a drowning world.
const MAX_RESIDENTS = 95;
const RESIDENT_CHANCE = 0.85;
/**
 * Footprints are this fraction of a model's half-extent. Under 1 because the half-extent is the
 * LONG side: a full circle around a 7x4 shanty claims nearly twice its real area and packs a
 * settlement half as densely as it can be.
 */
const FOOTPRINT = 0.8;
/** Most rise across a dry building's footprint before the spot is refused as too steep. */
const MAX_BUILD_RELIEF = 1.8;
/** Cave dwellings are built INTO the slope, so they take far steeper ground and sink into it. */
const MAX_CAVE_RELIEF = 4;
/** Tries per building before it is dropped; each widens the search a little. */
const BUILD_TRIES = 20;
/**
 * What clutter does when walked into. Light things have mass and get shoved, roll and settle;
 * fixtures are solid; plants are walked through. Before, all of it was walked through: you
 * waded through winches and oil drums alike.
 */
const LOOSE = new Set(['P_OilDrum', 'P_Jerrycans', 'P_Buoy', 'P_CrabPot', 'P_Stool', 'P_CookPot', 'P_WashBasin', 'P_WaterJugs', 'P_RopeCoil', 'P_TyreFender', 'P_FloatCluster', 'P_CableSpool', 'P_Driftwood', 'P_SackPile']);
const WALK_THROUGH = new Set(['P_Reeds', 'P_Seaweed']);
/** Clutter density, for physics. About that of wet wood: light enough to kick, heavy enough to settle. */
const LOOSE_DENSITY = 300;

/** Landmarks stand this far clear of any settlement centre, so they fill the gaps between. */
const VERTICAL_GAP = 11 / PLANET_RADIUS;

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
  /** The body, so it can turn to face whoever is talking to it. */
  root?: THREE.Object3D;
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
  /** Everything solid this placed, so flora can keep out of it. */
  footprints: Footprint[];
  /** Clutter light enough to be knocked about, for the physics world. */
  loose: LooseSpec[];
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
  /** Ground already taken (monuments, the spawn point). Everything placed here is added to it. */
  claimed: Footprint[]
): Promise<Settlements> {
  const group = new THREE.Group();

  // One load per model; every instance is a skeleton clone of the converted original, so the
  // toon conversion and the material set are shared rather than rebuilt per resident.
  const structureNames = [...new Set(BANDS.flatMap((b) => b.kit))];
  const npcNames = [...NPC_ADULTS, ...NPC_KIDS, ...NPC_TEENS, ...NPC_ELDERS];

  const [structures, npcs, dressing] = await Promise.all([
    Promise.all(structureNames.map((n) => loadModel(`/models/structures/${n}.glb`))),
    Promise.all(npcNames.map((n) => loadModel(`/models/npcs/${n}.glb`))),
    loadDressing(gradientMap),
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

  /**
   * Where something `reach` wide stands on dry ground at `dir`, or null if the ground is too steep.
   *
   * Seated on the LOWEST ground under its footprint, not the centre sample. On a slope the
   * centre seat left the downhill side hanging in the air - measured, 105 of ~125 dry buildings
   * and landmarks per world floated more than 0.3 units on one side, the worst by over 12. None
   * of these models has a foundation to hide that, so sinking the uphill side into the hill is
   * the one that reads as built there.
   */
  function seatOnGround(dir: THREE.Vector3, reach: number, maxRelief: number): THREE.Vector3 | null {
    const hit = surfaceHit(dir);
    if (!hit) return null;
    let lo = hit.point.length();
    let hi = lo;
    const [f1, f2] = tangents(dir);
    const ring = (reach * 0.85) / PLANET_RADIUS;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const probe = surfaceHit(
        dir.clone().addScaledVector(f1, Math.cos(a) * ring).addScaledVector(f2, Math.sin(a) * ring).normalize()
      );
      if (!probe) return null;
      const r = probe.point.length();
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
    }
    if (hi - lo > maxRelief) return null;
    return dir.clone().multiplyScalar(lo);
  }

  /**
   * Drowned ruins sink into the sea rather than sitting on the seabed, and waterline homes stand
   * in the shallows, so both are keyed to the water sphere instead of the terrain.
   */
  function seatFor(kind: string, dir: THREE.Vector3, half: number): THREE.Vector3 | null {
    if (kind === 'drowned') return dir.clone().multiplyScalar(WATER_RADIUS - 0.6 - Math.random() * 1.8);
    if (kind === 'waterline') {
      const ground = surfacePoint(dir);
      if (!ground) return null;
      if (ground.length() < WATER_RADIUS) return dir.clone().multiplyScalar(WATER_RADIUS - 0.3);
    }
    return seatOnGround(dir, half, kind === 'cave' ? MAX_CAVE_RELIEF : MAX_BUILD_RELIEF);
  }

  const mine: Footprint[] = [];
  function claim(position: THREE.Vector3, radius: number): void {
    const f = { position: position.clone(), radius };
    claimed.push(f);
    mine.push(f);
  }

  // Reaches measured once per prototype rather than per clone.
  const reachCache = new Map<THREE.Object3D, number>();
  const reachFor = (proto: THREE.Object3D): number => {
    let r = reachCache.get(proto);
    if (r === undefined) reachCache.set(proto, (r = reachOf(proto)));
    return r;
  };

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
      const walled = occupied.some((o) => o.box.containsPoint(local.copy(body).applyMatrix4(o.inv)));
      if (walled) continue;
      // The boxes above are this settlement's walls only; this is everything else - a neighbour's
      // house, a walkway, a crate pile.
      if (blocked(claimed, point, 0.35)) continue;
      return { point, dir: nd };
    }
    return null;
  }

  const collisionGeometries: THREE.BufferGeometry[] = [];
  const residents: Resident[] = [];
  const loose: LooseSpec[] = [];
  // Each loose prototype's box in its own frame, measured once.
  const boxes = new Map<THREE.Object3D, { centre: THREE.Vector3; half: THREE.Vector3 }>();
  const boxOf = (proto: THREE.Object3D) => {
    let b = boxes.get(proto);
    if (!b) {
      const box = new THREE.Box3().setFromObject(proto);
      b = { centre: box.getCenter(new THREE.Vector3()), half: box.getSize(new THREE.Vector3()).multiplyScalar(0.5) };
      boxes.set(proto, b);
    }
    return b;
  };

  /** Adds a placed object to the world and folds its geometry into the collision mesh. */
  function addSolid(model: THREE.Object3D, solid = true): void {
    group.add(model);
    if (!solid) return;
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
  }
  const speakers: Speaker[] = [];
  const siteList: Array<{ dir: THREE.Vector3; kind: string }> = [];
  const landmarks: Landmark[] = [];
  const chosen: THREE.Vector3[] = [];

  for (let slot = 0; slot < SETTLEMENT_SLOTS; slot++) {
    // Each slot is ASSIGNED a band rather than taking whichever one a random probe happens to
    // match. Letting the probe decide sounds fairer but is not: the drowned band spans a huge
    // area of shallow seabed, so it won every roll - measured 30 of 46 settlements drowned and
    // not a single shore, upland or mountain town, i.e. a world of nothing but ruins.
    const want = BANDS[slot % BANDS.length];
    const seed = fib(slot, SETTLEMENT_SLOTS);
    const [s1, s2] = tangents(seed);

    // Wander outward from the slot looking for ground that suits some band.
    let dir: THREE.Vector3 | null = null;
    let band: Band | null = null;
    for (let attempt = 0; attempt < 220; attempt++) {
      const spread = (attempt / 220) * 0.62;
      const a = Math.random() * Math.PI * 2;
      const probe = seed
        .clone()
        .addScaledVector(s1, Math.cos(a) * spread)
        .addScaledVector(s2, Math.sin(a) * spread)
        .normalize();

      if (chosen.some((v) => probe.angleTo(v) < MIN_SEPARATION)) continue;

      const h = sampleHeight(probe);
      // The centre keeps clear of monuments and the spawn point by their real size, not a fixed
      // angle: Giza is 23 units across, so the old 10-unit rule built houses inside the pyramids.
      if (blocked(claimed, probe.clone().multiplyScalar(PLANET_RADIUS + h), 9)) continue;
      const rel = relief(probe, 7 / PLANET_RADIUS);
      // Caves want a steep face; everything else wants ground you could build on.
      const wantsSteep = rel > 4.5;
      if (h < want.loH || h >= want.hiH) continue;
      if ((want.kind === 'cave') !== wantsSteep) continue;
      dir = probe;
      band = want;
      break;
    }
    if (!dir || !band) continue;
    chosen.push(dir.clone());
    siteList.push({ dir: dir.clone(), kind: band.kind });
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
    const clutterAround: THREE.Vector3[] = [];

    for (let i = 0; i < n; i++) {
      const kitName = pick(band.kit);
      const proto = structureByName.get(kitName);
      if (!proto) continue;
      const half = footprint.get(kitName) ?? 3;

      // Several tries, each reaching a little further out, so a crowded settlement spreads
      // instead of stacking its houses inside each other - measured ~90 overlapping pairs per
      // world before this. A building with nowhere to go is dropped rather than forced in.
      let sdir = dir;
      let seat: THREE.Vector3 | null = null;
      for (let tries = 0; tries < BUILD_TRIES && !seat; tries++) {
        const a = Math.random() * Math.PI * 2;
        const rad = Math.sqrt(Math.random()) * spreadUnits * (1 + tries * 0.07);
        sdir = dir
          .clone()
          .addScaledVector(t1, (Math.cos(a) * rad) / PLANET_RADIUS)
          .addScaledVector(t2, (Math.sin(a) * rad) / PLANET_RADIUS)
          .normalize();
        seat = seatFor(band.kind, sdir, half);
        if (seat && blocked(claimed, seat, half * FOOTPRINT)) seat = null;
      }
      if (!seat) continue;
      claim(seat, half * FOOTPRINT);
      const model = proto.clone(true);
      model.userData.kind = 'building';

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

      // Vines claim what has been abandoned, so they follow the same 'life' value that decides
      // whether anyone still lives here. Not collidable - you should be able to push through
      // leaves - and rationed, because they are by far the heaviest models in the set.
      if (Math.random() > band.life * 0.8) {
        const vbox = new THREE.Box3().setFromObject(model);
        const vsize = new THREE.Vector3();
        vbox.getSize(vsize);
        const onTop = Math.random() < 0.4;
        const vproto = dressing.get(
          onTop
            ? pick(dressing.vines.top)
            : pick(Math.random() < 0.75 ? dressing.vines.wall : dressing.vines.ground)
        );
        if (vproto) {
          const [v1, v2] = tangentsOf(sdir);
          const off = Math.random() * Math.PI * 2;
          const reach = Math.max(vsize.x, vsize.z) * 0.42;
          const at = seat
            .clone()
            .addScaledVector(v1, Math.cos(off) * reach)
            .addScaledVector(v2, Math.sin(off) * reach)
            .addScaledVector(sdir, onTop ? Math.max(vsize.y * 0.72, 1.2) : 0.2);
          group.add(place(vproto, sdir, at));
        }
      }

      clutterAround.push(sdir);

      // Ruined bands get nobody, which is what makes them read as lost. Deferred until every
      // building in this settlement exists, so a resident can be kept out of ALL of them and
      // not just the one they belong to.
      if (Math.random() < band.life * RESIDENT_CHANCE) {
        pending.push({ sdir, clearance: footprint.get(kitName) ?? 3 });
      }
    }

    // Lived-in places accumulate stuff, and this clutter is most of what makes a settlement
    // read as inhabited rather than as a few models dropped on a hill. Placed once every
    // building here stands, so a crate pile never claims the spot a house wanted, and kept out
    // of all their walls - measured ~115 props per world sat inside a building before this.
    for (const sdir of clutterAround) {
      const clutter = band.kind === 'drowned' ? 1 : 2 + Math.floor(Math.random() * 3);
      for (let c = 0; c < clutter; c++) {
        const table =
          band.kind === 'waterline' || band.kind === 'drowned'
            ? dressing.props.shore
            : Math.random() < 0.55
              ? dressing.props.camp
              : dressing.props.work;
        const cname = pick(table);
        const cproto = dressing.get(cname);
        if (!cproto) continue;
        const r = reachFor(cproto) * FOOTPRINT;
        for (let tries = 0; tries < 4; tries++) {
          const ca = Math.random() * Math.PI * 2;
          const cr = 2.5 + Math.random() * 6;
          const cdir = sdir
            .clone()
            .addScaledVector(t1, (Math.cos(ca) * cr) / PLANET_RADIUS)
            .addScaledVector(t2, (Math.sin(ca) * cr) / PLANET_RADIUS)
            .normalize();
          const chit = surfaceHit(cdir);
          if (!chit) continue;
          const cpt =
            chit.point.length() > WATER_RADIUS ? chit.point : cdir.clone().multiplyScalar(WATER_RADIUS);
          if (blocked(claimed, cpt, r)) continue;
          claim(cpt, r);
          const prop = place(cproto, cdir, cpt, 0.15);
          prop.userData.kind = 'clutter';
          if (LOOSE.has(cname)) {
            group.add(prop);
            loose.push({ object: prop, ...boxOf(cproto), density: LOOSE_DENSITY });
          } else if (WALK_THROUGH.has(cname)) {
            group.add(prop);
          } else {
            addSolid(prop);
          }
          break;
        }
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
      // So a walkway or a landmark placed after this does not land on somebody.
      claim(spot.point, 0.45);
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
        root: npc,
      });
    }
  }

  // Walkways, docks and ladders. The waterline settlements are the ones that genuinely need
  // them - homes on stilts with no way between them read as unfinished - so they get boardwalks
  // radiating from the centre, while dry settlements just get the odd stair or sandbag line.
  for (const site of siteList) {
    const water = site.kind === 'waterline' || site.kind === 'drowned';
    const runs = water ? 3 + Math.floor(Math.random() * 4) : Math.random() < 0.5 ? 1 : 0;
    const [c1, c2] = tangentsOf(site.dir);
    for (let r = 0; r < runs; r++) {
      const table = water ? dressing.connectors.water : dressing.connectors.land;
      const cproto = dressing.get(pick(table));
      if (!cproto) continue;
      const half = reachFor(cproto) * FOOTPRINT;
      for (let tries = 0; tries < 5; tries++) {
        const a = Math.random() * Math.PI * 2;
        const dist = 4 + Math.random() * 9 + tries;
        const cdir = site.dir
          .clone()
          .addScaledVector(c1, (Math.cos(a) * dist) / PLANET_RADIUS)
          .addScaledVector(c2, (Math.sin(a) * dist) / PLANET_RADIUS)
          .normalize();
        const chit = surfaceHit(cdir);
        if (!chit) continue;
        // Boardwalks hang off the water surface; their legs are modelled to reach down to the bed.
        const cpt = water
          ? cdir.clone().multiplyScalar(WATER_RADIUS + 0.15)
          : chit.point;
        // Not through anybody's wall: ~43 walkways per world used to run straight into a house.
        if (blocked(claimed, cpt, half)) continue;
        claim(cpt, half);
        // Water runs point away from the centre, so docks read as reaching out to sea rather
        // than as planks dropped at random angles. Land pieces (stairs, sandbags) keep a spin.
        const out = cdir.clone().sub(site.dir);
        out.addScaledVector(cdir, -out.dot(cdir)).normalize();
        const yaw = water ? yawAlong(cproto, cdir, out) : undefined;
        const piece = place(cproto, cdir, cpt, 0, yaw);
        piece.userData.kind = 'connector';
        addSolid(piece);
        break;
      }
    }
  }

  // Tall silhouettes scattered between settlements. These are what you actually steer by on a
  // sphere where the horizon is only ~23 units away: something is always rising over it.
  // Placed away from settlements so they break up the gaps rather than crowd what is already busy.
  //
  // Seeded on an even lattice and wandered from there, like the settlements. Uniform random
  // directions clump - two lighthouses in one view is one landmark too many, and it leaves
  // somewhere else with nothing to steer by.
  const VERTICAL_COUNT = 42;
  for (let i = 0; i < VERTICAL_COUNT; i++) {
    const seed = fib(i, VERTICAL_COUNT);
    const [s1, s2] = tangents(seed);
    for (let attempt = 0; attempt < 60; attempt++) {
      const spread = (attempt / 60) * 0.35;
      const a = Math.random() * Math.PI * 2;
      const cand = seed
        .clone()
        .addScaledVector(s1, Math.cos(a) * spread)
        .addScaledVector(s2, Math.sin(a) * spread)
        .normalize();
      if (chosen.some((c) => cand.angleTo(c) < VERTICAL_GAP)) continue;
      const hit = surfaceHit(cand);
      if (!hit) continue;
      const alt = hit.point.length() - PLANET_RADIUS;
      const kind = alt < WATER_Y - 2.5 ? 'water' : alt < WATER_Y + 5 ? 'shore' : 'land';
      const vproto = dressing.get(pick(dressing.verticals[kind]));
      if (!vproto) continue;
      const half = reachFor(vproto);
      // Sea-going verticals stand in the water rather than on the seabed metres below. Dry ones
      // sink into the slope like the buildings do; they are wider, so they get a little more.
      const vpt =
        kind === 'water'
          ? cand.clone().multiplyScalar(WATER_RADIUS - 0.4)
          : seatOnGround(cand, half, MAX_BUILD_RELIEF * 1.5);
      if (!vpt || blocked(claimed, vpt, half * FOOTPRINT)) continue;
      claim(vpt, half * FOOTPRINT);
      const tower = place(vproto, cand, vpt);
      tower.userData.kind = 'vertical';
      addSolid(tower);
      break;
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
    footprints: mine,
    loose,
    update(playerPos: THREE.Vector3, dt: number): void {
      // Skinning is the expensive part, so only the people you could actually see are animated.
      const range = ANIM_RANGE * ANIM_RANGE;
      for (const r of residents) {
        if (r.root.position.distanceToSquared(playerPos) < range) r.mixer.update(dt);
      }
    },
  };
}
