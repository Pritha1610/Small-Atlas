import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { GRAVITY } from '../player/controller';
import { PLANET_RADIUS } from '../world/planet';

/**
 * Rigid-body physics, for the things the character controller should not be: a body that goes
 * limp when it falls (see ragdoll.ts), and loose objects - drums, jerrycans, buoys, stools - that
 * have mass and get shoved, roll and settle when you walk into them.
 *
 * The player still walks on the hand-tuned raycast controller; physics is what the world does
 * back. The player is a kinematic capsule in here: it pushes things with infinite mass and is
 * never pushed back, which is the right way round for someone wading through clutter.
 *
 * Gravity points at the centre of the planet, so the world's own gravity is zero and every
 * awake body is pulled inward by hand each step. Sleeping bodies cost nothing and are not
 * touched, and every loose object starts asleep: of the few hundred on a world, only the ones you
 * actually knock are ever simulated.
 */

/** Fixed physics step. Rapier is most stable at a constant timestep. */
const STEP = 1 / 60;
/** Never more than this many steps in one frame, so a hitch does not spiral. */
const MAX_STEPS = 4;
/** How hard the sea holds things up, as a multiple of gravity, once fully under. */
const BUOYANCY = 1.7;
/** Water is thick: it damps anything moving through it, per second. */
const WATER_DRAG = 2.2;
/** Anything that ends up this far inside the planet has tunnelled out of the world. */
const LOST = PLANET_RADIUS - 12;

/** Collision groups: the ragdoll's own parts never collide with each other. */
export const GROUP_WORLD = 0x0001;
export const GROUP_RAGDOLL = 0x0002;
/** Rapier packs membership into the high 16 bits and the filter into the low 16. */
export const groups = (member: number, filter: number): number => (member << 16) | filter;

interface Loose {
  body: RAPIER.RigidBody;
  object: THREE.Object3D;
  /** Centre of the collision box in the object's own frame, from its origin at the base. */
  centre: THREE.Vector3;
  home: { position: THREE.Vector3; quaternion: THREE.Quaternion };
}

/** A pushable object: the model, and its box in its own frame. */
export interface LooseSpec {
  object: THREE.Object3D;
  centre: THREE.Vector3;
  half: THREE.Vector3;
  density: number;
}

export interface Physics {
  RAPIER: typeof import('@dimforge/rapier3d-compat').default;
  world: RAPIER.World;
  /** Static, triangle-accurate collision from a mesh whose geometry is in world space. */
  addStatic(mesh: THREE.Mesh): void;
  addLoose(specs: LooseSpec[]): void;
  /** Steps the world, carrying the player's capsule along; `solid` false lets the body pass. */
  step(dt: number, feet: THREE.Vector3, solid: boolean): void;
  readonly looseCount: number;
}

