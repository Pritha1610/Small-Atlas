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
        if (skinned) recentreSkinOnRig(gltf.scene);
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

/**
 * 14 of the 15 NPC glbs were exported from one authoring scene in which all the characters
 * stood side by side on a grid: each mesh kept its grid slot baked into its vertex positions
 * while its armature stayed at the origin, up to 3.9 units away. Bind pose still looks perfect
 * (there the skinning delta is identity, which is why every bounding-box audit passed), but as
 * soon as a bone rotates it levers those vertices around a pivot metres from the body, tearing
 * the mesh into spikes and flinging it off the spot the placement code vetted.
 *
 * Translating the geometry back onto the rig is exact rather than a nudge: the inverse bind
 * matrices are plain inverses of the joints' bind transforms, so they encode nothing about
 * where the mesh sits, and moving the vertices fixes the lever arm without touching the
 * skeleton, the clips or the bind matrices. Runs once per file on the cached original, so
 * every SkeletonUtils clone inherits it at no per-instance cost, and is a no-op on a
 * correctly authored asset (Meera_kid today, all of them after a re-export).
 *
 * Horizontal only: the mesh sits a little above the joints on Y for every model including the
 * correct one, because that is real anatomy (scalp above the head joint), not a grid offset.
 */
function recentreSkinOnRig(scene: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  let skeleton: THREE.Skeleton | null = null;
  scene.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    geometries.add(mesh.geometry);
    if (!skeleton) skeleton = mesh.skeleton;
  });
  if (!skeleton) return;

  const skin = new THREE.Box3();
  for (const geometry of geometries) {
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    skin.union(geometry.boundingBox!);
  }

  // Bind pose straight from the inverse bind matrices, so this does not depend on whether the
  // loaded scene graph has had its world matrices updated yet.
  const rig = new THREE.Box3();
  const bind = new THREE.Matrix4();
  const joint = new THREE.Vector3();
  for (const inverse of (skeleton as THREE.Skeleton).boneInverses) {
    rig.expandByPoint(joint.setFromMatrixPosition(bind.copy(inverse).invert()));
  }

  const skinCentre = skin.getCenter(new THREE.Vector3());
  const rigCentre = rig.getCenter(new THREE.Vector3());
  const dx = skinCentre.x - rigCentre.x;
  const dz = skinCentre.z - rigCentre.z;
  // Smallest real grid offset is 1.05; a correctly authored model measures under 0.05.
  if (Math.hypot(dx, dz) < 0.25) return;

  for (const geometry of geometries) {
    geometry.translate(-dx, 0, -dz);
    geometry.computeBoundingSphere();
  }
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
    // Not src.dispose(): clones share materials with the cached original, so disposing here
    // frees a material the cache still hands out to every later clone of this path.
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  });
}
