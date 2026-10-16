import * as THREE from 'three';
import { Input } from './input';

// --- weight -----------------------------------------------------------------------------
// A body has mass, so it takes time to get moving and time to stop. The old model damped
// velocity exponentially with a 0.11s time constant and accelerated to match, which meant full
// speed in about a third of a second and a dead stop almost instantly - the definition of
// weightless. These are explicit accelerate/brake times instead, so momentum is something you
// feel and have to plan around.
/** Seconds to reach top speed from a standstill. */
const ACCEL_TIME = 0.45;
/** Seconds to come to rest from top speed. Shorter than accelerating: boots do grip. */
const BRAKE_TIME = 0.32;
/** Steering authority in the air, as a fraction of the ground's. You cannot push off nothing. */
const AIR_CONTROL = 0.2;
/** Braking authority in the air. Almost none: what you launched with is what you carry. */
const AIR_BRAKE = 0.12;

// Heavier gravity with a matched jump: same sense of effort, far less hang time. At 20/8.4 the
// jump peaked at 1.76 units (taller than the character) and hung for 0.84s, which reads as low
// gravity. 34/9.8 peaks at 1.41 with 0.58s of air, so a jump is a hop and a fall has teeth.
export const GRAVITY = 34;
const JUMP = 9.8;
/**
 * An unhurried walk, in the manner of the game this one is modelled on. 5.4 crossed the whole
 * 471-unit circumference in 87 seconds, which made a planet feel like a courtyard; it also read
 * as a jog rather than a walk on a 1.65-unit character. Sprint is kept, but as an option rather
 * than the speed you travel at by default.
 */
export const WALK = 3.8;
export const RUN = 6.8;
/** Downward speed above which a landing knocks the wind out of your stride. */
const LAND_HARD = 15;
/** Fraction of horizontal speed kept through a hard landing. */
const LAND_KEEP = 0.45;
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
/** Touch stick: below this it is a resting thumb, not a request to move. */
const STICK_DEAD = 0.12;
/**
 * Pushed this far, the stick is at full speed - full WALK speed. It used to break into a run at
 * the rim, so an ordinary thumb pushed comfortably out sprinted you off things by default.
 * Running is the run toggle's job now, as it is Shift's on a keyboard.
 */
const STICK_FULL = 0.7;

// --- the body ---------------------------------------------------------------------------
/**
 * How wide the body is. Collision used to be a single line through the middle of the character,
 * so shoulders went through door frames, corners and every tree trunk you brushed past.
 */
const BODY_R = 0.3;
/** Wall probes run down the middle and down each shoulder, this far out. */
const SHOULDER = BODY_R * 0.85;
/** Directions the depenetration pass looks in, around the body. */
const AROUND = 8;

// --- terrain ----------------------------------------------------------------------------
/**
 * Wall probes, as heights above the feet. The knee ray sits just above STEP, so anything lower
 * - a kerb, a stair riser, a rock - is walked up onto by the down-probe lifting the feet. The old
 * single ray at the ankle refused all of those and stopped you dead at the bottom of every
 * staircase. The chest ray catches rails and eaves that a low ray passes underneath.
 */
const WALL_PROBES = [STEP + 0.05, 1.25];
/** How close to a wall the body is allowed, measured along the probe. */
const SKIN = 0.25;
/** Fraction of top speed lost walking straight up a 90-degree wall; real slopes cost less. */
const UPHILL_DRAG = 0.55;
/** And gained going down. Small, or every descent turns into a sprint. */
const DOWNHILL_PUSH = 0.12;
/**
 * Ground steeper than the climb limit, plus this margin, cannot be stood on: gravity takes you
 * down it. Before, landing on a cliff face from a jump held you there like glue.
 */
const SLIDE_MARGIN = 0.04;
/** How much of gravity's pull along the slope survives friction. */
const SLIDE = 0.6;
/** Nothing - a slide, a landing - gets the body moving faster than this across the ground. */
const MAX_GROUND_SPEED = 12;

// --- jumping ----------------------------------------------------------------------------
/** Seconds after running off an edge that a jump still counts. Feels fair; looks honest. */
const COYOTE = 0.12;
/** Seconds a jump pressed just before landing waits for the ground, rather than vanishing. */
const JUMP_BUFFER = 0.14;
/** Let go of jump while rising and what is left of the rise is cut to this. Tap hops, hold leaps. */
const JUMP_CUT = 0.5;

