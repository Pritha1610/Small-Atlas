import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PLANET_RADIUS, WATER_Y, sampleHeight } from './planet';
import { loadModel, applyToonMaterial } from './assets';
import { tangentsOf, place } from './dressing';
import { fbm } from './noise';
import type { Landmark } from './settlements';

/**
 * Caves, as secrets.
 *
 * A heightfield planet cannot produce a cave on its own - one radius per direction means no
 * overhang and no roof - so these are placed rather than grown: a hollow rock outcrop seated on
 * open ground, big enough to walk into, with a mouth you have to find the right side of. From a
 * distance it reads as a boulder on a hillside, which is exactly the amount of "worth the walk"
 * a secret wants.
 *
 * The shell alone is collidable. The floor you actually stand on is the untouched terrain, and
 * the dark disc inside is decoration laid a few centimetres over it - so there is no threshold
 * to step over at the mouth, no second surface for the ground probe to disagree with, and no
 * chance of the fell-through-the-world net firing inside a cave and posting you onto the roof.
 *
 * What is inside is written against the 16 `place:cave` lore entries already in the corpus:
 * ochre handprints at walking height, a calendar cut into the rock, seed jars, lamp soot, a
 * hearth. The lore was written first; this is the world catching up to it.
 */

/**
 * Target, not a promise. Seven kits, one per cave, but the filters below (land, altitude band,
 * flat enough, clear of ~42 settlements and monuments, 30 units from another cave) typically fit
 * 4-5 on a given world. That is deliberate: a world that has to cram seven in has stopped
 * hiding them.
 */
const CAVE_COUNT = 7;
/** Chamber footprint. ~14 units across reads as an outcrop, not a hill. */
const R_CHAMBER = 7;
const H_CHAMBER = 3.6;
/** Angular width of the opening. Wide enough that the chase camera can follow you in. */
const MOUTH = 0.9;
/** SphereGeometry opens its phi sector toward -X, so this is the mouth in the cave's own frame. */
const MOUTH_LOCAL = new THREE.Vector3(-1, 0, 0);
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Ground flat enough to stand a chamber on, dry enough to live in, and below the snow line -
 * terrain colour reaches PEAK white from h=13.1, and an outcrop on a bare white summit reads as
 * a rock that fell there, not as somewhere anyone ever sheltered.
 */
const MIN_ALT = WATER_Y + 3;
const MAX_ALT = 17;
const MAX_RELIEF = 1.1;
/** Kept off everything else on the planet, so finding one is never incidental. */
const MIN_GAP = 34;
/** However hard the placement has to relax, never close enough to be somebody's back wall. */
const MIN_GAP_FLOOR = 18;

const ROCK = new THREE.Color('#8b8377');
const ROCK_DEEP = new THREE.Color('#6a6258');
// Not near-black. Toon shading quantises to four bands, so an unlit interior collapses to ONE
// flat colour with no form at all - a cave you cannot read the shape of. The interior is lit by
// the lamp below and needs a base bright enough for those bands to separate.
const INNER = new THREE.Color('#5c5347');
const FLOOR = new THREE.Color('#3b342b');
const OCHRE = new THREE.Color('#8a4a2c');

interface Kit {
  id: string;
  /** Full paths, because these come from four different asset folders. */
  models: string[];
  mark?: 'hands' | 'tallies' | 'cairn';
  fire?: boolean;
}

