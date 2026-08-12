import * as THREE from 'three';

export function createBlobShadow(): THREE.Mesh {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.1,
    size / 2,
    size / 2,
    size / 2
  );
  g.addColorStop(0, 'rgba(8,10,18,0.85)');
  g.addColorStop(0.6, 'rgba(8,10,18,0.4)');
  g.addColorStop(1, 'rgba(8,10,18,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), mat);
  mesh.renderOrder = 5;
  return mesh;
}

export function updateBlobShadow(
  shadow: THREE.Mesh,
  feet: THREE.Vector3,
  grounded: boolean,
  up: THREE.Vector3
): void {
  shadow.position.copy(feet).addScaledVector(up, 0.04);
  shadow.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    up
  );
  (shadow.material as THREE.MeshBasicMaterial).opacity = grounded ? 0.85 : 0.25;
}
