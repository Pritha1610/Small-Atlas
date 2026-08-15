import './style.css';
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import {
  PLANET_RADIUS,
  WATER_Y,
  createPlanet,
  carveTerraces,
  findLandStart,
  sampleHeight,
} from './world/planet';
import { createWater, waveHeight } from './world/water';
import { createProps } from './world/props';
import { windTime } from './render/wind';
import { updateDaylight } from './render/daylight';
import { createWonders } from './world/wonders';
import { createSettlements } from './world/settlements';
import { createBoat } from './world/boat';
import { createSky } from './render/sky';
import { createToonGradient } from './render/toon';
import { createBlobShadow, updateBlobShadow } from './render/blobShadow';
import { Input } from './player/input';
import { Controller } from './player/controller';
import { Player } from './player/player';
import { CameraRig } from './player/camera';
import { createHud } from './ui';
import { Dialogue } from './story/dialogue';
import { createStory } from './story/interaction';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GradeShader, GLOW } from './render/grade';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const app = document.getElementById('app')!;

/** MSAA samples on the composer target. 4 = current look, 2 = cheaper, 0 = off. */
const MSAA_SAMPLES = 4;

const renderer = new THREE.WebGLRenderer({
  // The scene renders into a composer target, so framebuffer MSAA would do nothing but cost a
  // multisampled backbuffer. The real antialiasing moved onto the render target below.
  antialias: false,
  preserveDrawingBuffer: import.meta.env.DEV,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Tone mapping moved into the grade pass: three only tone maps when drawing to the default
// framebuffer, so leaving ACES set here would be an inert lie.
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const sky = createSky();
scene.add(sky.mesh);
// Sightline geometry: the ground horizon is ~33 units at R=150, but a 60-unit peak stays
// visible from ~130, so fog has to reach past the horizon to haze distant mountains.
const fog = new THREE.Fog(sky.horizonColor, 24, 90);
scene.fog = fog;

const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.1,
  800
);

// Two passes, the second writing straight to the screen. HDR target so the glow has headroom
// and the sky gradient does not band; its mip chain doubles as the glow's blur pyramid.
const rt = new THREE.WebGLRenderTarget(1, 1, {
  type: THREE.HalfFloatType,
  samples: MSAA_SAMPLES,
  minFilter: GLOW > 0 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
});
rt.texture.generateMipmaps = GLOW > 0;

const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const gradePass = new ShaderPass(GradeShader);
gradePass.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
// Last pass draws to the screen, so the ping-pong swap buys nothing and would just alternate
// between two mipmapped targets.
gradePass.needsSwap = false;
composer.addPass(gradePass);
composer.setSize(window.innerWidth, window.innerHeight);

const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x8a7a5f, 1.0);
scene.add(hemi);

// The day cycle owns the sun's direction from the first frame, so no start position is set.
const sun = new THREE.DirectionalLight(0xffe3bd, 2.0);
scene.add(sun);

// Anti-sun fill. A globe lit by one directional light always has half its surface facing away,
// so this is what stops "no night" meaning "half the planet is black". It is a HemisphereLight
// rather than a second directional one because hemisphere light is indirect in the toon shader
// and so escapes the shared 4-band gradient map; an antiparallel directional fill gets
// quantised into bands that do not line up with the sun's and rings the dark side.
// Added once and never removed: light counts are compiled into every material, so toggling one
// recompiles the whole scene. To disable it, set intensity to 0.
const fill = new THREE.HemisphereLight(0x6d86c8, 0x000000, 0.6);
scene.add(fill);

const skyMat = sky.mesh.material as THREE.ShaderMaterial;

const gradientMap = createToonGradient();

const planet = createPlanet(gradientMap);
scene.add(planet.group);

const water = createWater(gradientMap);
scene.add(water);

const waterRadius = PLANET_RADIUS + WATER_Y;
const start = findLandStart(PLANET_RADIUS, sampleHeight);

const spawnDir = start.clone().normalize();

