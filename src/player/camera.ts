import * as THREE from 'three';
import { Input } from './input';

/**
 * Over-the-shoulder, not the raised RPG orbit it started as.
 *
 * The old rig sat 7 units back at 19 degrees of downtilt, which frames the ground the player is
 * standing on. This one sits close and nearly level, so the frame is filled by what is AHEAD -
 * the street, the horizon, the thing worth walking to - with the character low and slightly off
 * centre in the bottom third.
 */
// Measured against the reference frame: the character should fill roughly half the frame height
// with their feet near the bottom edge. At 3.8 they filled a third of it and floated mid-frame.
// The exact figure moves with the ground slope, so this is the middle of the band that works.
const DIST = 3.2;
/** Looked at just below the crown of the head, which is what puts the feet near the frame edge. */
const LOOK_HEIGHT = 1.5;
/**
 * Lateral shift of the WHOLE view - camera and look point together. Shifting both is a pure
 * slide rather than a turn, so the character moves off centre without the camera aiming
 * anywhere different, and forward stays exactly the direction the player is facing.
 */
const SHOULDER = 0.38;
/** However tight the space, never let the pull-in put the camera inside the character's head. */
const MIN_DIST = 1.1;
/** Never let the camera sit closer than this to the ground beneath it. */
const GROUND_CLEARANCE = 0.75;
/** How far above the camera the ground probe starts. Also its reach downwards. */
const GROUND_PROBE = 6;
/**
 * How fast the view eases back behind the character while they walk, in radians per second at
 * full speed. Deliberately unhurried: turning to walk back towards the camera is the only way
 * left to look at the character's face, so the swing round behind them has to be slow enough to
 * be a look rather than a flinch. About two seconds for a full half-turn.
 *
 * Something has to do this, or the camera comes unmoored. Strafing turns the character to face
 * its velocity while the view stays pointed where it was, so the two drift apart and nothing
 * ever brings them back - the shot stops being over-the-shoulder and becomes a free camera that
 * happens to follow you. Recentring only while MOVING is what keeps both behaviours: walk and
 * the view settles behind the shoulder, stand still and it stays wherever you put it, including
 * round at the character's face.
 */
const RECENTRE_RATE = 1.7;
/** Below this the character is not really going anywhere, so nothing is recentred. */
const RECENTRE_MIN_SPEED = 0.6;
/**
 * The pitch the camera holds during play. It is not adjustable while walking, and that is the
 * point: the view is driven by where you go, not by a second stick. A free pitch let the camera
 * be dragged to a near-overhead shot, which reads as a strategy game rather than as being there.
 */
const PLAY_PITCH = 0.16;

/**
 * Look range, used only while the in-game camera is raised. Slightly BELOW level, so the top of
 * a lighthouse is readable from its foot, up to a steep look-down.
 *
 * This was briefly capped at 0.95 as a frame budget - steep downtilt measured 56fps against 120
 * level. That turned out to be the wrong fix for the wrong cause: the real problem was a far
 * plane of 800 left over from the title screen, so a downward frustum ran clean through the
 * planet and submitted the far side of the world behind terrain that completely hid it. With
 * the play far plane cut to just past the fog, looking down is now CHEAPER than looking level
 * (it sees less ground), and the ceiling can go back to where the view wants it.
 */
const PITCH_MIN = -0.22;
const PITCH_MAX = 1.25;

export class CameraRig {
  yaw = 0.6;
  pitch = PLAY_PITCH;
  /** Set while the in-game camera is raised; the only time the pointer steers the view. */
  freeLook = false;
  dist = DIST;
  moveForward = new THREE.Vector3(0, 0, -1);

