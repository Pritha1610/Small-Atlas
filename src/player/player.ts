import * as THREE from 'three';
import { WALK, RUN } from './controller';

import { Controller } from './controller';
import { loadModel, applyToonMaterial } from '../world/assets';

/**
 * The player character. Untextured, so her five flat material colours are retinted here rather
 * than in the asset, and she carries her own Idle/Walk/Run on a 62-bone rig, so she needs
 * nothing from the settled cast's 20-bone skeleton.
 */
export const CHARACTERS = {
  woman: {
    path: '/models/Woman.glb',
    /** Native height, used to scale down to the height everyone else in the world stands at. */
    native: 1.8,
    tint: {
      Skin: '#a5714a',
      Red: '#7d2f3a',
      Brown: '#241a14',
      LimeGreen: '#3f6f5e',
      Gold: '#c08a4a',
    } as Record<string, string>,
  },
  man: {
    path: '/models/Man.glb',
    native: 1.79,
    tint: {
      Skin: '#9c6640',
      Brown: '#241a14',
      Brown2: '#4a3d26',
      Brown_02: '#6a5a3a',
      Hair_Brown: '#2c241c',
      Green: '#3c4230',
      LightGreen: '#4d5340',
      White: '#a8a498',
      Gold: '#c08a4a',
    } as Record<string, string>,
  },
} as const;

export type CharacterId = keyof typeof CHARACTERS;

/** Height every body is scaled to, so the camera and boat deck do not care which one is on. */
const TARGET_HEIGHT = 1.65;

function findClip(clips: THREE.AnimationClip[], ...names: string[]): THREE.AnimationClip | undefined {
  return clips.find((c) => names.some((n) => c.name.toLowerCase().includes(n)));
}

export class Player {
  group = new THREE.Group();
  private gradientMap: THREE.Texture;
  private model: THREE.Object3D = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private idleAction: THREE.AnimationAction | null = null;
  private walkAction: THREE.AnimationAction | null = null;
  private runAction: THREE.AnimationAction | null = null;
  private phase = 0;
  private facing = new THREE.Quaternion();
  private tmpQ = new THREE.Quaternion();

  private _dir = new THREE.Vector3();
  private _up = new THREE.Vector3();
  private _xAxis = new THREE.Vector3();
  private _basis = new THREE.Matrix4();

  private who: CharacterId = 'woman';
  private swapping = false;

  private constructor(gradientMap: THREE.Texture) {
    this.gradientMap = gradientMap;
  }

  get character(): CharacterId {
    return this.who;
  }

  /** Swaps body in place. Both are preloaded, so this is a cache hit and finishes in a frame. */
  async setCharacter(who: CharacterId): Promise<void> {
    if (who === this.who || this.swapping) return;
    this.swapping = true;
    await this.build(who);
    this.swapping = false;
  }

  static async create(gradientMap: THREE.Texture, who: CharacterId = 'woman'): Promise<Player> {
    const player = new Player(gradientMap);
    await player.build(who);
    return player;
  }

  private async build(who: CharacterId): Promise<void> {
    const spec = CHARACTERS[who];
    const { root, animations } = await loadModel(spec.path);

    // Detach the old body but do NOT dispose its geometry or materials: clones share both with
    // the loader's cached original, so freeing them here would corrupt every later clone.
    this.group.remove(this.model);
    this.mixer = null;
    this.idleAction = null;
    this.walkAction = null;
    this.runAction = null;
    this.who = who;

    applyToonMaterial(root, this.gradientMap);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const hex = spec.tint[(mesh.material as THREE.Material).name];
      if (hex) (mesh.material as THREE.MeshToonMaterial).color.set(hex);
    });
    root.scale.setScalar(TARGET_HEIGHT / spec.native);

    this.model = root;
    this.group.add(this.model);

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
  }

  setPosition(p: THREE.Vector3): void {
    this.group.position.copy(p);
  }

  update(dt: number, controller: Controller, forward: THREE.Vector3): void {
    const speed = controller.flatSpeed;
    const moving = speed > 0.4;
    const running = speed > (WALK + RUN) / 2;

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
      // The clips were authored for one gait. Play them at the rate the character is actually
      // travelling or the feet skate, which a slower walk makes obvious.
      if (this.walkAction) this.walkAction.timeScale = THREE.MathUtils.clamp(speed / WALK, 0.55, 1.5);
      if (this.runAction) this.runAction.timeScale = THREE.MathUtils.clamp(speed / RUN, 0.6, 1.4);
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
      // The body turns the whole way to face where it is going, with nothing capping it.
      // A cap was tried here to stop a held strafe trailing the camera, and it cost far more
      // than it bought: pressing back could no longer turn the character round, so she moonwalked
      // away from the camera, and with pointer look gone this was also the only remaining way to
      // ever see her face. Backing up to look at her is worth a loose strafe.
      dir.copy(controller.flatVel).normalize();
    } else if (dir.lengthSq() < 0.01 && forward.lengthSq() > 0.01) {
      // ONLY to establish a facing on the very first frame, when there is no movement to read
      // one from. Falling back to the camera's forward on every idle frame is what locked the
      // view to the character's back: standing still, orbiting the camera swung the character
      // round with it, so their face could never be brought into shot. Standing still now means
      // standing still, and the camera walks around them.
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
