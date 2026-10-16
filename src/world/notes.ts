import * as THREE from 'three';
import { PLANET_RADIUS, WATER_Y } from './planet';
import { blocked, place, tangentsOf, type Footprint } from './dressing';
import { DEV_NOTES, type Where } from '../story/notes';
import { KEEPSAKES } from '../story/keepsakes';
import type { WonderSite } from './wonders';
import type { Landmark } from './settlements';

/**
 * Things left in the world to be found and read: the developer's notes (a sheet pinned to a
 * post) and the keepsakes (a standing stone with a red ribbon tied round it).
 */
export interface PlacedNote {
  kind: 'note' | 'keepsake';
  /** Position in its own list (DEV_NOTES or KEEPSAKES). */
  index: number;
  position: THREE.Vector3;
  text: string;
}

export interface NoteDeps {
  planetMesh: THREE.Mesh;
  spawnDir: THREE.Vector3;
  wonders: WonderSite[];
  caveSites: THREE.Vector3[];
  caveMouths: THREE.Vector3[];
  landmarks: Landmark[];
  claimed: Footprint[];
}

const WATER_R = PLANET_RADIUS + WATER_Y;
/** Clear ground each one needs, so it is never inside a wall or on top of somebody. */
const NOTE_R = 0.8;
/**
 * How far apart any two of them stand, along the ground. Ten things on one small planet crowd
 * the obvious spots - the highest peak and the second-highest are often a stone's throw apart -
 * and two found together is one found.
 */
const APART = 30;
/** The water's edge, for 'shore': just dry, and no higher than a wave wets. */
const SHORE_LO = WATER_Y + 0.3;
const SHORE_HI = WATER_Y + 2.5;

/**
 * A post with a sheet of paper pinned to it. Procedural, because it is the only thing in the
 * world that is not part of this world: it should look like it was left by someone passing
 * through. The paper glows faintly so it can be spotted in shade.
 */
function noteModel(gradientMap: THREE.Texture): THREE.Object3D {
  const post = new THREE.CylinderGeometry(0.05, 0.065, 1.25, 6);
  post.translate(0, 0.62, 0);
  const paper = new THREE.PlaneGeometry(0.34, 0.44);
  paper.rotateX(-0.18);
  paper.translate(0, 1.0, 0.07);
  const group = new THREE.Group();
  group.add(new THREE.Mesh(post, new THREE.MeshToonMaterial({ gradientMap, color: '#5a4632' })));
  group.add(
    new THREE.Mesh(
      paper,
      new THREE.MeshToonMaterial({ gradientMap, color: '#f3ead2', emissive: new THREE.Color('#6b5a38'), side: THREE.DoubleSide })
    )
  );
  return group;
}

/**
 * A standing stone, chest high, with a faded red ribbon knotted round its middle and a tail of
 * it hanging loose. Something a person put there on purpose. It was knee high at first, and
 * players stood at the "?" on the map looking for it: lost in the grass, it read as nothing.
 */
function keepsakeModel(gradientMap: THREE.Texture): THREE.Object3D {
  const stone = new THREE.DodecahedronGeometry(0.4, 0);
  stone.scale(0.72, 1.75, 0.48);
  stone.translate(0, 0.66, 0);
  const band = new THREE.TorusGeometry(0.3, 0.03, 4, 14);
  band.rotateX(Math.PI / 2);
  band.scale(0.95, 1, 0.64);
  band.translate(0, 0.86, 0);
  const tail = new THREE.PlaneGeometry(0.07, 0.5);
  tail.rotateZ(0.18);
  tail.translate(0.07, 0.6, 0.2);
  const ribbon = new THREE.MeshToonMaterial({
    gradientMap,
    color: '#9e3341',
    emissive: new THREE.Color('#45121a'),
    side: THREE.DoubleSide,
  });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(stone, new THREE.MeshToonMaterial({ gradientMap, color: '#8d877c' })));
  group.add(new THREE.Mesh(band, ribbon));
  group.add(new THREE.Mesh(tail, ribbon));
  return group;
}

/** Height of the glint over an unread keepsake, and how far it bobs. */
const GLINT_AT = 1.85;
const GLINT_BOB = 0.12;

export interface Notes {
  group: THREE.Group;
  notes: PlacedNote[];
  /** Turns and bobs each unread keepsake's glint, and puts out the ones already read. */
  update(time: number, read: (n: PlacedNote) => boolean): void;
}