// One idea per cave, each keyed to a lore entry that already exists in the corpus.
const KITS: Kit[] = [
  {
    id: 'hearth',
    models: ['/models/camp/Bonfire.glb', '/models/camp/Pot.glb', '/models/camp/Pan.glb',
             '/models/camp/WoodLog.glb', '/models/camp/WoodLog.glb', '/props/P_Stool.glb',
             '/models/structures/C_CaveHearth.glb'],
    fire: true,
  },
  {
    id: 'handprints',
    models: ['/models/camp/Torch.glb', '/models/structures/C_CaveWall.glb'],
    mark: 'hands',
  },
  {
    id: 'stores',
    models: ['/props/P_SackPile.glb', '/props/P_CrateStack.glb', '/props/P_WaterJugs.glb',
             '/models/structures/C_CaveRack.glb', '/props/P_WashBasin.glb'],
  },
  {
    id: 'sleeping',
    models: ['/models/camp/Tent.glb', '/models/camp/Backpack.glb', '/models/camp/WoodLog.glb',
             '/models/structures/C_CaveMouthTent.glb', '/models/camp/Bonfire.glb'],
  },
  {
    id: 'toolmaker',
    models: ['/models/camp/Axe.glb', '/models/camp/WoodLog.glb', '/models/camp/WoodLog.glb',
             '/models/structures/C_CaveRack.glb', '/props/P_RopeCoil.glb'],
  },
  {
    id: 'shrine',
    models: ['/models/camp/Torch.glb', '/models/camp/Torch.glb', '/props/P_WashBasin.glb'],
    mark: 'cairn',
    fire: true,
  },
  {
    id: 'tallies',
    models: ['/models/camp/Torch.glb', '/models/verticals/V_DepthMarker.glb', '/props/P_SackPile.glb'],
    mark: 'tallies',
  },
];

export interface Caves {
  group: THREE.Group;
  collisionMesh: THREE.Mesh;
  landmarks: Landmark[];
  /** Centres, so flora can be kept out of a chamber. */
  sites: THREE.Vector3[];
}

/** Local relief over the chamber footprint. A cave needs somewhere to stand. */
function relief(dir: THREE.Vector3, angle: number): number {
  const [t1, t2] = tangentsOf(dir);
  let lo = Infinity;
  let hi = -Infinity;
  for (const t of [t1, t1.clone().negate(), t2, t2.clone().negate()]) {
    const h = sampleHeight(dir.clone().addScaledVector(t, angle).normalize());
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  return hi - lo;
}

/**
 * Rock displacement as a function of DIRECTION, not of vertex index. SphereGeometry duplicates
 * its pole vertices once per segment; jittering those independently tears a hole in the roof.
 */
function bulge(v: THREE.Vector3): number {
  // fbm's fifth argument is FREQUENCY, not gain. Passing 0.5 there gave a wavelength about half
  // the sphere, so every facet moved with its neighbours and the "rock" came out as a stack of
  // grey slabs. 3.4 puts several bumps around the chamber, which is what makes it read as stone.
  return 1 + (fbm(v.x, v.y, v.z, 3, 3.4) - 0.5) * 0.5;
}

/** A point on the finished (jittered) inner wall, so wall decoration sits flush instead of floating. */
function wallPoint(local: THREE.Vector3): THREE.Vector3 {
  const unit = local.clone().normalize();
  const b = bulge(unit);
  return new THREE.Vector3(unit.x * b * R_CHAMBER, unit.y * b * H_CHAMBER, unit.z * b * R_CHAMBER);
}

function shellGeometry(): THREE.BufferGeometry {
  // theta runs well past the equator so the wall carries on BELOW the ground line and the
  // terrain seals it. How far past is not cosmetic: ground tilted by a means the sealing circle
  // dips to about -R*sin(a), so a 0.6pi skirt (-1.1 units) leaks on anything steeper than ~9
  // degrees, and the player just walks out over the downhill rim. 0.78pi reaches -2.8, which
  // covers every slope the placement filter lets through. The extra is buried and never seen.
  const geo = new THREE.SphereGeometry(1, 22, 12, MOUTH / 2, Math.PI * 2 - MOUTH, 0, Math.PI * 0.78);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const b = bulge(v);
    pos.setXYZ(i, v.x * b * R_CHAMBER, v.y * b * H_CHAMBER, v.z * b * R_CHAMBER);
    // Darker toward the back of the chamber, so depth reads even with the sun on the mouth.
    const depth = THREE.MathUtils.clamp((v.x + 0.4) / 1.2, 0, 1);
    const c = ROCK.clone().lerp(ROCK_DEEP, depth);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const flat = geo.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}

/**
 * Trodden earth laid over the real ground, purely so the chamber floor is not grass.
 *
 * It has to FOLLOW the terrain, not sit flat on the cave's origin plane. A flat disc only
 * matches the ground at the exact centre, and the uphill side of the chamber pushed straight
 * through it - a wedge of bright green hillside standing in the middle of a dark cave.
 */
function floorGeometry(centre: THREE.Vector3, quat: THREE.Quaternion): THREE.BufferGeometry {
  const geo = new THREE.CircleGeometry(R_CHAMBER * 1.02, 20);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const inv = quat.clone().invert();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyQuaternion(quat).add(centre).normalize();
    v.multiplyScalar(PLANET_RADIUS + sampleHeight(v) + 0.06).sub(centre).applyQuaternion(inv);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    colors[i * 3] = FLOOR.r;
    colors[i * 3 + 1] = FLOOR.g;
    colors[i * 3 + 2] = FLOOR.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/** A crude five-fingered hand: one palm quad and five finger quads, 12 triangles the whole print. */
function handGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.PlaneGeometry(0.15, 0.17)];
  for (let f = 0; f < 5; f++) {
    const a = (f - 2) * 0.34;
    const long = f === 2 ? 0.13 : f === 0 ? 0.07 : 0.1;
    const g = new THREE.PlaneGeometry(0.035, long);
    g.translate(0, 0.085 + long / 2, 0);
    g.rotateZ(a);
    // The thumb sits off the side of the palm, not on top of it.
    if (f === 0) g.translate(-0.07, -0.09, 0);
    parts.push(g);
  }
  return mergeGeometries(parts, false)!;
}