// Drops the player onto whatever the terrain mesh actually is. Must run after terracing,
// which moves the ground out from under the analytic height used to pick the spot.
function snapToGround(): void {
  const probe = new THREE.Raycaster(
    spawnDir.clone().multiplyScalar(PLANET_RADIUS + 45),
    spawnDir.clone().negate()
  );
  probe.near = 0;
  probe.far = 68;
  probe.firstHitOnly = true;
  const hit = probe.intersectObject(planet.mesh, false);
  if (hit.length > 0) start.copy(hit[0].point);
}
snapToGround();

const input = new Input(renderer.domElement);

const hudEl = document.getElementById('hud')!;
hudEl.innerHTML =
  '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#f4f1ea;font-size:14px;letter-spacing:.08em;">Loading…</div>';

async function boot(): Promise<void> {
  const [wonders, player, boat] = await Promise.all([
    createWonders(gradientMap, spawnDir),
    Player.create(gradientMap, input),
    createBoat(gradientMap),
  ]);
  scene.add(boat);
  scene.add(wonders.group);
  carveTerraces(planet, wonders.terraces);
  snapToGround();

  // After terracing, so props sit on the ground as it finally is rather than where it was.
  scene.add(createProps(gradientMap, planet.mesh).group);

  const settlements = await createSettlements(
    gradientMap,
    planet.mesh,
    wonders.sites.map((s) => s.position.clone().normalize())
  );
  scene.add(settlements.group);

  const dialogue = new Dialogue();
  await dialogue.load('./story/corpus.json');
  const collidables = [planet.mesh, wonders.collisionMesh, settlements.collisionMesh];

  const controller = new Controller(start);
  player.setPosition(start);
  scene.add(player.group);

  const shadow = createBlobShadow();
  scene.add(shadow);

  const rig = new CameraRig(camera);
  const hud = createHud(wonders.sites);
  // After createHud: it assigns hud.innerHTML, which would wipe the story's own elements.
  const story = createStory(dialogue, settlements.speakers, settlements.landmarks);

  const up = new THREE.Vector3();
  const deck = new THREE.Vector3();
  const DECK_HEIGHT = 0.42;
  const MAX_PHYSICS_STEP = 0.02;
  let elapsed = 0;
  let lastTick = performance.now();

  function tick(now: number): void {
    requestAnimationFrame(tick);
    const dt = Math.min((now - lastTick) / 1000, 0.05);
    lastTick = now;
    windTime.value += dt;
    elapsed += dt;
    updateDaylight(elapsed, sun, fill, hemi, skyMat, fog);

    up.copy(controller.feet).normalize();
    rig.update(dt, controller.feet, up, input, collidables);
    // Substep the physics. Sprinting covers 9.4 * 0.05 = 0.47 units in one clamped frame,
    // which is enough to step straight through a hillside during a lag spike and end up
    // under the terrain. Measured: 0.05 tunnels on 22 of 40 sprints, 0.02 on none.
    let remaining = dt;
    while (remaining > 1e-6) {
      const step = Math.min(remaining, MAX_PHYSICS_STEP);
      controller.update(step, input, collidables, waterRadius, rig.moveForward);
      remaining -= step;
    }

    // Step into the boat on contact with water, and back out again on land.
    const afloat = controller.feet.length() <= waterRadius + 0.06;
    boat.visible = afloat;
    if (afloat) {
      // The controller clamps to a fixed water radius, so the boat has to be lifted onto the
      // displaced surface itself or it sits half-buried in every trough.
      const lift = waveHeight(controller.feet, windTime.value);
      boat.position.copy(controller.feet).addScaledVector(up, lift);
      boat.quaternion.copy(player.group.quaternion);
      player.setPosition(deck.copy(boat.position).addScaledVector(up, DECK_HEIGHT));
    } else {
      player.setPosition(controller.feet);
    }
    player.update(dt, controller, rig.moveForward);
    updateBlobShadow(shadow, controller.feet, controller.grounded, up);
    settlements.update(controller.feet, dt);
    story.update(dt, controller.feet, hud.wondersFound);
    if (input.justPressed('KeyE')) story.interact();

    hud.update(now, controller.feet, rig.moveForward);
    composer.render(dt);
    input.endFrame();
  }
  requestAnimationFrame(tick);

  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__game = {
      controller,
      player,
      renderer,
      scene,
      camera,
      rig,
      input,
      collidables,
      THREE,
    };
  }
}

boot();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});
