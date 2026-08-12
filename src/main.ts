import './style.css';
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import {
  PLANET_RADIUS,
  WATER_Y,
  createPlanet,
  findLandStart,
  sampleHeight,
} from './world/planet';
import { createWater } from './world/water';
import { createProps } from './world/props';
import { createSky } from './render/sky';
import { createToonGradient } from './render/toon';
import { createBlobShadow, updateBlobShadow } from './render/blobShadow';
import { Input } from './player/input';
import { Controller } from './player/controller';
import { Player } from './player/player';
import { CameraRig } from './player/camera';
import { createHud } from './ui';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const app = document.getElementById('app')!;

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: import.meta.env.DEV,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const sky = createSky();
scene.add(sky.mesh);
scene.fog = new THREE.Fog(sky.horizonColor, 70, 280);

const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.1,
  600
);

const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x8a7a5f, 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe3bd, 2.0);
sun.position.set(60, 80, 40);
scene.add(sun);

const gradientMap = createToonGradient();

const planet = createPlanet(gradientMap);
scene.add(planet.group);

const props = createProps(gradientMap);
scene.add(props.group);

const water = createWater(gradientMap);
scene.add(water);

const waterRadius = PLANET_RADIUS + WATER_Y;
const start = findLandStart(PLANET_RADIUS, sampleHeight);

const spawnDir = start.clone().normalize();
const spawnProbe = new THREE.Raycaster(
  start.clone().addScaledVector(spawnDir, 6),
  spawnDir.clone().negate()
);
spawnProbe.near = 0;
spawnProbe.far = 20;
spawnProbe.firstHitOnly = true;
const spawnHit = spawnProbe.intersectObject(planet.mesh, false);
if (spawnHit.length > 0) {
  start.copy(spawnHit[0].point);
}

const input = new Input(renderer.domElement);
const controller = new Controller(start);
const player = new Player(gradientMap);
player.setPosition(start);
scene.add(player.group);

const shadow = createBlobShadow();
scene.add(shadow);

const rig = new CameraRig(camera);
const hud = createHud();

const up = new THREE.Vector3();
let lastTick = performance.now();

function tick(now: number): void {
  requestAnimationFrame(tick);
  const dt = Math.min((now - lastTick) / 1000, 0.05);
  lastTick = now;

  up.copy(controller.feet).normalize();
  rig.update(dt, controller.feet, up, input, planet.mesh);
  controller.update(dt, input, planet.mesh, waterRadius, rig.moveForward);
  player.update(dt, controller, rig.moveForward);
  updateBlobShadow(shadow, controller.feet, controller.grounded, up);

  hud.update(now);
  renderer.render(scene, camera);
  input.endFrame();
}
requestAnimationFrame(tick);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__game = {
    controller,
    player,
    renderer,
    scene,
    camera,
    rig,
    input,
  };
}
