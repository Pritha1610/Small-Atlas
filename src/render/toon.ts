import * as THREE from 'three';

export function createToonGradient(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 1;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 256, 0);
  g.addColorStop(0.0, '#1c2028');
  g.addColorStop(0.34, '#1c2028');
  g.addColorStop(0.34, '#69718a');
  g.addColorStop(0.6, '#69718a');
  g.addColorStop(0.6, '#c2c8d6');
  g.addColorStop(1.0, '#ffffff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  return tex;
}

export function makeOutline(mesh: THREE.Mesh, width: number): void {
  const outlineMat = new THREE.MeshBasicMaterial({
    color: 0x0b0e18,
    side: THREE.BackSide,
  });
  const outline = new THREE.Mesh(mesh.geometry, outlineMat);
  outline.position.copy(mesh.position);
  outline.rotation.copy(mesh.rotation);
  outline.scale.copy(mesh.scale);
  mesh.add(outline);
  outline.scale.multiplyScalar(1 + width);
}
