import * as THREE from 'three';
import { PLANET_RADIUS, WATER_Y, sampleHeight } from './planet';

const GREENS = [
  new THREE.Color('#3f8a4a'),
  new THREE.Color('#5aa55a'),
  new THREE.Color('#2e7d3f'),
  new THREE.Color('#68b36b'),
];

export interface Props {
  group: THREE.Group;
}

export function createProps(gradientMap: THREE.Texture): Props {
  const group = new THREE.Group();
  const spots: Array<{
    pos: THREE.Vector3;
    up: THREE.Vector3;
    scale: number;
    color: THREE.Color;
  }> = [];

  const dir = new THREE.Vector3();
  for (let i = 0; i < 320; i++) {
    dir.set(
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1
    ).normalize();
    const h = sampleHeight(dir);
    if (h < WATER_Y + 1.6 || h > 9) continue;
    const up = dir.clone();
    const pos = up.clone().multiplyScalar(PLANET_RADIUS + h);
    spots.push({
      pos,
      up,
      scale: 0.75 + Math.random() * 0.9,
      color: GREENS[Math.floor(Math.random() * GREENS.length)],
    });
  }

  const trunkGeo = new THREE.CylinderGeometry(0.14, 0.22, 1.0, 6);
  const foliageGeo = new THREE.IcosahedronGeometry(0.85, 0);

  const trunkMat = new THREE.MeshToonMaterial({
    color: '#8a6a4a',
    gradientMap,
  });
  const foliageMat = new THREE.MeshToonMaterial({
    color: '#4f8f4c',
    gradientMap,
  });

  const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const foliageMesh = new THREE.InstancedMesh(
    foliageGeo,
    foliageMat,
    spots.length
  );

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const scale = new THREE.Vector3();
  const pos = new THREE.Vector3();

  spots.forEach((s, i) => {
    q.setFromUnitVectors(up, s.up);
    scale.set(s.scale, s.scale, s.scale);

    pos.copy(s.pos).addScaledVector(s.up, 0.55 * s.scale);
    m.compose(pos, q, scale);
    trunkMesh.setMatrixAt(i, m);

    pos.copy(s.pos).addScaledVector(s.up, 1.6 * s.scale);
    m.compose(pos, q, scale);
    foliageMesh.setMatrixAt(i, m);

    foliageMesh.setColorAt(i, s.color);
  });

  trunkMesh.instanceMatrix.needsUpdate = true;
  foliageMesh.instanceMatrix.needsUpdate = true;
  if (foliageMesh.instanceColor) foliageMesh.instanceColor.needsUpdate = true;

  group.add(trunkMesh, foliageMesh);
  return { group };
}
