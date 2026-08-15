import * as THREE from 'three';
import { Input } from './input';

export class CameraRig {
  yaw = 0.6;
  pitch = 0.34;
  dist = 7;
  moveForward = new THREE.Vector3(0, 0, -1);

  private camera: THREE.PerspectiveCamera;
  private pos = new THREE.Vector3(60, 80, 80);
  private look = new THREE.Vector3();
  private _up = new THREE.Vector3();
  private _wRef = new THREE.Vector3(0, 0, 1);
  private _wRight = new THREE.Vector3(1, 0, 0);
  private _orbit = new THREE.Vector3();
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
    collidables: THREE.Object3D[]
  ): void {
    const wRef = this._wRef
      .copy(this._wRef)
      .addScaledVector(up, -this._wRef.dot(up));
    if (wRef.lengthSq() < 1e-6) wRef.set(0, 0, 1);
    wRef.normalize();
    const wRight = this._wRight.crossVectors(up, wRef).normalize();

    this.yaw += input.yawDelta;
    input.yawDelta = 0;
    this.pitch = THREE.MathUtils.clamp(this.pitch, 0.08, 1.1);

    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const orbit = this._orbit
      .addScaledVector(wRight, cp * sy)
      .addScaledVector(wRef, cp * cy)
      .addScaledVector(up, sp)
      .normalize();

    const target = this._target.copy(playerPos).addScaledVector(up, 1.3);
    const desired = this._desired.copy(target).addScaledVector(orbit, this.dist);

    this._ray.set(target, orbit);
    this._ray.near = 0;
    this._ray.far = this.dist;
    this._ray.firstHitOnly = true;
    const hits = this._ray.intersectObjects(collidables, false);
    if (hits.length > 0 && hits[0].distance > 0.6) {
      desired.copy(target).addScaledVector(orbit, hits[0].distance - 0.4);
    }

    this.pos.lerp(desired, 1 - Math.exp(-8 * dt));
    this.look.copy(target);
    this.camera.position.copy(this.pos);
    this.camera.up.copy(up);
    this.camera.lookAt(this.look);

    this.moveForward.copy(target).sub(this.pos);
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
