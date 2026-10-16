import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { groups, GROUP_RAGDOLL, GROUP_WORLD, type Physics } from '../physics/world';

/**
 * The body going limp: a fall from height hands the character to physics instead of playing a
 * landing, so she tumbles down the slope she hit, folds over a wall, or floats if she went into
 * the sea - then gets up again where she ended up.
 *
 * Twelve bodies, built from wherever the skeleton actually is at that moment, so the ragdoll
 * starts in the pose she fell in and with the speed she fell at. Shoulders, hips and neck are
 * ball joints; knees, elbows and the spine are hinges with limits, so nothing bends backwards.
 * Every body is created in the character's own frame (X left, Y up, Z forward), which makes each
 * hinge's axis the same local X on both sides and its zero the pose she fell in.
 *
 * Both bodies (woman and man) share one rig, so one table describes them.
 */

interface Part {
  from: string;
  /** Bone the segment runs to; null for a ball at `from`, pushed out along its parent. */
  to: string | null;
  radius: number;
  /** Bones this body drives. The rest follow their parents untouched. */
  drive: string[];
}

const PARTS: Record<string, Part> = {
  // Body is the pelvis-level bone the thighs hang from, and the skirt and coat are skinned to it
  // (398 vertices on her, 2,122 on him). Left undriven it stayed where she fell from and dragged
  // a long streak of cloth after the body.
  pelvis: { from: 'Hips', to: null, radius: 0.13, drive: ['Body', 'Hips'] },
  spine: { from: 'Abdomen', to: 'Chest', radius: 0.11, drive: ['Abdomen', 'Torso'] },
  chest: { from: 'Chest', to: 'Neck', radius: 0.13, drive: ['Chest'] },
  head: { from: 'Head', to: null, radius: 0.11, drive: ['Head'] },
  upperArmL: { from: 'UpperArmL', to: 'LowerArmL', radius: 0.05, drive: ['UpperArmL'] },
  lowerArmL: { from: 'LowerArmL', to: 'WristL', radius: 0.045, drive: ['LowerArmL'] },
  upperArmR: { from: 'UpperArmR', to: 'LowerArmR', radius: 0.05, drive: ['UpperArmR'] },
  lowerArmR: { from: 'LowerArmR', to: 'WristR', radius: 0.045, drive: ['LowerArmR'] },
  thighL: { from: 'UpperLegL', to: 'LowerLegL', radius: 0.07, drive: ['UpperLegL'] },
  // The feet hang off the rig's root, not the shins (an IK leftover in the export), so the shin
  // has to carry them explicitly or they stay standing where she fell.
  shinL: { from: 'LowerLegL', to: 'FootL', radius: 0.055, drive: ['LowerLegL', 'FootL'] },
  thighR: { from: 'UpperLegR', to: 'LowerLegR', radius: 0.07, drive: ['UpperLegR'] },
  shinR: { from: 'LowerLegR', to: 'FootR', radius: 0.055, drive: ['LowerLegR', 'FootR'] },
};

/**
 * Joints, parent to child, at a bone. A hinge bends about the body's local X (her left) between
 * limits given relative to STRAIGHT, in radians; the angle she is already bent at is measured
 * and subtracted, since the joint's zero is the pose she fell in. Positive X turns down into back.
 */
const JOINTS: Array<{ a: string; b: string; at: string; hinge?: [number, number]; measure?: [string, string] }> = [
  { a: 'pelvis', b: 'spine', at: 'Abdomen', hinge: [-0.35, 0.9] },
  { a: 'spine', b: 'chest', at: 'Chest', hinge: [-0.3, 0.6] },
  { a: 'chest', b: 'head', at: 'Neck', hinge: [-0.7, 0.9] },
  { a: 'chest', b: 'upperArmL', at: 'UpperArmL' },
  { a: 'chest', b: 'upperArmR', at: 'UpperArmR' },
  // An elbow closes forward, a knee closes back.
  { a: 'upperArmL', b: 'lowerArmL', at: 'LowerArmL', hinge: [-2.5, 0.05], measure: ['UpperArmL', 'WristL'] },
  { a: 'upperArmR', b: 'lowerArmR', at: 'LowerArmR', hinge: [-2.5, 0.05], measure: ['UpperArmR', 'WristR'] },
  { a: 'pelvis', b: 'thighL', at: 'UpperLegL' },
  { a: 'pelvis', b: 'thighR', at: 'UpperLegR' },
  { a: 'thighL', b: 'shinL', at: 'LowerLegL', hinge: [-0.05, 2.4], measure: ['UpperLegL', 'FootL'] },
  { a: 'thighR', b: 'shinR', at: 'LowerLegR', hinge: [-0.05, 2.4], measure: ['UpperLegR', 'FootR'] },
];

