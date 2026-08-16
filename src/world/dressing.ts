import * as THREE from 'three';
import { PLANET_RADIUS, WATER_Y } from './planet';
import { loadModel, applyToonMaterial } from './assets';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

// Small ground clutter. Cheap enough (52-596 tris) to spread by the hundred; this is most of
// what stops open ground reading as an empty field.
const PROPS_SHORE = ['P_Buoy', 'P_Driftwood', 'P_Seaweed', 'P_CrabPot', 'P_FloatCluster', 'P_Reeds', 'P_BarnacleRock', 'P_TyreFender'];
const PROPS_CAMP = ['P_CookPot', 'P_Stool', 'P_WashBasin', 'P_WaterJugs', 'P_SackPile', 'P_CrateStack', 'P_RopeCoil', 'P_Jerrycans', 'P_OilDrum'];
const PROPS_WORK = ['P_Winch', 'P_CableSpool', 'P_PipeRun', 'P_Bollard', 'P_Gangplank', 'P_SignBoard', 'P_WarningBoard', 'P_ArrowMarker'];

// Walkways and docks. Their pivots sit above a deliberately long drop (minY down to -4.3) so
// they can be dropped at the waterline and still have legs reaching the seabed.
const CONNECTORS_WATER = ['K_WalkStraight', 'K_WalkCorner', 'K_WalkT', 'K_WalkTee', 'K_DockFinger', 'K_DockPlatform', 'K_Pilings', 'K_Gantry'];
const CONNECTORS_LAND = ['K_StairFlight', 'K_LadderRun', 'K_LadderTall', 'K_Railing', 'K_Sandbags', 'K_RopeBridge', 'K_BridgeAnchor', 'K_WalkRamp'];

// Vines are the most expensive things here (up to 5.6k tris) so they are rationed, and they go
// where the story wants them: on what people have already given up on.
const VINES_WALL = ['VN_WallCreeper', 'VN_WallDense', 'VN_WindowFrame', 'VN_Flowering'];
const VINES_TOP = ['VN_RoofDrape', 'VN_Hang'];
const VINES_GROUND = ['VN_GroundCreep', 'VN_PostWrap'];

/** Tall silhouettes. These are what you steer by, so they are spread rather than clustered. */
const VERTICALS: Record<string, string[]> = {
  water: ['V_Lighthouse', 'V_DrownedTower', 'V_DepthMarker', 'V_SignalMast', 'V_SalvageCrane'],
  shore: ['V_DryingMast', 'V_Scaffold', 'V_DeadTree', 'V_DepthMarker', 'V_SalvageCrane'],
  land: ['V_SpireVillage', 'V_SiloCluster', 'V_Scaffold', 'V_DeadTree', 'V_SignalMast'],
};

const ALL = [
  ...PROPS_SHORE, ...PROPS_CAMP, ...PROPS_WORK,
  ...CONNECTORS_WATER, ...CONNECTORS_LAND,
  ...VINES_WALL, ...VINES_TOP, ...VINES_GROUND,
];

const DIR_OF = (name: string): string =>
  name.startsWith('P_') ? 'props'
  : name.startsWith('K_') ? 'connectors'
  : name.startsWith('VN_') ? 'vines'
  : 'models/verticals';

export interface Dressing {
  get(name: string): THREE.Object3D | undefined;
  props: { shore: string[]; camp: string[]; work: string[] };
  connectors: { water: string[]; land: string[] };
  vines: { wall: string[]; top: string[]; ground: string[] };
  verticals: typeof VERTICALS;
}

export async function loadDressing(gradientMap: THREE.Texture): Promise<Dressing> {
  const names = [...new Set([...ALL, ...Object.values(VERTICALS).flat()])];
  const loaded = await Promise.all(names.map((n) => loadModel(`/${DIR_OF(n)}/${n}.glb`)));
  const byName = new Map<string, THREE.Object3D>();
  names.forEach((n, i) => {
    applyToonMaterial(loaded[i].root, gradientMap);
    byName.set(n, loaded[i].root);
  });
  return {
    get: (n) => byName.get(n),
    props: { shore: PROPS_SHORE, camp: PROPS_CAMP, work: PROPS_WORK },
    connectors: { water: CONNECTORS_WATER, land: CONNECTORS_LAND },
    vines: { wall: VINES_WALL, top: VINES_TOP, ground: VINES_GROUND },
    verticals: VERTICALS,
  };
}

export function tangentsOf(dir: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const ref = Math.abs(dir.y) < 0.9 ? WORLD_UP : new THREE.Vector3(1, 0, 0);
  const t1 = ref.clone().sub(dir.clone().multiplyScalar(dir.dot(ref))).normalize();
  return [t1, dir.clone().cross(t1).normalize()];
}

/** Seats a clone on the surface, aligned to the radial up, with a random spin and optional tilt. */
export function place(
  proto: THREE.Object3D,
  dir: THREE.Vector3,
  point: THREE.Vector3,
  tilt = 0
): THREE.Object3D {
  const model = proto.clone(true);
  const quat = new THREE.Quaternion()
    .setFromUnitVectors(WORLD_UP, dir)
    .multiply(new THREE.Quaternion().setFromAxisAngle(WORLD_UP, Math.random() * Math.PI * 2));
  if (tilt > 0) {
    const [a] = tangentsOf(dir);
    quat.premultiply(new THREE.Quaternion().setFromAxisAngle(a, (Math.random() - 0.5) * tilt));
  }
  model.position.copy(point);
  model.quaternion.copy(quat);
  return model;
}

/** Water sits at this radius; connectors and shore props key off it rather than the terrain. */
export const WATER_RADIUS = PLANET_RADIUS + WATER_Y;