  private camera: THREE.PerspectiveCamera;
  private pos = new THREE.Vector3(60, 80, 80);
  private look = new THREE.Vector3();
  private _up = new THREE.Vector3();
  private _wRef = new THREE.Vector3(0, 0, 1);
  private _wRight = new THREE.Vector3(1, 0, 0);
  private _orbit = new THREE.Vector3();
  private _right = new THREE.Vector3();
  private _probe = new THREE.Vector3();
  private _down = new THREE.Vector3();
  private _travel = new THREE.Vector3();
  private _target = new THREE.Vector3();
  private _desired = new THREE.Vector3();
  private _ray = new THREE.Raycaster();

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  update(
    dt: number,
    playerPos: THREE.Vector3,
    up: THREE.Vector3,
    input: Input,
    collidables: THREE.Object3D[],
    /** The character's horizontal velocity. The view eases in behind whatever it points at. */
    travel?: THREE.Vector3
  ): void {
    const wRef = this._wRef
      .copy(this._wRef)
      .addScaledVector(up, -this._wRef.dot(up));
    if (wRef.lengthSq() < 1e-6) wRef.set(0, 0, 1);
    wRef.normalize();
    const wRight = this._wRight.crossVectors(up, wRef).normalize();

    // Pointer look is a viewfinder privilege. During play the deltas are read and thrown away,
    // so a drag cannot accumulate and spring the view somewhere odd the moment you raise the
    // camera. Walking is the only thing that aims the shot.
    const free = this.freeLook;
    if (free) {
      this.yaw += input.yawDelta;
      this.pitch += input.pitchDelta;
      this.pitch = THREE.MathUtils.clamp(this.pitch, PITCH_MIN, PITCH_MAX);
    } else {
      this.pitch += (PLAY_PITCH - this.pitch) * (1 - Math.exp(-6 * dt));
    }
    const dragged = free && Math.abs(input.yawDelta) > 1e-5;
    input.yawDelta = 0;
    input.pitchDelta = 0;

    // Ease back behind the direction of travel - but never while the viewfinder is up, and
    // never mid-drag. Fighting the player's own aim is worse than any framing problem this
    // solves, and walking while composing a shot is a normal thing to want to do.
    if (travel && !free && !dragged) {
      const flat = this._travel.copy(travel);
      flat.addScaledVector(up, -flat.dot(up));
      const speed = flat.length();
      if (speed > RECENTRE_MIN_SPEED) {
        flat.divideScalar(speed);
        // The orbit points from the character back towards the camera, so behind them is -travel.
        const want = Math.atan2(-flat.dot(wRight), -flat.dot(wRef));
        let delta = want - this.yaw;
        // Shortest way round, or it takes the long way and spins the view through the front.
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        const step = RECENTRE_RATE * Math.min(1, speed / 3.8) * dt;
        this.yaw += THREE.MathUtils.clamp(delta, -step, step);
      }
    }

    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const orbit = this._orbit
      .addScaledVector(wRight, cp * sy)
      .addScaledVector(wRef, cp * cy)
      .addScaledVector(up, sp)
      .normalize();

    // Camera's own right, so the shoulder slide follows wherever you are looking.
    const right = this._right.crossVectors(orbit, up).normalize();

    const target = this._target
      .copy(playerPos)
      .addScaledVector(up, LOOK_HEIGHT)
      .addScaledVector(right, SHOULDER);
    const desired = this._desired.copy(target).addScaledVector(orbit, this.dist);

    this._ray.set(target, orbit);
    this._ray.near = 0;
    this._ray.far = this.dist;
    this._ray.firstHitOnly = true;
    const hits = this._ray.intersectObjects(collidables, false);
    if (hits.length > 0 && hits[0].distance > 0.6) {
      desired
        .copy(target)
        .addScaledVector(orbit, Math.max(hits[0].distance - 0.4, MIN_DIST));
    }

    // Keep it out of the dirt. The obstruction ray above only looks along the orbit line from
    // the player, which says nothing about the ground directly under where the camera lands -
    // and on a slope, swinging round to the downhill side put it 0.06 units above the terrain,
    // i.e. buried to the lens. Now that the view can be orbited to the character's face, that
    // is a shot the player will actually take.
    this._ray.set(this._probe.copy(desired).addScaledVector(up, GROUND_PROBE), this._down.copy(up).negate());
    this._ray.near = 0;
    this._ray.far = GROUND_PROBE * 2;
    this._ray.firstHitOnly = true;
    const below = this._ray.intersectObjects(collidables, false);
    if (below.length > 0) {
      // distance - PROBE, not PROBE - distance. The probe starts PROBE units ABOVE the camera,
      // so a hit further away than PROBE means the ground is that much BELOW it. Inverted, this
      // read healthy clearance as a deficit and lifted the camera by roughly its own height
      // above the ground every frame - walking downhill floated it seven units up and turned
      // the over-the-shoulder shot into a map view.
      const clearance = below[0].distance - GROUND_PROBE;
      if (clearance < GROUND_CLEARANCE) desired.addScaledVector(up, GROUND_CLEARANCE - clearance);
    }

    this.pos.lerp(desired, 1 - Math.exp(-8 * dt));
    this.look.copy(target);
    this.camera.position.copy(this.pos);
    this.camera.up.copy(up);
    this.camera.lookAt(this.look);

    // Derived from the ORBIT, not from camera-minus-target. With the shoulder offset those are
    // no longer the same line, and using the camera's would tilt "forward" about 7 degrees off
    // the way you are looking - W would visibly drift.
    this.moveForward.copy(orbit).negate();
    this.moveForward.addScaledVector(up, -this.moveForward.dot(up));
    if (this.moveForward.lengthSq() < 1e-6) this.moveForward.copy(wRef).negate();
    this.moveForward.normalize();

    this._up.copy(up);
    this._wRef.copy(wRef);
  }

  get up(): THREE.Vector3 {
    return this._up;
  }
}
