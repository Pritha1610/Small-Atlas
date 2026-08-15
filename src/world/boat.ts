import * as THREE from 'three';
import { loadModel, applyToonMaterial } from './assets';

// "Sail Boat" by Quaternius, CC0 1.0 (public domain), via Poly Pizza.
const BOAT_SCALE = 2.6;

export async function createBoat(gradientMap: THREE.Texture): Promise<THREE.Group> {
  const { root } = await loadModel('/models/boat.glb');
  applyToonMaterial(root, gradientMap);
  const group = new THREE.Group();
  group.add(root);
  group.scale.setScalar(BOAT_SCALE);
  group.visible = false;
  return group;
}
