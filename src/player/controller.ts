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
// The fell-through-the-world probe fires INWARD from outside the planet, so its start is an
// absolute radius, not a height above the player. It is derived from the water radius rather
// than hard-coded because a hard-coded 95 silently ended up INSIDE the planet when the world was
// rescaled, which left the safety net firing from under the terrain and doing nothing at all.
// 1.75x clears the tallest peaks with room to spare at any planet size.
const PROBE_SCALE = 1.75;
const STEP = 0.55;
// How high you can haul yourself while wading. The water clamp pins you to the waterline, so
// with the normal step height a beach only had to rise 0.65 above sea level before the
// controller called you airborne, dropped you, and re-clamped you - which is why coming ashore
// meant spamming jump. Buoyancy justifies a bigger step, and it only applies in water so it
// cannot be used to climb dry cliffs.
const WADE_STEP = 2.2;
// Steepest ground you can walk up, as normal-dot-up. 0.5 (60 degrees) refused most mountain
// flanks - measured p90 of high ground is 67 degrees - so summits were unreachable on foot.
// 0.36 (~69 degrees) lets you trek a mountainside while still stopping you at true cliffs.
const COS_SLOPE_MAX = 0.36;

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
    this.feet.addScaledVector(this.vel, dt);

    const downDir = this._down.copy(up).negate();
    const downOrigin = this._downOrigin.copy(this.feet).addScaledVector(up, DOWN_PROBE_OFFSET);
    this._ray.set(downOrigin, downDir);
    this._ray.near = 0;
    this._ray.far = 3 + DOWN_PROBE_OFFSET;
    this._ray.firstHitOnly = true;
    const down = this._ray.intersectObjects(collidables, false);

    const wading = this.feet.length() <= waterRadius + 0.1;
    const stepUp = wading ? WADE_STEP : STEP;

    if (down.length > 0) {
      const dist = down[0].distance - DOWN_PROBE_OFFSET;
      const lift = dist - CLEARANCE;
    if (this.grounded) {
      if (wading) {
        // Floating. The seabed is often metres down, and the ledge check below reads that as
        // "you are about to walk off a cliff", rolls the move back and zeroes the velocity -
        // which froze the player solid the moment the seabed rose within reach of the probe,
        // i.e. exactly in the shallows where you wade ashore. The water clamp already holds
        // the body at the surface, so the only thing worth reacting to here is ground that has
        // risen ABOVE the waterline: the beach.
        if (lift < -0.001) this.feet.addScaledVector(up, -lift);
      } else if (lift > STEP) {
        // Stepped off a ledge, so fall off it. This used to roll the move back and zero the
        // velocity, which on rough ground - where drops over 0.65 are everywhere - froze the
        // player solid instead: a traced climb spent 97% of its frames stuck on one spot.
        // Gravity, terminal velocity and the fell-through-the-world probe already make falling
        // safe, so there is nothing here worth refusing to move for.
        this.grounded = false;
      } else if (lift > 0.001) {
          this.feet.addScaledVector(up, -lift);
        } else if (lift < -stepUp) {
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
      const probeR = waterRadius * PROBE_SCALE;
      this._ray.set(this._downOrigin.copy(up).multiplyScalar(probeR), downDir);
      this._ray.near = 0;
      this._ray.far = probeR;
      const outside = this._ray.intersectObjects(collidables, false);
      if (outside.length > 0 && this.feet.length() < outside[0].point.length() - 0.01) {
        this.feet.copy(outside[0].point).addScaledVector(up, CLEARANCE);
        const vU = this.vel.dot(up);
        if (vU < 0) this.vel.addScaledVector(up, -vU);
        this.grounded = true;
      }
    }

    // Invariant: never finish a step inside the ground. Several branches above can leave the
    // feet buried - stepping off a ledge onto a rising slope, a fast landing, a steep wall - and
    // once buried the downward probe sees only back faces and the player sinks out of the world.
    // Enforcing it in one place beats patching each path, and it costs nothing: the probe result
    // is already in hand.
    if (down.length > 0) {
      const buried = down[0].distance - DOWN_PROBE_OFFSET - CLEARANCE;
      if (buried < -0.02) {
        this.feet.addScaledVector(up, -buried);
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