/** Bones in parent-before-child order, so each is driven after the one it hangs from. */
const ORDER = ['Body', 'Hips', 'Abdomen', 'Torso', 'Chest', 'Head', 'UpperArmL', 'LowerArmL', 'UpperArmR', 'LowerArmR', 'UpperLegL', 'LowerLegL', 'UpperLegR', 'LowerLegR', 'FootL', 'FootR'];

/** Below this pelvis speed she counts as having stopped. */
const AT_REST = 0.35;
/** Stopped for this long, she gets up. */
const REST_FOR = 0.7;
/** However long the tumble, she gets up after this. */
const MAX_TIME = 5;

export interface Ragdoll {
  readonly active: boolean;
  /** A point at about her waist, for the camera to follow while she is down. */
  readonly focus: THREE.Vector3;
  /** Goes limp, carrying `velocity`. `facing` is her current orientation. */
  start(root: THREE.Object3D, facing: THREE.Quaternion, velocity: THREE.Vector3): void;
  /** Drives the skeleton from the bodies; true once she has come to rest and should get up. */
  update(dt: number): boolean;
  /** Ends it: the bodies go, the skeleton keeps the pose, and this says where her feet are now. */
  finish(): { pelvis: THREE.Vector3; facing: THREE.Vector3 };
}

