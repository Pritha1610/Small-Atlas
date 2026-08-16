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
import { createProps, type Clearing } from './world/props';
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
import { createTitle } from './title';
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

  const settlements = await createSettlements(
    gradientMap,
    planet.mesh,
    wonders.sites.map((s) => s.position.clone().normalize())
  );
  scene.add(settlements.group);

  // Flora goes in LAST, so it can be thinned around everything already standing: bare ground
  // where people live, and an open approach to each monument. Also after terracing, so plants
  // sit on the ground as it finally is rather than where it was.
  const clearings: Clearing[] = [
    ...settlements.landmarks.map((l) => ({ position: l.position, radius: 15, floor: 0.04 })),
    // Monuments keep an open approach, but never bare earth: measured, a floor of 0.3 only
    // thinned the ground cover by 16%, which does not read at all. 0.12 leaves roughly a third
    // of the grass and a scattering of trees, so the ground still looks alive.
    ...wonders.sites.map((s) => ({ position: s.position, radius: 24, floor: 0.12 })),
  ];
  scene.add((await createProps(gradientMap, planet.mesh, clearings)).group);

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

  // Framing the whole planet. The bulk of the globe sits around radius 85 even though rare peaks
  // reach ~108, so framing to the peaks leaves the world looking small in frame. 205 fills about
  // four fifths of the height with the land mass and still keeps the tallest summits on screen.
  const TITLE_DIST = 205;
  const TITLE_SPIN = 0.05;
  // Fog is 24-90 for play, which would swallow the planet whole from out here. These are pushed
  // beyond the far edge of the globe instead of setting scene.fog to null, because fog presence
  // is a shader #define and toggling it would recompile every material mid-frame.
  const PLAY_FOG_NEAR = fog.near;
  const PLAY_FOG_FAR = fog.far;
  fog.near = 420;
  fog.far = 900;

  let mode: 'title' | 'intro' | 'playing' = 'title';
  let spin = 0;
  /** Seconds the descent from the sky onto the character takes. */
  const INTRO_TIME = 2.8;
  // Wall-clock, NOT accumulated dt. dt is clamped to 0.05 per frame, so on a machine running at
  // 1fps an "2.8 second" intro built from dt would really take 56 seconds and strand the player
  // in a cutscene. Timestamps make the intro take 2.8 seconds at any frame rate.
  let introStartedAt = 0;
  const introStart = new THREE.Vector3();
  const introUp = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();

  const up = new THREE.Vector3();
  const deck = new THREE.Vector3();
  const DECK_HEIGHT = 0.42;
  const MAX_PHYSICS_STEP = 0.02;
  let elapsed = 0;
  let lastTick = performance.now();

  const title = createTitle();
  hudEl.classList.add('pre-game');
  void title.waitForStart().then(async () => {
    // Bloom to white FIRST, so the jump from orbit to the ground happens unseen. Without it the
    // camera teleports 200 units in one frame, which reads as a glitch rather than a cut.
    await title.whiteOut(560);
    title.dismiss();

    fog.near = PLAY_FOG_NEAR;
    fog.far = PLAY_FOG_FAR;
    // Start the descent high above the player and let it settle onto the normal camera framing.
    introUp.copy(controller.feet).normalize();
    introStart.copy(controller.feet).addScaledVector(introUp, 46);
    introStartedAt = performance.now();
    mode = 'intro';

    // Clear the white while the descent is already moving, so the world arrives in motion.
    title.whiteIn(1150);
    hudEl.classList.remove('pre-game');
  });

  function tick(now: number): void {
    requestAnimationFrame(tick);
    const dt = Math.min((now - lastTick) / 1000, 0.05);
    lastTick = now;
    windTime.value += dt;
    elapsed += dt;
    updateDaylight(elapsed, sun, fill, hemi, skyMat, fog);

    if (mode === 'title') {
      // Slow orbit tilted off the equator so the planet reads as a globe rather than a disc.
      spin += dt * TITLE_SPIN;
      camera.position.set(
        Math.sin(spin) * TITLE_DIST * 0.94,
        TITLE_DIST * 0.34,
        Math.cos(spin) * TITLE_DIST * 0.94
      );
      camera.up.set(0, 1, 0);
      camera.lookAt(0, 0, 0);
      hud.update(now, controller.feet, rig.moveForward);
      composer.render(dt);
      input.endFrame();
      return;
    }

    if (mode === 'intro') {
      up.copy(controller.feet).normalize();
      // Run the rig anyway so it converges on the real gameplay framing; the camera is then
      // blended toward wherever it decided to be, which means no second jump at the handover.
      rig.update(dt, controller.feet, up, input, collidables);
      const t = THREE.MathUtils.clamp((now - introStartedAt) / 1000 / INTRO_TIME, 0, 1);
      // Ease-out: fast at first, drifting to a near-stop as it settles behind the character.
      const k = 1 - Math.pow(1 - t, 3);
      camera.position.lerpVectors(introStart, camera.position, k);
      camera.up.copy(introUp).lerp(up, k).normalize();
      camera.lookAt(lookTarget.copy(controller.feet).addScaledVector(up, 1.3));

      player.setPosition(controller.feet);
      player.update(dt, controller, rig.moveForward);
      updateBlobShadow(shadow, controller.feet, controller.grounded, up);
      settlements.update(controller.feet, dt);
      hud.update(now, controller.feet, rig.moveForward);
      composer.render(dt);
      input.endFrame();
      if (t >= 1) mode = 'playing';
      return;
    }

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
      landmarks: settlements.landmarks,
      wonderSites: wonders.sites,
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
