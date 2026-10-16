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
import type { Footprint } from './world/dressing';
import { loadModel, asset } from './world/assets';
import { windTime, pushFrom } from './render/wind';
import { updateDaylight } from './render/daylight';
import { createWonders } from './world/wonders';
import { createSettlements } from './world/settlements';
import { createSpecials } from './world/special';
import { createCaves } from './world/caves';
import { createNotes } from './world/notes';
import { createBoat } from './world/boat';
import { createSky } from './render/sky';
import { createToonGradient } from './render/toon';
import { createBlobShadow, updateBlobShadow } from './render/blobShadow';
import { Input } from './player/input';
import { Controller } from './player/controller';
import { Player, CHARACTERS, type CharacterId } from './player/player';
import { CameraRig, fitFov } from './player/camera';
import { createTouch } from './touch';
import { createPhysics } from './physics/world';
import { createRagdoll } from './player/ragdoll';
import { createHud } from './ui';
import { createTitle } from './title';
import { Dialogue } from './story/dialogue';
import { createStory } from './story/interaction';
import { createPhotos } from './photo';
import { createAudio } from './audio';
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
// Phones get a lower cap. At 2x a six-inch screen is already past what the eye resolves, and
// fill rate - this is an HDR, multisampled, mipmapped target - is what a phone GPU runs out of
// first. 1.5 is about 44% fewer pixels than 2 for no visible loss at arm's length.
const COARSE = matchMedia('(pointer: coarse)').matches;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, COARSE ? 1.5 : 2));
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

/**
 * Far plane. The title frames the whole planet from 205 units out and needs the big one; play
 * only ever sees as far as the fog, which is fully opaque at 90. Keeping the orbit far plane in
 * play was costing a fortune: tilt the camera down and its frustum runs through the planet and
 * out the other side, so the far half of the world - every settlement, every flora chunk - got
 * submitted behind terrain that completely hides it. Measured at a downward tilt: 1,359 draws
 * and 741k triangles, against 208 and 248k level.
 */
const FAR_TITLE = 800;
const FAR_PLAY = 96;

/** Play field of view. The viewfinder narrows it and puts it back on lowering the camera. */
const PLAY_FOV = 55;

const camera = new THREE.PerspectiveCamera(
  PLAY_FOV,
  window.innerWidth / window.innerHeight,
  0.1,
  FAR_TITLE
);

/** The FOV asked for (play or viewfinder), before it is fitted to the screen's shape. */
let baseFov = PLAY_FOV;
function applyFov(fov = baseFov): void {
  baseFov = fov;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.fov = fitFov(baseFov, camera.aspect);
  camera.updateProjectionMatrix();
}
applyFov();

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
const audio = createAudio();

const hudEl = document.getElementById('hud')!;
hudEl.innerHTML = '<div class="loading"><span>Loading the world</span><i><b></b></i></div>';
// ~38MB of models on a phone connection is a long wait to sit through with no sign of life.
// GLTFLoader reports through the default manager, so this needs no wiring into the loaders.
const loadBar = hudEl.querySelector('.loading b') as HTMLElement;
let loadShown = 0;
THREE.DefaultLoadingManager.onProgress = (_url, loaded, total) => {
  // Monotonic: each later stage queues more files, which would otherwise pull the bar backwards.
  loadShown = Math.max(loadShown, loaded / total);
  loadBar.style.width = `${Math.round(loadShown * 100)}%`;
};

/** The body you chose last time, so a swap is not undone by every page load. */
const CHAR_KEY = 'wonders.character';
function savedCharacter(): CharacterId {
  try {
    const v = localStorage.getItem(CHAR_KEY);
    if (v && v in CHARACTERS) return v as CharacterId;
  } catch {
    /* storage blocked: fall back to the default */
  }
  return 'woman';
}

