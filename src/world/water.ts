import * as THREE from 'three';
import { PLANET_RADIUS, WATER_Y } from './planet';

export function createWater(gradientMap: THREE.Texture): THREE.Mesh {
  const material = new THREE.MeshToonMaterial({
    color: '#1e6f9c',
    transparent: true,
    opacity: 0.9,
    gradientMap,
  });

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(PLANET_RADIUS + WATER_Y, 48, 32),
    material
  );
  mesh.renderOrder = 1;
  return mesh;
}