// --- the boat ---------------------------------------------------------------------------
// A hull on water has no grip, so it is slow to get going, slow to turn and glides when you
// stop. Walking speeds and boot-grip braking made the boat feel like walking in a costume.
const BOAT = 4.4;
const BOAT_RUN = 7;
const BOAT_ACCEL = 1.3;
const BOAT_BRAKE = 2.8;

export class Controller {
  feet = new THREE.Vector3();
  vel = new THREE.Vector3();
  grounded = true;
  flatVel = new THREE.Vector3();
  /** Normal of the ground last stood on: drives slope speed and sliding. */
  groundNormal = new THREE.Vector3(0, 1, 0);

  private airTime = 0;
  private jumpQueue = 0;
  private rising = false;
  private _side = new THREE.Vector3();
  private _push = new THREE.Vector3();
  private _a = new THREE.Vector3();
  private _b = new THREE.Vector3();

  private _up = new THREE.Vector3();
  private _flat = new THREE.Vector3();
  private _right = new THREE.Vector3();
  private _dir = new THREE.Vector3();
  private _flatDir = new THREE.Vector3();
  private _origin = new THREE.Vector3();
  private _normal = new THREE.Vector3();
  private _down = new THREE.Vector3();
  private _downOrigin = new THREE.Vector3();
  private _target = new THREE.Vector3();
  private _delta = new THREE.Vector3();
  private _wallN = new THREE.Vector3();
  private _ray = new THREE.Raycaster();

  constructor(start: THREE.Vector3) {
    this.feet.copy(start);
    this.groundNormal.copy(start).normalize();
  }

  /** How fast the body is falling while in the air; 0 on the ground. Drives the ragdoll. */
  get fallSpeed(): number {
    return this.grounded ? 0 : Math.max(0, -this.vel.dot(this._a.copy(this.feet).normalize()));
  }

  /** Puts the body somewhere at rest - getting up after a fall. */
  placeAt(feet: THREE.Vector3): void {
    this.feet.copy(feet);
    this.vel.set(0, 0, 0);
    this.flatVel.set(0, 0, 0);
    this.grounded = true;
    this.airTime = 0;
    this.groundNormal.copy(feet).normalize();
  }

