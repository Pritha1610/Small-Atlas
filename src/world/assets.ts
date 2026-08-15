import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[]; skinned: boolean }>>();

function load(path: string) {
  let entry = cache.get(path);
  if (!entry) {
    entry = loader.loadAsync(path).then(
      (gltf) => {
        let skinned = false;
        gltf.scene.traverse((o) => {
          if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
        });
        return { scene: gltf.scene, animations: gltf.animations, skinned };
      },
      (err) => {
        console.error(`[assets] failed to load ${path}`, err);
        return { scene: new THREE.Group(), animations: [], skinned: false };
      }
    );
    cache.set(path, entry);
  }
  return entry;
}

export interface LoadedModel {
  root: THREE.Group;
  animations: THREE.AnimationClip[];
}

export async function loadModel(path: string): Promise<LoadedModel> {
  const { scene, animations, skinned } = await load(path);
  const root = (skinned ? cloneSkinned(scene) : scene.clone(true)) as THREE.Group;
  return { root, animations };
}

export function applyToonMaterial(root: THREE.Object3D, gradientMap: THREE.Texture): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material as THREE.MeshStandardMaterial;
    mesh.material = new THREE.MeshToonMaterial({
      gradientMap,
      map: src.map ?? null,
      color: src.color ? src.color.clone() : undefined,
      vertexColors: mesh.geometry.hasAttribute('color'),
    });
    src.dispose();
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  });
}