export function createRagdoll(physics: Physics): Ragdoll {
  const R = physics.RAPIER;
  const world = physics.world;
  let active = false;
  let bones = new Map<string, THREE.Bone>();
  const bodies = new Map<string, RAPIER.RigidBody>();
  const driven: Array<{ bone: THREE.Bone; body: RAPIER.RigidBody; offset: THREE.Matrix4; scale: THREE.Vector3 }> = [];
  const focus = new THREE.Vector3();
  let time = 0;
  let still = 0;

  const v = new THREE.Vector3();
  const w = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const Y = new THREE.Vector3(0, 1, 0);
  const pos = (name: string): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(bones.get(name)!.matrixWorld);

  function bodyMatrix(b: RAPIER.RigidBody, out: THREE.Matrix4): THREE.Matrix4 {
    const t = b.translation();
    const r = b.rotation();
    return out.compose(v.set(t.x, t.y, t.z), q.set(r.x, r.y, r.z, r.w), w.set(1, 1, 1));
  }

  return {
    get active() {
      return active;
    },
    focus,

    start(root, facing, velocity) {
      bones = new Map();
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        if ((o as THREE.Bone).isBone && !bones.has(o.name)) bones.set(o.name, o as THREE.Bone);
      });
      if (!Object.values(PARTS).every((p) => bones.has(p.from) && (!p.to || bones.has(p.to)))) return;

      const inv = facing.clone().invert();
      const up = Y.clone().applyQuaternion(facing);
      bodies.clear();
      driven.length = 0;

      for (const [name, p] of Object.entries(PARTS)) {
        const a = pos(p.from);
        // A ball at `from`: the head sits above its bone, the pelvis on it.
        const b = p.to ? pos(p.to) : a.clone().addScaledVector(up, name === 'head' ? 0.22 : 0.02);
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const len = a.distanceTo(b);
        const body = world.createRigidBody(
          R.RigidBodyDesc.dynamic()
            .setTranslation(mid.x, mid.y, mid.z)
            .setRotation(facing)
            .setLinvel(velocity.x, velocity.y, velocity.z)
            .setLinearDamping(0.1)
            .setAngularDamping(1.2)
            .setCanSleep(false)
            .setCcdEnabled(true)
        );
        const shape =
          p.to && len > p.radius * 2
            ? R.ColliderDesc.capsule(len / 2 - p.radius, p.radius).setRotation(
                inv.clone().multiply(new THREE.Quaternion().setFromUnitVectors(Y, b.clone().sub(a).normalize()))
              )
            : R.ColliderDesc.ball(p.radius);
        world.createCollider(
          shape.setDensity(1000).setFriction(0.9).setRestitution(0.05).setCollisionGroups(groups(GROUP_RAGDOLL, GROUP_WORLD)),
          body
        );
        bodies.set(name, body);
        for (const boneName of p.drive) {
          const bone = bones.get(boneName);
          if (!bone) continue;
          driven.push({
            bone,
            body,
            offset: bodyMatrix(body, new THREE.Matrix4()).invert().multiply(bone.matrixWorld),
            scale: bone.scale.clone(),
          });
        }
      }
      driven.sort((x, y) => ORDER.indexOf(x.bone.name) - ORDER.indexOf(y.bone.name));

      const toLocal = (name: string, p: THREE.Vector3) => {
        const t = bodies.get(name)!.translation();
        return p.clone().sub(v.set(t.x, t.y, t.z)).applyQuaternion(inv);
      };
      for (const j of JOINTS) {
        const at = pos(j.at);
        const a1 = toLocal(j.a, at);
        const a2 = toLocal(j.b, at);
        if (j.hinge) {
          const data = R.JointData.revolute(a1, a2, { x: 1, y: 0, z: 0 });
          // How far this joint is already bent, about her left: the limits are from straight.
          let bent = 0;
          if (j.measure) {
            const s = pos(j.measure[0]);
            const upper = at.clone().sub(s).applyQuaternion(inv);
            const lower = pos(j.measure[1]).sub(at).applyQuaternion(inv);
            bent = Math.atan2(upper.clone().cross(lower).x, upper.dot(lower));
          }
          const joint = world.createImpulseJoint(data, bodies.get(j.a)!, bodies.get(j.b)!, true);
          // On the joint, not the descriptor: in Rapier 0.12 a descriptor's limits are only read
          // for prismatic joints and silently dropped for a hinge, which left every knee and
          // elbow swinging freely - measured, a knee settled bent 97 degrees the wrong way.
          (joint as RAPIER.RevoluteImpulseJoint).setLimits(j.hinge[0] - bent, j.hinge[1] - bent);
        } else {
          world.createImpulseJoint(R.JointData.spherical(a1, a2), bodies.get(j.a)!, bodies.get(j.b)!, true);
        }
      }

      // A little tumble, so a fall straight down does not land as a plank.
      const spin = new THREE.Vector3(1, 0, 0).applyQuaternion(facing).multiplyScalar(-1.5 - Math.random());
      bodies.get('chest')!.setAngvel(spin, true);

      time = 0;
      still = 0;
      active = true;
    },

    update(dt) {
      if (!active) return false;
      time += dt;
      for (const d of driven) {
        // World pose from the body, then into the parent's space - the parent having just been
        // updated itself, since the list runs parents first.
        bodyMatrix(d.body, m).multiply(d.offset);
        const parent = d.bone.parent!;
        local.copy(parent.matrixWorld).invert().multiply(m);
        local.decompose(d.bone.position, d.bone.quaternion, w);
        d.bone.scale.copy(d.scale);
        d.bone.updateMatrixWorld(true);
      }
      const pelvis = bodies.get('pelvis')!;
      const t = pelvis.translation();
      focus.set(t.x, t.y, t.z);
      const speed = Math.hypot(pelvis.linvel().x, pelvis.linvel().y, pelvis.linvel().z);
      still = speed < AT_REST ? still + dt : 0;
      return still > REST_FOR || time > MAX_TIME;
    },

    finish() {
      const t = bodies.get('pelvis')!.translation();
      const h = bodies.get('head')!.translation();
      const pelvis = new THREE.Vector3(t.x, t.y, t.z);
      for (const b of bodies.values()) world.removeRigidBody(b);
      bodies.clear();
      driven.length = 0;
      active = false;
      // She gets up facing the way her head ended up pointing, as anyone would.
      return { pelvis, facing: new THREE.Vector3(h.x, h.y, h.z).sub(pelvis) };
    },
  };
}