export async function createPhysics(waterRadius: number): Promise<Physics> {
  // Its own chunk: Rapier carries its engine inline (~780KB gzipped), and nothing else in the
  // game should wait behind that to start downloading the world.
  const RAPIER = (await import('@dimforge/rapier3d-compat')).default;
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  world.timestep = STEP;

  const loose: Loose[] = [];
  const tmpQ = new THREE.Quaternion();
  const tmpV = new THREE.Vector3();
  const up = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0);

  // The player, as something the world can bump into.
  const player = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
  const playerCollider = world.createCollider(
    RAPIER.ColliderDesc.capsule(0.55, 0.3).setCollisionGroups(groups(GROUP_WORLD, GROUP_WORLD)),
    player
  );
  let wasSolid = false;
  const lastAt = new THREE.Vector3();
  /** A capsule that moves further than this in a frame was put there, not walked there. */
  const TELEPORT = 1;

  function addStatic(mesh: THREE.Mesh): void {
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    if (!pos || pos.count < 3) return;
    mesh.updateMatrixWorld(true);
    const m = mesh.matrixWorld;
    const v = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      tmpV.fromBufferAttribute(pos, i).applyMatrix4(m);
      v[i * 3] = tmpV.x;
      v[i * 3 + 1] = tmpV.y;
      v[i * 3 + 2] = tmpV.z;
    }
    const idx = geo.index ? Uint32Array.from(geo.index.array) : Uint32Array.from({ length: pos.count }, (_, i) => i);
    world.createCollider(RAPIER.ColliderDesc.trimesh(v, idx).setCollisionGroups(groups(GROUP_WORLD, 0xffff)));
  }

  function addLoose(specs: LooseSpec[]): void {
    for (const s of specs) {
      const o = s.object;
      o.updateMatrixWorld(true);
      const c = tmpV.copy(s.centre).applyQuaternion(o.quaternion).add(o.position);
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(c.x, c.y, c.z)
          .setRotation(o.quaternion)
          .setLinearDamping(0.25)
          .setAngularDamping(0.6)
          .setCanSleep(true)
      );
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(s.half.x * 0.95, s.half.y * 0.95, s.half.z * 0.95)
          .setDensity(s.density)
          .setFriction(0.8)
          .setRestitution(0.15)
          .setCollisionGroups(groups(GROUP_WORLD, 0xffff)),
        body
      );
      // Asleep until something touches it. Settling a few hundred props on a planet nobody is
      // looking at would cost the first seconds of every world for nothing.
      body.sleep();
      loose.push({
        body,
        object: o,
        centre: s.centre.clone(),
        home: { position: o.position.clone(), quaternion: o.quaternion.clone() },
      });
    }
  }

  function pull(): void {
    world.forEachActiveRigidBody((b) => {
      if (!b.isDynamic()) return;
      const p = b.translation();
      up.set(p.x, p.y, p.z);
      const r = up.length();
      up.divideScalar(r);
      const v = b.linvel();
      let k = -GRAVITY * STEP;
      // Floating: gravity is beaten once enough of it is under, and the water drags.
      const under = THREE.MathUtils.clamp((waterRadius - r) / 0.5 + 0.5, 0, 1);
      if (under > 0) k += GRAVITY * BUOYANCY * under * STEP;
      const drag = under > 0 ? 1 - WATER_DRAG * under * STEP : 1;
      b.setLinvel({ x: (v.x + up.x * k) * drag, y: (v.y + up.y * k) * drag, z: (v.z + up.z * k) * drag }, false);
    });
  }

  let acc = 0;

  return {
    RAPIER,
    world,
    addStatic,
    addLoose,
    get looseCount() {
      return loose.length;
    },
    step(dt, feet, solid) {
      // Carry the capsule with the player. Coming back after time away (a ragdoll getting up), or
      // any jump bigger than a stride, is a teleport, not a move: a kinematic move that size hits
      // everything near it at the speed of the jump - measured, it threw a drum 19 units.
      playerCollider.setEnabled(solid);
      if (solid) {
        up.copy(feet).normalize();
        tmpV.copy(feet).addScaledVector(up, 0.85);
        tmpQ.setFromUnitVectors(Y, up);
        if (wasSolid && tmpV.distanceTo(lastAt) < TELEPORT) {
          player.setNextKinematicTranslation(tmpV);
          player.setNextKinematicRotation(tmpQ);
        } else {
          player.setTranslation(tmpV, true);
          player.setRotation(tmpQ, true);
        }
        lastAt.copy(tmpV);
      }
      wasSolid = solid;

      acc = Math.min(acc + dt, STEP * MAX_STEPS);
      while (acc >= STEP) {
        pull();
        world.step();
        acc -= STEP;
      }

      for (const l of loose) {
        if (l.body.isSleeping()) continue;
        const t = l.body.translation();
        const r = l.body.rotation();
        if (Math.hypot(t.x, t.y, t.z) < LOST) {
          // Knocked out of the world through a gap in the ground: put it back where it was.
          l.object.position.copy(l.home.position);
          l.object.quaternion.copy(l.home.quaternion);
          const c = tmpV.copy(l.centre).applyQuaternion(l.home.quaternion).add(l.home.position);
          l.body.setTranslation(c, false);
          l.body.setRotation(l.home.quaternion, false);
          l.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
          l.body.sleep();
          continue;
        }
        l.object.quaternion.set(r.x, r.y, r.z, r.w);
        l.object.position.set(t.x, t.y, t.z).sub(tmpV.copy(l.centre).applyQuaternion(l.object.quaternion));
      }
    },
  };
}
