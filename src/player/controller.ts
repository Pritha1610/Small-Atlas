import * as THREE from 'three';
import { Input } from './input';

const GRAVITY = 20;
const JUMP = 8.4;
const WALK = 5.4;
const RUN = 9.4;
const DAMP = 9;
const CLEARANCE = 0.1;
// The down-probe starts this far above the feet so it can still see the ground after a fast
// landing has already carried the feet below the surface; from underneath, the terrain's
// front faces are invisible to a downward ray and the player would fall through the world.
const DOWN_PROBE_OFFSET = 1.0;
// Bounds the per-substep fall distance to stay inside DOWN_PROBE_OFFSET.
const MAX_FALL = 35;
// Comfortably outside the tallest terrain (max radius ~67), for the fell-through-the-world probe.
const PROBE_HEIGHT = 95;
const STEP = 0.55;
const COS_SLOPE_MAX = 0.5;

export class Controller {
  feet = new THREE.Vector3();
  vel = new THREE.Vector3();
  grounded = true;
  flatVel = new THREE.Vector3();

  private _up = new THREE.Vector3();
  private _flat = new THREE.Vector3();
  private _right = new THREE.Vector3();
  private _dir = new THREE.Vector3();
  private _flatDir = new THREE.Vector3();
  private _origin = new THREE.Vector3();
  private _normal = new THREE.Vector3();
  private _down = new THREE.Vector3();
  private _downOrigin = new THREE.Vector3();
  private _ray = new THREE.Raycaster();

  constructor(start: THREE.Vector3) {
    this.feet.copy(start);
  }

  update(
    dt: number,
    input: Input,
    collidables: THREE.Object3D[],
    waterRadius: number,
    moveForward: THREE.Vector3
  ): void {
    const up = this._up.copy(this.feet).normalize();
    const vUp = this.vel.dot(up);
    const flat = this._flat.copy(this.vel).addScaledVector(up, -vUp);
    flat.multiplyScalar(Math.exp(-DAMP * dt));

    // forward x up is +X for a -Z forward; the other order points left, which inverted A/D.
    const right = this._right.crossVectors(moveForward, up);
    if (right.lengthSq() < 1e-6) right.crossVectors(new THREE.Vector3(0, 0, 1), up);
    right.normalize();

    const dir = this._dir.set(0, 0, 0);
    if (input.isDown('KeyW')) dir.add(moveForward);
    if (input.isDown('KeyS')) dir.sub(moveForward);
    if (input.isDown('KeyD')) dir.add(right);
    if (input.isDown('KeyA')) dir.sub(right);
    if (dir.lengthSq() > 0) dir.normalize();

    const maxSpeed =
      input.isDown('ShiftLeft') || input.isDown('ShiftRight') ? RUN : WALK;
    // Accelerate in proportion to the target speed. With a fixed ACCEL the damping equilibrium
    // (ACCEL/DAMP = 3.1) sat below WALK, so the max-speed clamp never engaged and Shift did
    // nothing. Scaling by maxSpeed makes the equilibrium the target speed itself.
    if (dir.lengthSq() > 0) {
      flat.addScaledVector(dir, maxSpeed * DAMP * dt);
      if (flat.length() > maxSpeed) flat.setLength(maxSpeed);
    }

    let nextVUp = Math.max(vUp - GRAVITY * dt, -MAX_FALL);
    if (input.jumpPressed() && this.grounded) {
      nextVUp = JUMP;
      this.grounded = false;
    }

    const flatLen = flat.length();
    if (flatLen > 1e-4) {
      const flatDir = this._flatDir.copy(flat).normalize();
      const origin = this._origin.copy(this.feet).addScaledVector(up, 0.05);
      this._ray.set(origin, flatDir);
      this._ray.near = 0;
      this._ray.far = flatLen * dt + 0.35;
      this._ray.firstHitOnly = true;
      const hits = this._ray.intersectObjects(collidables, false);
      if (hits.length > 0 && hits[0].face) {
        const n = this._normal.copy(hits[0].face.normal);
        n.transformDirection(hits[0].object.matrixWorld);
        n.normalize();
        if (n.dot(up) < COS_SLOPE_MAX) {
          const allowed = Math.max(hits[0].distance - 0.25, 0);
          flat.setLength(Math.min(flatLen, allowed / Math.max(dt, 1e-4)));
        }
      }
    }

    this.vel.copy(flat).addScaledVector(up, nextVUp);
    const before = this._origin.copy(this.feet);
    this.feet.addScaledVector(this.vel, dt);

    const downDir = this._down.copy(up).negate();
    const downOrigin = this._downOrigin.copy(this.feet).addScaledVector(up, DOWN_PROBE_OFFSET);
    this._ray.set(downOrigin, downDir);
    this._ray.near = 0;
    this._ray.far = 3 + DOWN_PROBE_OFFSET;
    this._ray.firstHitOnly = true;
    const down = this._ray.intersectObjects(collidables, false);

    if (down.length > 0) {
      const dist = down[0].distance - DOWN_PROBE_OFFSET;
      const lift = dist - CLEARANCE;
    if (this.grounded) {
      if (lift > STEP) {
        if (this.flatVel.lengthSq() > 0.01) {
          this.feet.copy(before);
          this.vel.set(0, 0, 0);
        } else {
          this.grounded = false;
        }
      } else if (lift > 0.001) {
          this.feet.addScaledVector(up, -lift);
        } else if (lift < -STEP) {
          this.grounded = false;
        } else if (lift < -0.001) {
          this.feet.addScaledVector(up, -lift);
        }
      } else if (dist <= CLEARANCE + 0.06) {
        const vU = this.vel.dot(up);
        if (vU <= 0) {
          this.feet.addScaledVector(up, -lift);
          this.vel.addScaledVector(up, -vU);
          this.grounded = true;
        }
      }
    } else {
      this.grounded = false;
      // Safety net. A fast landing can still carry the feet under the surface, and from below
      // a downward ray sees only back faces, so the player would keep falling through the
      // world. Probe inward from outside the planet to find the true surface; if the feet are
      // beneath it, put them back on top. Only runs when nothing was found below, so it costs
      // one extra raycast on genuinely airborne frames.
      this._ray.set(this._downOrigin.copy(up).multiplyScalar(PROBE_HEIGHT), downDir);
      this._ray.near = 0;
      this._ray.far = PROBE_HEIGHT;
      const outside = this._ray.intersectObjects(collidables, false);
      if (outside.length > 0 && this.feet.length() < outside[0].point.length() - 0.01) {
        this.feet.copy(outside[0].point).addScaledVector(up, CLEARANCE);
        const vU = this.vel.dot(up);
        if (vU < 0) this.vel.addScaledVector(up, -vU);
        this.grounded = true;
      }
    }

    if (this.grounded) {
      const vU = this.vel.dot(up);
      if (vU < 0) this.vel.addScaledVector(up, -vU);
    }

    if (this.feet.length() < waterRadius) {
      this.feet.setLength(waterRadius);
      const vU = this.vel.dot(up);
      if (vU < 0) this.vel.addScaledVector(up, -vU);
      this.grounded = true;
    }

    this.flatVel.copy(this.vel).addScaledVector(up, -this.vel.dot(up));
  }

  get flatSpeed(): number {
    return this.flatVel.length();
  }
}