function markGeometry(kind: 'hands' | 'tallies' | 'cairn'): THREE.BufferGeometry {
  if (kind === 'cairn') {
    // Stacked stones, biggest at the bottom.
    const parts: THREE.BufferGeometry[] = [];
    let y = 0;
    for (let i = 0; i < 6; i++) {
      const r = 0.34 - i * 0.045;
      const g = new THREE.IcosahedronGeometry(r, 0);
      g.scale(1, 0.6, 1);
      g.rotateY(Math.random() * 3);
      g.translate((Math.random() - 0.5) * 0.09, y + r * 0.5, (Math.random() - 0.5) * 0.09);
      y += r * 1.05;
      parts.push(g);
    }
    return mergeGeometries(parts, false)!;
  }
  if (kind === 'tallies') {
    // A calendar of small squares cut into the rock: rows of scratches, the last row unfinished.
    const parts: THREE.BufferGeometry[] = [];
    for (let row = 0; row < 5; row++) {
      const n = row === 4 ? 3 : 8;
      for (let i = 0; i < n; i++) {
        const g = new THREE.PlaneGeometry(0.022, 0.11);
        g.translate((i - 3.5) * 0.05, -row * 0.16, 0);
        parts.push(g);
      }
    }
    return mergeGeometries(parts, false)!;
  }
  return handGeometry();
}