export function createNotes(gradientMap: THREE.Texture, deps: NoteDeps): Notes {
  const group = new THREE.Group();
  const notes: PlacedNote[] = [];
  const protos = { note: noteModel(gradientMap), keepsake: keepsakeModel(gradientMap) };

  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true;
  const ground = (dir: THREE.Vector3): THREE.Vector3 | null => {
    ray.set(dir.clone().multiplyScalar(PLANET_RADIUS + 48), dir.clone().negate());
    ray.near = 0;
    ray.far = 96;
    const hit = ray.intersectObject(deps.planetMesh, false);
    return hit.length > 0 ? hit[0].point.clone() : null;
  };
  /** Spacing is relaxed only as a last resort, so a crowded world still gets every one. */
  let spaced = true;
  const apart = (p: THREE.Vector3): boolean =>
    !spaced || notes.every((n) => n.position.angleTo(p) * PLANET_RADIUS >= APART);
  const free = (p: THREE.Vector3 | null): p is THREE.Vector3 =>
    p !== null && !blocked(deps.claimed, p, NOTE_R) && apart(p);
  const randomDir = (): THREE.Vector3 =>
    new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();

  /** Best of a sweep of the globe by some score, among clear dry ground. -Infinity rules a spot out. */
  function bestDry(score: (p: THREE.Vector3) => number): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bestS = -Infinity;
    for (let i = 0; i < 4000; i++) {
      const p = ground(randomDir());
      if (!free(p) || p.length() < WATER_R + 0.3) continue;
      const s = score(p);
      if (s > bestS) {
        bestS = s;
        best = p;
      }
    }
    return best;
  }

  // Every candidate of a kind, tried in turn; each is used at most once.
  const used = { cave: new Set<number>(), wonder: new Set<number>(), drowned: new Set<number>() };
  function spotFor(where: Where): THREE.Vector3 | null {
    switch (where) {
      case 'peak':
      case 'high':
        // 'high' is the same sweep: with everything kept APART, the highest ground left once
        // the peak is taken is high ground somewhere else.
        return bestDry((p) => p.length());
      case 'shore':
        return bestDry((p) => {
          const h = p.length() - PLANET_RADIUS;
          return h >= SHORE_LO && h <= SHORE_HI ? Math.random() : -Infinity;
        });
      case 'far':
        return bestDry((p) => p.clone().normalize().angleTo(deps.spawnDir));
      case 'cave':
        // A third of the way in from the mouth: inside, but in the open half the kits leave clear.
        for (let i = 0; i < deps.caveSites.length; i++) {
          if (used.cave.has(i)) continue;
          const p = ground(deps.caveSites[i].clone().addScaledVector(deps.caveMouths[i], 7 * 0.35).normalize());
          if (!free(p)) continue;
          used.cave.add(i);
          return p;
        }
        return null;
      case 'wonder':
        for (let i = 0; i < deps.wonders.length; i++) {
          if (used.wonder.has(i)) continue;
          const w = deps.wonders[i];
          const up = w.position.clone().normalize();
          const [t1, t2] = tangentsOf(up);
          const off = (w.radius + 2.5) / PLANET_RADIUS;
          for (let k = 0; k < 12; k++) {
            const a = (k / 12) * Math.PI * 2;
            const p = ground(up.clone().addScaledVector(t1, Math.cos(a) * off).addScaledVector(t2, Math.sin(a) * off).normalize());
            if (!free(p) || p.length() <= WATER_R) continue;
            used.wonder.add(i);
            return p;
          }
        }
        return null;
      case 'drowned': {
        const ruins = deps.landmarks.filter((l) => l.target === 'place:drowned');
        for (let i = 0; i < ruins.length; i++) {
          if (used.drowned.has(i)) continue;
          const p = ruins[i].position.clone().normalize().multiplyScalar(WATER_R - 0.5);
          if (!free(p)) continue;
          used.drowned.add(i);
          return p;
        }
        return null;
      }
      default:
        return bestDry(() => Math.random());
    }
  }

  const all: Array<{ kind: PlacedNote['kind']; index: number; where: Where; text: string }> = [
    ...DEV_NOTES.map((n, index) => ({ kind: 'note' as const, index, ...n })),
    ...KEEPSAKES.map((k, index) => ({ kind: 'keepsake' as const, index, ...k })),
  ].filter((item) => item.text.trim() !== '');
  // A small rose glint over each keepsake until it is read: the thing your eye finds when you
  // arrive where the map's "?" was. Unlit and fog-free, so it carries a fair way in daylight.
  const glintGeo = new THREE.OctahedronGeometry(0.13, 0);
  glintGeo.scale(1, 1.5, 1);
  const glintMat = new THREE.MeshBasicMaterial({ color: '#ff9db0', transparent: true, opacity: 0.9, fog: false });
  const glints: Array<{ note: PlacedNote; mesh: THREE.Mesh; up: THREE.Vector3; align: THREE.Quaternion }> = [];
  const spin = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0);

  for (const item of all) {
    spaced = true;
    let spot = spotFor(item.where) ?? spotFor('anywhere');
    if (!spot) {
      spaced = false;
      spot = spotFor(item.where) ?? spotFor('anywhere');
    }
    if (!spot) continue;
    deps.claimed.push({ position: spot.clone(), radius: NOTE_R });
    group.add(place(protos[item.kind], spot.clone().normalize(), spot));
    const note: PlacedNote = { kind: item.kind, index: item.index, position: spot, text: item.text };
    notes.push(note);
    if (item.kind === 'keepsake') {
      const mesh = new THREE.Mesh(glintGeo, glintMat);
      const up = spot.clone().normalize();
      group.add(mesh);
      glints.push({ note, mesh, up, align: new THREE.Quaternion().setFromUnitVectors(Y, up) });
    }
  }

  return {
    group,
    notes,
    update(time, read) {
      for (const [i, g] of glints.entries()) {
        g.mesh.visible = !read(g.note);
        if (!g.mesh.visible) continue;
        g.mesh.position.copy(g.note.position).addScaledVector(g.up, GLINT_AT + Math.sin(time * 1.6 + i) * GLINT_BOB);
        g.mesh.quaternion.copy(g.align).multiply(spin.setFromAxisAngle(Y, time * 1.2 + i));
      }
    },
  };
}
