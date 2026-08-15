import * as THREE from 'three';
import { Controller } from './controller';
import { Input } from './input';
import { loadModel, applyToonMaterial } from '../world/assets';

export const PLAYER_SKINS = ['/models/character.glb', '/models/player.glb'];

function findClip(clips: THREE.AnimationClip[], ...names: string[]): THREE.AnimationClip | undefined {
  return clips.find((c) => names.some((n) => c.name.toLowerCase().includes(n)));
}

export class Player {
  group = new THREE.Group();
  private gradientMap: THREE.Texture;
  private input: Input;
  private model: THREE.Object3D = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private idleAction: THREE.AnimationAction | null = null;
  private walkAction: THREE.AnimationAction | null = null;
  private runAction: THREE.AnimationAction | null = null;
  private skinIndex = 0;
  private switching = false;
  private phase = 0;
  private facing = new THREE.Quaternion();
  private tmpQ = new THREE.Quaternion();

  private _dir = new THREE.Vector3();
  private _up = new THREE.Vector3();
  private _xAxis = new THREE.Vector3();
  private _basis = new THREE.Matrix4();

  private constructor(gradientMap: THREE.Texture, input: Input) {
    this.gradientMap = gradientMap;
    this.input = input;
  }

  static async create(gradientMap: THREE.Texture, input: Input): Promise<Player> {
    const player = new Player(gradientMap, input);
    await player.setSkin(0);
    return player;
  }

  private async setSkin(index: number): Promise<void> {
    this.switching = true;
    const { root, animations } = await loadModel(PLAYER_SKINS[index]);
    applyToonMaterial(root, this.gradientMap);

    this.group.remove(this.model);
    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    });

    this.model = root;
    this.skinIndex = index;
    this.group.add(this.model);

    this.mixer = null;
    this.idleAction = null;
    this.walkAction = null;
    this.runAction = null;
    if (animations.length > 0) {
      this.mixer = new THREE.AnimationMixer(this.model);
      const idle = findClip(animations, 'idle');
      const walk = findClip(animations, 'walk');
      const run = findClip(animations, 'run', 'sprint');
      this.idleAction = idle ? this.mixer.clipAction(idle) : null;
      this.walkAction = walk ? this.mixer.clipAction(walk) : null;
      this.runAction = run ? this.mixer.clipAction(run) : null;
      const defaultAction = this.idleAction ?? this.walkAction ?? this.runAction;
      [this.idleAction, this.walkAction, this.runAction].forEach((a) => {
        if (!a) return;
        a.play();
        a.weight = a === defaultAction ? 1 : 0;
      });
    }
    this.switching = false;
  }

  setPosition(p: THREE.Vector3): void {
    this.group.position.copy(p);
  }

  update(dt: number, controller: Controller, forward: THREE.Vector3): void {
    if (this.input.justPressed('KeyC') && !this.switching) {
      this.setSkin((this.skinIndex + 1) % PLAYER_SKINS.length);
    }

    const speed = controller.flatSpeed;
    const moving = speed > 0.4;
    const running = speed > 6.5;

    if (this.mixer) {
      this.mixer.update(dt);
      const target: THREE.AnimationAction | null = !moving
        ? this.idleAction
        : running
          ? (this.runAction ?? this.walkAction)
          : (this.walkAction ?? this.idleAction);
      [this.idleAction, this.walkAction, this.runAction].forEach((a) => {
        if (!a) return;
        const weight = a === target ? 1 : 0;
        a.weight = THREE.MathUtils.lerp(a.weight, weight, 1 - Math.exp(-8 * dt));
      });
    } else {
      if (moving) this.phase += (running ? 13 : 9) * dt;
      const amp = running ? 0.06 : 0.035;
      const c = Math.cos(this.phase);
      if (controller.grounded) {
        this.model.position.y = Math.abs(c) * amp;
        this.model.rotation.x = running ? -0.14 : -0.04;
      } else {
        this.model.position.y = 0;
        this.model.rotation.x = -0.12;
      }
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