export async function createCaves(
  gradientMap: THREE.Texture,
  spawnDir: THREE.Vector3,
  avoid: THREE.Vector3[]
): Promise<Caves> {
  const group = new THREE.Group();
  const landmarks: Landmark[] = [];
  const sites: THREE.Vector3[] = [];

  // Footprint in radians, used both for the flatness probe and for spacing.
  const footprint = R_CHAMBER / PLANET_RADIUS;

  const dirs: THREE.Vector3[] = [];
  const probe = new THREE.Vector3();
  // Escalating passes rather than one fixed filter. The strict pass wants flat, dry, remote
  // ground, but ~35 settlements and 7 monuments each holding a 34-unit exclusion disc already
  // claim more than the whole 70,700-unit surface, so a single strict pass found ZERO sites and
  // the merge below crashed on an empty list. Relaxing until the quota fills degrades the
  // placement instead of the build.
  for (let pass = 0; pass < 5 && dirs.length < CAVE_COUNT; pass++) {
    const maxRelief = MAX_RELIEF * (1 + pass * 0.28);
    const gap = Math.max(MIN_GAP_FLOOR, MIN_GAP * (1 - pass * 0.17));
    for (let i = 0; i < 12000 && dirs.length < CAVE_COUNT; i++) {
      probe.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      if (probe.lengthSq() < 1e-6) continue;
      probe.normalize();
      const h = sampleHeight(probe);
      if (h < MIN_ALT || h > MAX_ALT) continue;
      if (relief(probe, footprint) > maxRelief) continue;
      const p = probe.clone().multiplyScalar(PLANET_RADIUS + h);
      // Never on top of a settlement, a monument, another cave, or where you woke up.
      if (probe.angleTo(spawnDir) * PLANET_RADIUS < gap) continue;
      if (avoid.some((a) => a.distanceTo(p) < gap)) continue;
      // Cave-to-cave spacing never relaxes: two secrets in sight of each other is one secret.
      if (dirs.some((d) => d.angleTo(probe) * PLANET_RADIUS < 30)) continue;
      dirs.push(probe.clone());
    }
  }

  const shellGeo = shellGeometry();
  // The same geometry drawn twice, front faces and back faces, because a cave has to be pale
  // rock from the outside and dark from the inside and one DoubleSide material can only be one
  // of those. No extra buffer, one extra draw call per cave.
  const shellMat = new THREE.MeshToonMaterial({ gradientMap, vertexColors: true, side: THREE.FrontSide });
  // Emissive, not a light. A PointLight would be a shader #define recompiling every material in
  // the scene, would need a per-frame "which cave am I in" search, and STILL leaves a cave on the
  // planet's night side pitch black. An emissive floor is free, position-independent, and gives
  // the toon bands something to separate against so the room has shape whatever the sun is doing.
  const innerMat = new THREE.MeshToonMaterial({
    gradientMap,
    color: INNER,
    emissive: new THREE.Color('#2f2418'),
    side: THREE.BackSide,
  });
  const floorMat = new THREE.MeshToonMaterial({ gradientMap, vertexColors: true });
  const markMat = new THREE.MeshBasicMaterial({ color: OCHRE, side: THREE.DoubleSide });
  const cairnMat = new THREE.MeshToonMaterial({ gradientMap, color: ROCK });

  // Load every kit model once; the loader caches by path so repeats are free.
  const paths = [...new Set(KITS.flatMap((k) => k.models))];
  const loaded = await Promise.all(paths.map((p) => loadModel(p)));
  const proto = new Map<string, THREE.Object3D>();
  paths.forEach((p, i) => {
    applyToonMaterial(loaded[i].root, gradientMap);
    proto.set(p, loaded[i].root);
  });

  // Anything named for fire glows on its own, for the same reason the walls do.
  for (const root of proto.values()) {
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshToonMaterial | undefined;
      if (m && /fire|yellow/i.test(m.name)) m.emissive = new THREE.Color('#c05a14');
    });
  }

  const collision: THREE.BufferGeometry[] = [];

  dirs.forEach((dir, i) => {
    const kit = KITS[i % KITS.length];
    const ground = PLANET_RADIUS + sampleHeight(dir);
    const centre = dir.clone().multiplyScalar(ground);
    const yaw = Math.random() * Math.PI * 2;
    const quat = new THREE.Quaternion()
      .setFromUnitVectors(WORLD_UP, dir)
      .multiply(new THREE.Quaternion().setFromAxisAngle(WORLD_UP, yaw));

    const cave = new THREE.Group();
    cave.position.copy(centre);
    cave.quaternion.copy(quat);

    cave.add(new THREE.Mesh(shellGeo, shellMat));
    cave.add(new THREE.Mesh(shellGeo, innerMat));

    // Laid just clear of the terrain: high enough not to z-fight, low enough that standing on
    // the real ground underneath it is invisible. Per cave, because it follows that cave's ground.
    cave.add(new THREE.Mesh(floorGeometry(centre, quat), floorMat));

    collision.push(shellGeo.clone().applyMatrix4(new THREE.Matrix4().compose(centre, quat, new THREE.Vector3(1, 1, 1))));

    // Contents sit on the real terrain, so each one is placed in world space rather than
    // parented to the cave: the ground inside is not perfectly level and props should follow it.
    const mouthWorld = MOUTH_LOCAL.clone().applyQuaternion(quat);
    kit.models.forEach((path, k) => {
      const p = proto.get(path);
      if (!p) return;
      // Spread around the chamber, biased to the back half so the mouth stays walkable. The
      // tent is the exception - a mouth tent belongs in the mouth.
      const towardMouth = /Tent/.test(path);
      const ang = towardMouth ? 0 : Math.PI * 0.45 + (k / kit.models.length) * Math.PI * 1.1;
      const rad = towardMouth ? R_CHAMBER * 0.72 : R_CHAMBER * (0.25 + Math.random() * 0.45);
      // The mouth direction and its perpendicular already form a tangent basis at this cave,
      // so angles are measured from the mouth rather than from an arbitrary tangent.
      const away = mouthWorld.clone().multiplyScalar(Math.cos(ang) * rad);
      const side = dir.clone().cross(mouthWorld).normalize().multiplyScalar(Math.sin(ang) * rad);
      const spotDir = centre.clone().add(away).add(side).normalize();
      const spot = spotDir.clone().multiplyScalar(PLANET_RADIUS + sampleHeight(spotDir) + 0.02);
      group.add(place(p, spotDir, spot));
    });

    if (kit.mark === 'cairn') {
      const m = new THREE.Mesh(markGeometry('cairn'), cairnMat);
      m.position.set(0, 0.06, 0);
      cave.add(m);
    } else if (kit.mark) {
      // Ochre, at the height of a walking adult, on the wall of the closed half - so you have
      // to be inside and turned round to see it.
      const n = kit.mark === 'hands' ? 11 : 3;
      const geo = markGeometry(kit.mark);
      for (let h = 0; h < n; h++) {
        const phi = MOUTH / 2 + 0.45 + Math.random() * (Math.PI * 2 - MOUTH - 0.9);
        const y = kit.mark === 'hands' ? 1.15 + Math.random() * 0.7 : 1.6;
        const local = new THREE.Vector3(-Math.cos(phi), 0, Math.sin(phi));
        const on = wallPoint(new THREE.Vector3(local.x, y / H_CHAMBER, local.z));
        const m = new THREE.Mesh(geo, markMat);
        // Pulled a hand's width off the rock and turned to face the middle of the chamber.
        m.position.copy(on).addScaledVector(new THREE.Vector3(local.x, 0, local.z).normalize(), -0.06);
        m.position.y = y;
        m.lookAt(0, y, 0);
        if (kit.mark === 'hands') m.rotateZ((Math.random() - 0.5) * 0.5);
        cave.add(m);
      }
    }

    group.add(cave);
    sites.push(centre.clone());
    landmarks.push({ target: 'place:cave', position: centre.clone() });
  });

  // A world that somehow offered nowhere to put a cave should lose its caves, not fail to boot.
  const merged = collision.length > 0 ? mergeGeometries(collision, false)! : new THREE.BufferGeometry();
  if (collision.length > 0) merged.computeBoundsTree();
  const collisionMesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  collisionMesh.visible = false;
  group.add(collisionMesh);


  return {
    group,
    collisionMesh,
    landmarks,
    sites,
  };
}
