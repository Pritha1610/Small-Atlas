import * as THREE from 'three';
import { Controller } from './controller';

export class Player {
  group = new THREE.Group();
  private model = new THREE.Group();
  private legL = new THREE.Object3D();
  private legR = new THREE.Object3D();
  private armL = new THREE.Object3D();
  private armR = new THREE.Object3D();
  private body: THREE.Mesh;
  private phase = 0;
  private facing = new THREE.Quaternion();
  private tmpQ = new THREE.Quaternion();

  private _dir = new THREE.Vector3();
  private _up = new THREE.Vector3();
  private _xAxis = new THREE.Vector3();
  private _basis = new THREE.Matrix4();

  constructor(gradientMap: THREE.Texture) {
    const jacket = new THREE.MeshToonMaterial({ color: '#e76f51', gradientMap });
    const pants = new THREE.MeshToonMaterial({ color: '#2a9d8f', gradientMap });
    const skin = new THREE.MeshToonMaterial({ color: '#f4a261', gradientMap });
    const dark = new THREE.MeshToonMaterial({ color: '#3a3a44', gradientMap });

    const legGeo = new THREE.BoxGeometry(0.22, 0.5, 0.2);
    const armGeo = new THREE.BoxGeometry(0.15, 0.44, 0.16);

    const legLMesh = new THREE.Mesh(legGeo, pants);
    legLMesh.position.y = -0.25;
    this.legL.position.set(-0.11, 0.55, 0);
    this.legL.add(legLMesh);

    const legRMesh = new THREE.Mesh(legGeo, pants);
    legRMesh.position.y = -0.25;
    this.legR.position.set(0.11, 0.55, 0);
    this.legR.add(legRMesh);

    const armLMesh = new THREE.Mesh(armGeo, jacket);
    armLMesh.position.y = -0.22;
    this.armL.position.set(-0.28, 0.94, 0);
    this.armL.add(armLMesh);

    const armRMesh = new THREE.Mesh(armGeo, jacket);
    armRMesh.position.y = -0.22;
    this.armR.position.set(0.28, 0.94, 0);
    this.armR.add(armRMesh);

    this.body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.38, 0.26), jacket);
    this.body.position.y = 0.78;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), skin);
    head.position.y = 1.16;

    const eyeGeo = new THREE.BoxGeometry(0.05, 0.06, 0.02);
    const eyeL = new THREE.Mesh(eyeGeo, dark);
    eyeL.position.set(-0.1, 1.2, 0.24);
    const eyeR = new THREE.Mesh(eyeGeo, dark);
    eyeR.position.set(0.1, 1.2, 0.24);

    this.model.add(
      this.legL,
      this.legR,
      this.armL,
      this.armR,
      this.body,
      head,
      eyeL,
      eyeR
    );
    this.group.add(this.model);
  }

  setPosition(p: THREE.Vector3): void {
    this.group.position.copy(p);
  }

  update(dt: number, controller: Controller, forward: THREE.Vector3): void {
    const speed = controller.flatSpeed;
    const moving = speed > 0.4;
    const running = speed > 6.5;

    if (moving) {
      this.phase += (running ? 13 : 9) * dt;
    }

    const amp = running ? 0.55 : 0.38;
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);

    if (controller.grounded) {
      this.legL.rotation.x = s * amp;
      this.legR.rotation.x = -s * amp;
      this.armL.rotation.x = -s * amp * 0.9;
      this.armR.rotation.x = s * amp * 0.9;
      this.body.position.y = 0.78 + Math.abs(c) * (running ? 0.06 : 0.035);
      this.model.rotation.x = running ? -0.14 : -0.04;
    } else {
      this.legL.rotation.x = 0.6;
      this.legR.rotation.x = -0.5;
      this.armL.rotation.x = -2.5;
      this.armR.rotation.x = -2.5;
      this.model.rotation.x = -0.12;
    }

    const dir = this._dir;
    if (controller.flatVel.lengthSq() > 0.01) {
      dir.copy(controller.flatVel);
    } else if (forward.lengthSq() > 0.01) {
      dir.copy(forward);
    }
    if (dir.lengthSq() > 0.01) {
      dir.normalize();
      const up = this._up.copy(this.group.position).normalize();
      const xAxis = this._xAxis.crossVectors(up, dir).normalize();
      this._basis.makeBasis(xAxis, up, dir);
      this.tmpQ.setFromRotationMatrix(this._basis);
      this.facing.slerp(this.tmpQ, 1 - Math.exp(-10 * dt));
      this.group.quaternion.copy(this.facing);
    }
  }
}