  /**
   * Pushes the body back out of any wall it ended up overlapping - after a turn, a slide into a
   * corner, or squeezing between two things. The forward probes only stop you walking INTO
   * geometry; this stops you standing in it. Once a frame, at knee and chest height.
   */
  depenetrate(collidables: THREE.Object3D[]): void {
    const up = this._up.copy(this.feet).normalize();
    const [t1, t2] = [this._a, this._b];
    t1.set(0, 1, 0).addScaledVector(up, -up.y);
    if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0).addScaledVector(up, -up.x);
    t1.normalize();
    t2.crossVectors(up, t1);
    // Per height, the average push of the rays that hit; then the stronger of the two heights.
    // Summing instead over-corrects: a flat wall is seen by three neighbouring rays at once, and
    // pushing out three times over makes you judder against every wall you lean on.
    const push = this._push.set(0, 0, 0);
    let strongest = 0;
    for (const h of WALL_PROBES) {
      const acc = this._target.set(0, 0, 0);
      let hits = 0;
      for (let k = 0; k < AROUND; k++) {
        const a = (k / AROUND) * Math.PI * 2;
        const dir = this._side.copy(t1).multiplyScalar(Math.cos(a)).addScaledVector(t2, Math.sin(a));
        this._ray.set(this._origin.copy(this.feet).addScaledVector(up, h), dir);
        this._ray.near = 0;
        this._ray.far = BODY_R;
        this._ray.firstHitOnly = true;
        const hit = this._ray.intersectObjects(collidables, false)[0];
        if (!hit?.face) continue;
        const n = this._normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
        if (Math.abs(n.dot(up)) >= COS_SLOPE_MAX) continue; // floor or ceiling, not a wall
        acc.addScaledVector(dir, -(BODY_R - hit.distance));
        hits++;
      }
      if (hits === 0) continue;
      acc.divideScalar(hits);
      if (acc.lengthSq() > strongest) {
        strongest = acc.lengthSq();
        push.copy(acc);
      }
    }
    push.addScaledVector(up, -push.dot(up));
    if (push.lengthSq() > 1e-8) this.feet.add(push);
  }

  /** People are solid. Pushed out sideways rather than collided: they are thin and never move. */
  pushOutOf(points: THREE.Vector3[], radius: number): void {
    const up = this._up.copy(this.feet).normalize();
    for (const p of points) {
      const d = this._delta.subVectors(this.feet, p);
      if (d.lengthSq() > 4) continue;
      d.addScaledVector(up, -d.dot(up));
      const len = d.length();
      if (len < radius && len > 1e-4) this.feet.addScaledVector(d, (radius - len) / len);
    }
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

    // forward x up is +X for a -Z forward; the other order points left, which inverted A/D.
    const right = this._right.crossVectors(moveForward, up);
    if (right.lengthSq() < 1e-6) right.crossVectors(new THREE.Vector3(0, 0, 1), up);
    right.normalize();

    const dir = this._dir.set(0, 0, 0);
    if (input.isDown('KeyW') || input.isDown('ArrowUp')) dir.add(moveForward);
    if (input.isDown('KeyS') || input.isDown('ArrowDown')) dir.sub(moveForward);
    if (input.isDown('KeyD') || input.isDown('ArrowRight')) dir.add(right);
    if (input.isDown('KeyA') || input.isDown('ArrowLeft')) dir.sub(right);

    const afloat = this.feet.length() <= waterRadius + 0.06;
    const running = input.running || input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    const base = afloat ? BOAT : WALK;
    const top = afloat ? BOAT_RUN : RUN;
    let maxSpeed = running ? top : base;
    const stick = Math.hypot(input.stickX, input.stickY);
    if (dir.lengthSq() > 0) {
      dir.normalize();
    } else if (stick > STICK_DEAD) {
      dir.addScaledVector(moveForward, input.stickY).addScaledVector(right, input.stickX).normalize();
      maxSpeed = (running ? top : base) * Math.min(1, stick / STICK_FULL);
    }

    // Uphill is work and downhill is a little easy. The ground normal leans away from the rise,
    // so moving against it is climbing: straight up a 45-degree slope costs about 40% of speed.
    const n = this.groundNormal;
    if (this.grounded && !afloat && dir.lengthSq() > 0) {
      const grade = dir.dot(n);
      maxSpeed *= grade < 0 ? 1 + grade * UPHILL_DRAG : 1 + grade * DOWNHILL_PUSH;
    }

    // Move the velocity TOWARD the target at a fixed rate rather than scaling it. Steering falls
    // out of this for free: turning is a large delta, so a hard change of direction costs speed
    // the same way it would if you had to plant a foot and push. There is no hard speed clamp:
    // dropping from a run to a walk eases down at the same rate instead of snapping.
    const accelTime = afloat ? BOAT_ACCEL : ACCEL_TIME;
    const brakeTime = afloat ? BOAT_BRAKE : BRAKE_TIME;
    if (dir.lengthSq() > 0) {
      const target = this._target.copy(dir).multiplyScalar(maxSpeed);
      const rate = (Math.max(maxSpeed, base) / accelTime) * (this.grounded ? 1 : AIR_CONTROL);
      const delta = this._delta.subVectors(target, flat);
      const step = rate * dt;
      if (delta.lengthSq() <= step * step) flat.copy(target);
      else flat.addScaledVector(delta.normalize(), step);
    } else {
      const rate = (base / brakeTime) * (this.grounded ? 1 : AIR_BRAKE);
      const step = rate * dt;
      if (flat.lengthSq() <= step * step) flat.set(0, 0, 0);
      else flat.addScaledVector(this._delta.copy(flat).normalize(), -step);
    }

    // Too steep to stand on, so gravity takes you down it.
    const cosGround = n.dot(up);
    if (this.grounded && !afloat && cosGround < COS_SLOPE_MAX + SLIDE_MARGIN) {
      const downhill = this._delta.copy(n).addScaledVector(up, -cosGround);
      if (downhill.lengthSq() > 1e-6) {
        downhill.normalize();
        const sin = Math.sqrt(Math.max(0, 1 - cosGround * cosGround));
        flat.addScaledVector(downhill, GRAVITY * sin * SLIDE * dt);
      }
    }
    if (flat.length() > MAX_GROUND_SPEED) flat.setLength(MAX_GROUND_SPEED);

    // Jumping, with a little forgiveness at both ends. The press is TAKEN, not just read: this
    // runs once per physics substep, and a press still sitting in the frame's input would queue
    // a second jump the moment the first one left the ground.
    this.airTime = this.grounded ? 0 : this.airTime + dt;
    this.jumpQueue = input.take('Space') ? JUMP_BUFFER : Math.max(0, this.jumpQueue - dt);
    let nextVUp = Math.max(vUp - GRAVITY * dt, -MAX_FALL);
    if (this.jumpQueue > 0 && this.airTime <= COYOTE) {
      nextVUp = JUMP;
      this.grounded = false;
      this.jumpQueue = 0;
      this.airTime = COYOTE + 1;
      this.rising = true;
    }
    if (this.rising && nextVUp > 0 && !input.isDown('Space')) {
      nextVUp *= JUMP_CUT;
      this.rising = false;
    }
    if (nextVUp <= 0) this.rising = false;

    // Collide and slide. Only the part of the motion INTO a wall is taken away, so walking at a
    // wall on an angle slides you along it; the old probe zeroed the whole move and you stuck to
    // walls like velcro. Two passes, so a slide into a corner is stopped by the second wall too.
    for (let pass = 0; pass < 2; pass++) {
      const len = flat.length();
      if (len < 1e-4) break;
      const flatDir = this._flatDir.copy(flat).divideScalar(len);
      let wallAt = Infinity;
      // Down the middle and down each shoulder, so a post or a door frame that would only clip
      // the side of the body is still seen.
      const side = this._side.crossVectors(up, flatDir).normalize();
      for (const h of WALL_PROBES) {
        for (const off of [0, SHOULDER, -SHOULDER]) {
          this._ray.set(this._origin.copy(this.feet).addScaledVector(up, h).addScaledVector(side, off), flatDir);
          this._ray.near = 0;
          this._ray.far = len * dt + SKIN + 0.1;
          this._ray.firstHitOnly = true;
          const hit = this._ray.intersectObjects(collidables, false)[0];
          if (!hit?.face || hit.distance >= wallAt) continue;
          const wn = this._normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
          // Collision meshes are double-sided, so a hit can be on a back face pointing away.
          if (wn.dot(flatDir) > 0) wn.negate();
          if (wn.dot(up) >= COS_SLOPE_MAX) continue; // ground you can walk up, not a wall
          wallAt = hit.distance;
          this._wallN.copy(wn);
        }
      }
      if (wallAt === Infinity) break;
      const wn = this._wallN.addScaledVector(up, -this._wallN.dot(up));
      if (wn.lengthSq() < 1e-6) break;
      wn.normalize();
      const into = flat.dot(wn);
      const room = Math.max(wallAt - SKIN, 0) / Math.max(dt, 1e-4);
      if (into < -room) flat.addScaledVector(wn, -into - room);
    }

    this.vel.copy(flat).addScaledVector(up, nextVUp);
    // How hard we are coming down, captured before the ground checks below can zero it.
    const impact = this.grounded ? 0 : Math.max(0, -nextVUp);
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
          // Landing hard costs you your stride. Without this you can drop off a cliff and keep
          // sprinting the instant your feet touch, which is the single most weightless thing a
          // character can do.
          if (impact > LAND_HARD) {
            const keep = this.vel.dot(up);
            this.vel.addScaledVector(up, -keep);
            this.vel.multiplyScalar(LAND_KEEP);
            this.vel.addScaledVector(up, keep);
          }
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

    // What we are standing on, turned to face up, for the next step's slope speed and sliding.
    // Airborne keeps the last one, so a hop on a slope lands back into the same rules.
    const ground = down[0];
    if (this.grounded && ground?.face && this.feet.length() > waterRadius + 0.06) {
      const gn = this._normal.copy(ground.face.normal).transformDirection(ground.object.matrixWorld);
      this.groundNormal.copy(gn.dot(up) < 0 ? gn.negate() : gn);
    } else if (this.grounded) {
      this.groundNormal.copy(up);
    }

    this.flatVel.copy(this.vel).addScaledVector(up, -this.vel.dot(up));
  }

  get flatSpeed(): number {
    return this.flatVel.length();
  }
}