async function boot(): Promise<void> {
  // Started first and awaited last: the physics engine is its own download, and fetching it
  // alongside the models costs nothing, where fetching it after them adds to every load.
  const physicsReady = createPhysics(waterRadius);
  const [wonders, boat] = await Promise.all([
    createWonders(gradientMap, spawnDir),
    createBoat(gradientMap),
    // Both bodies are fetched and parsed up front so choosing one at the title costs nothing.
    // The loader caches by path, so building the chosen Player afterwards is instant and Begin
    // never stalls on a download - which is the whole point of loading behind the title.
    ...Object.values(CHARACTERS).map((c) => loadModel(c.path)),
  ]);
  const player = await Player.create(gradientMap, savedCharacter());
  scene.add(boat);
  scene.add(wonders.group);
  carveTerraces(planet, wonders.terraces);
  snapToGround();

  // The one list of ground already built on. Each pass below checks it and adds to it, so
  // nothing is ever seated inside something placed earlier. The spawn point is held clear so
  // you never wake up inside somebody's house.
  const monuments: Footprint[] = wonders.sites.map((s) => ({ position: s.position, radius: s.radius }));
  const claimed: Footprint[] = [{ position: start.clone(), radius: 2.5 }, ...monuments];

  const settlements = await createSettlements(gradientMap, planet.mesh, claimed);
  scene.add(settlements.group);

  // Three rare figures at the extremes of the world, outside any settlement.
  const specials = await createSpecials(gradientMap, planet.mesh, spawnDir, claimed);
  scene.add(specials.group);

  // Caves before flora and after everything else: they need to know what is already standing
  // so a secret never opens onto somebody's back garden.
  const caves = await createCaves(
    gradientMap,
    spawnDir,
    [...settlements.landmarks.map((l) => l.position), ...wonders.sites.map((s) => s.position)],
    claimed
  );
  scene.add(caves.group);

  // The developer's notes, in corners the procedural world happens to offer this time.
  const notes = createNotes(gradientMap, {
    planetMesh: planet.mesh,
    spawnDir,
    wonders: wonders.sites,
    caveSites: caves.sites,
    caveMouths: caves.mouths,
    landmarks: settlements.landmarks,
    claimed,
  });
  scene.add(notes.group);

  // Flora goes in LAST, so it can be thinned around everything already standing: bare ground
  // where people live, and an open approach to each monument. Also after terracing, so plants
  // sit on the ground as it finally is rather than where it was.
  const clearings: Clearing[] = [
    ...settlements.landmarks.map((l) => ({ position: l.position, radius: 15, floor: 0.04 })),
    // Monuments keep an open approach, but never bare earth: measured, a floor of 0.3 only
    // thinned the ground cover by 16%, which does not read at all. 0.12 leaves roughly a third
    // of the grass and a scattering of trees, so the ground still looks alive.
    ...wonders.sites.map((s) => ({ position: s.position, radius: 24, floor: 0.12 })),
    // Nothing grows through a rock chamber, but the ring just outside stays green.
    ...caves.sites.map((p) => ({ position: p, radius: 15, floor: 0, core: 8 })),
    // A small clear patch round every note and keepsake, so the grass does not swallow them.
    ...notes.notes.map((n) => ({ position: n.position, radius: 4, floor: 0.15, core: 1.5 })),
  ];
  const flora = await createProps(gradientMap, planet.mesh, clearings, {
    footprints: settlements.footprints,
    monuments,
    monumentMesh: wonders.collisionMesh,
  });
  scene.add(flora.group);

  const dialogue = new Dialogue();
  await dialogue.load(asset('story/corpus.json'));
  const collidables = [planet.mesh, wonders.collisionMesh, settlements.collisionMesh, caves.collisionMesh, flora.collisionMesh];

  // Rigid bodies: the same solid world as the controller sees, plus clutter that can be knocked
  // about, plus - when she falls far enough - her own body.
  const physics = await physicsReady;
  for (const mesh of collidables) physics.addStatic(mesh);
  physics.addLoose(settlements.loose);
  const ragdoll = createRagdoll(physics);

  /**
   * 1 standing among people, 0 alone in open country. This is what chooses between the piano
   * bed and the empty one, and it reuses the speaker positions the story layer already holds
   * rather than inventing a second notion of where a settlement is.
   */
  const allSpeakers = [...settlements.speakers, ...specials.speakers];
  function settledness(feet: THREE.Vector3): number {
    let nearest = Infinity;
    for (const sp of allSpeakers) {
      const d = feet.distanceToSquared(sp.position);
      if (d < nearest) nearest = d;
    }
    // Full piano within 18 units of somebody, fully open country past 52.
    const t = THREE.MathUtils.clamp((Math.sqrt(nearest) - 18) / 34, 0, 1);
    return 1 - t;
  }

  /** 1 at the centre of a cave chamber, 0 once you are outside it. Drives the audio muffle. */
  function caveEnclosure(feet: THREE.Vector3): number {
    let best = 0;
    for (const c of caves.sites) {
      const d = feet.distanceTo(c);
      if (d < 8) best = Math.max(best, 1 - d / 8);
    }
    return best;
  }

  const controller = new Controller(start);
  player.setPosition(start);
  scene.add(player.group);

  const shadow = createBlobShadow();
  scene.add(shadow);

  const rig = new CameraRig(camera);
  const hud = createHud(wonders.sites);
  // After createHud: it assigns hud.innerHTML, which would wipe the story's own elements.
  const story = createStory({
    dialogue,
    speakers: allSpeakers,
    landmarks: [...settlements.landmarks, ...caves.landmarks],
    wonders: wonders.sites,
    notes: notes.notes,
    camera,
    visited: hud.visited,
    speak: (voice, text) => audio.speak(voice, text),
  });

  const photos = await createPhotos({
    camera,
    renderer,
    collidables,
    wonderSites: wonders.sites,
    wonderMesh: wonders.collisionMesh,
    landmarks: [...settlements.landmarks, ...caves.landmarks],
    caveSites: caves.sites,
    dialogue,
    playFov: PLAY_FOV,
    setFov: applyFov,
    stage: () => Math.min(4, hud.wondersFound),
    feet: () => controller.feet,
  });
  // Last, so its buttons sit over everything the HUD, story and camera have already built.
  createTouch(input);

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
  /** How close you can stand to somebody before you are walking through them. */
  const BODY_RADIUS = 0.5;
  const bodies = allSpeakers.map((s) => s.position);
  /** Grass within this of the feet parts around them. */
  const GRASS_PUSH = 1.1;
  /**
   * Falling faster than this, she goes limp instead of landing - about a four-unit drop, a
   * roof or a terrace edge. A full jump on flat ground lands at roughly 10.5, well under it.
   */
  const RAGDOLL_FALL = 17;
  /** While she is down, the camera and everything else follows the ground under her waist. */
  const lying = new THREE.Vector3();
  const getUpRay = new THREE.Raycaster();
  getUpRay.firstHitOnly = true;

  function standUp(): void {
    const { pelvis, facing } = ragdoll.finish();
    const u = pelvis.clone().normalize();
    // Feet on whatever is under where she came to rest: the ground, a roof, or the sea.
    getUpRay.set(pelvis.clone().addScaledVector(u, 1.5), u.clone().negate());
    getUpRay.near = 0;
    getUpRay.far = 5;
    const hit = getUpRay.intersectObjects(collidables, false)[0];
    const feet = hit ? hit.point.clone() : pelvis.clone().addScaledVector(u, -0.3);
    if (feet.length() < waterRadius) feet.setLength(waterRadius);
    controller.placeAt(feet);
    player.standUp(feet, facing);
  }

  // The boat rides the swell: pitched and rolled to the slope of the wave under it, so the hull
  // rocks with the sea you can see instead of sliding across it flat. Half-length and half-beam
  // are where the slope is sampled - roughly the hull's own size.
  const BOAT_HALF_LENGTH = 0.9;
  const BOAT_HALF_BEAM = 0.55;
  const bow = new THREE.Vector3();
  const beam = new THREE.Vector3();
  const probe = new THREE.Vector3();
  const rock = new THREE.Quaternion();
  const rockTarget = new THREE.Quaternion();
  const rockEuler = new THREE.Euler();
  function rockOnWaves(dt: number, facing: THREE.Quaternion): void {
    const t = windTime.value;
    const wave = (axis: THREE.Vector3, d: number): number =>
      waveHeight(probe.copy(controller.feet).addScaledVector(axis, d), t);
    // Bodies face +Z, so that is the bow and +X the beam.
    bow.set(0, 0, 1).applyQuaternion(facing);
    beam.set(1, 0, 0).applyQuaternion(facing);
    const pitch = Math.atan2(wave(bow, BOAT_HALF_LENGTH) - wave(bow, -BOAT_HALF_LENGTH), 2 * BOAT_HALF_LENGTH);
    const roll = Math.atan2(wave(beam, BOAT_HALF_BEAM) - wave(beam, -BOAT_HALF_BEAM), 2 * BOAT_HALF_BEAM);
    // A positive X turn dips +Z, so the bow rises on a higher wave ahead by negating it.
    rockTarget.setFromEuler(rockEuler.set(-pitch, 0, roll));
    rock.slerp(rockTarget, 1 - Math.exp(-5 * dt));
  }
  let elapsed = 0;
  let lastTick = performance.now();

  const title = createTitle();
  hudEl.classList.add('pre-game');
  void title.waitForStart().then(async () => {
    // Bloom to white FIRST, so the jump from orbit to the ground happens unseen. Without it the
    // camera teleports 200 units in one frame, which reads as a glitch rather than a cut.
    // Inside the click handler on purpose: an AudioContext created anywhere else starts
    // suspended and never recovers without another gesture.
    audio.unlock();
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
    // The sky dome rides the camera; without this it would clip through the near plane on one
    // side and outside the far plane on the other.
    sky.mesh.position.copy(camera.position);
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
      rig.update(dt, controller.feet, up, input, collidables, controller.flatVel);
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
    specials.update(controller.feet, dt);
      hud.update(now, controller.feet, rig.moveForward);
      composer.render(dt);
      input.endFrame();
      if (t >= 1) {
        mode = 'playing';
        // Only now, once the descent has landed: the intro starts 46 units up and needs the
        // long view all the way down.
        camera.far = FAR_PLAY;
        camera.updateProjectionMatrix();
      }
      return;
    }

    if (input.justPressed('KeyM')) audio.toggleMute();
    if (input.justPressed('KeyG')) photos.toggleGallery();
    // The album is a full-screen overlay, so the world holds still behind it rather than the
    // player wandering off a cliff while looking at photographs of a different world.
    if (photos.galleryOpen) {
      // No composer.render: the album is a full-screen opaque overlay, so every one of those
      // frames was drawing half a million triangles into a buffer nobody can see, while the
      // browser was also compositing an image-heavy DOM layer over the top. Measured, closing
      // the album stalled to 16-28fps for about three seconds afterwards.
      photos.update(dt);
      input.endFrame();
      return;
    }
    if (input.justPressed('KeyF')) photos.toggleAim();
    // The pointer only steers the view while the camera is up.
    rig.freeLook = photos.aiming;
    if (input.justPressed('Tab') && photos.aiming) photos.cycleFilm();
    if (input.justPressed('Enter') && photos.aiming) photos.shoot();
    if (input.justPressed('KeyR')) hud.flash(input.running ? 'running' : 'walking');
    if (input.justPressed('KeyC') && !ragdoll.active) {
      const next: CharacterId = player.character === 'woman' ? 'man' : 'woman';
      void player.setCharacter(next);
      try {
        localStorage.setItem(CHAR_KEY, next);
      } catch {
        /* the swap still happens, it just will not be remembered */
      }
    }

    up.copy(controller.feet).normalize();
    if (!ragdoll.active) {
      rig.update(dt, controller.feet, up, input, collidables, controller.flatVel);
      // Substep the physics. Sprinting covers 9.4 * 0.05 = 0.47 units in one clamped frame,
      // which is enough to step straight through a hillside during a lag spike and end up
      // under the terrain. Measured: 0.05 tunnels on 22 of 40 sprints, 0.02 on none.
      let remaining = dt;
      while (remaining > 1e-6) {
        const step = Math.min(remaining, MAX_PHYSICS_STEP);
        controller.update(step, input, collidables, waterRadius, rig.moveForward);
        remaining -= step;
      }
      controller.depenetrate(collidables);
      controller.pushOutOf(bodies, BODY_RADIUS);
      // A long fall ends in a heap, not a landing. Not over the sea: water catches you.
      if (controller.fallSpeed > RAGDOLL_FALL && controller.feet.length() > waterRadius + 1.5) {
        player.limp = true;
        ragdoll.start(player.body, player.facingQuaternion, controller.vel);
        if (!ragdoll.active) player.limp = false; // a body it does not recognise stays animated
      }
    }
    physics.step(dt, controller.feet, !ragdoll.active);
    if (ragdoll.active) {
      if (ragdoll.update(dt)) standUp();
    }
    // While she is down, everything that follows her follows the ground under her waist.
    const down = ragdoll.active;
    if (down) {
      up.copy(ragdoll.focus).normalize();
      lying.copy(ragdoll.focus).addScaledVector(up, -0.9);
      rig.update(dt, lying, up, input, collidables);
    }
    const feet = down ? lying : controller.feet;
    pushFrom.value.set(feet.x, feet.y, feet.z, GRASS_PUSH);

    // Step into the boat on contact with water, and back out again on land.
    const afloat = !down && controller.feet.length() <= waterRadius + 0.06;
    boat.visible = afloat;
    if (afloat) {
      // The controller clamps to a fixed water radius, so the boat has to be lifted onto the
      // displaced surface itself or it sits half-buried in every trough.
      const lift = waveHeight(controller.feet, windTime.value);
      boat.position.copy(controller.feet).addScaledVector(up, lift);
      player.setPosition(deck.copy(boat.position).addScaledVector(up, DECK_HEIGHT));
    } else if (!down) {
      // (While she is down the ragdoll has the skeleton, and the root stays where she fell from.)
      player.setPosition(controller.feet);
      rock.identity();
    }
    player.update(dt, controller, rig.moveForward);
    if (afloat) {
      // After player.update, which rebuilds her quaternion from pure facing every frame - so the
      // rock is applied exactly once, to the hull and to her standing in it.
      rockOnWaves(dt, player.group.quaternion);
      boat.quaternion.copy(player.group.quaternion).multiply(rock);
      player.group.quaternion.copy(boat.quaternion);
    }
    updateBlobShadow(shadow, feet, down || controller.grounded, up);
    settlements.update(feet, dt);
    specials.update(feet, dt);
    story.update(dt, feet, rig.moveForward, afloat, hud.wondersFound);
    if (input.justPressed('KeyE') && !down) story.interact();

    // Fed the same wave function the water shader uses, so the surf you hear is the swell you
    // can see moving under you.
    audio.update(dt, {
      altitude: feet.length() - waterRadius,
      swell: waveHeight(feet, windTime.value),
      afloat,
      speed: controller.flatSpeed,
      enclosed: caveEnclosure(feet),
      settled: settledness(feet),
    });
    photos.update(dt);
    notes.update(elapsed, story.isRead);
    hud.update(now, feet, rig.moveForward, story.lead, story.keepsakes);
    composer.render(dt);
    // Directly after the draw and inside the same task: preserveDrawingBuffer is off in a
    // production build, so this is the only moment the canvas can still be read.
    photos.afterRender();
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
      caveSites: caves.sites,
      notes: notes.notes,
      story,
      dialogue,
      physics,
      ragdoll,
      loose: settlements.loose,
      audio,
      speakers: [...settlements.speakers, ...specials.speakers],
    };
  }
}

boot();

window.addEventListener('resize', () => {
  applyFov();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});
