// Movement physics check. Drives the real Controller against small, known pieces of geometry -
// a wall at an angle, two steps, a slope too steep to stand on, a ramp, a ledge, open water -
// and checks each rule does what it says.
//
//   npm run dev          # in one terminal
//   npm run physics      # in another
//
// It runs in the browser only because that is where Vite turns the TypeScript into something
// importable; nothing about the game itself is loaded.
import { chromium } from 'playwright-core';

const URL = process.env.URL ?? 'http://localhost:5173/';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
// Any file on the dev server will do as an origin; the stylesheet is cheap and boots nothing.
await page.goto(new globalThis.URL('src/style.css', URL).href);

const results = await page.evaluate(async () => {
  const THREE = await import('/node_modules/.vite/deps/three.js').catch(() => import('three'));
  const { Controller } = await import('/src/player/controller.ts');

  // The planet's up is "away from the centre", so all of this is built on a flat patch at the
  // north pole of a world of radius R, where up is very nearly +Y.
  const R = 75;
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const solid = (geo, x, y, z, ry = 0, rx = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, R + y, z);
    m.rotation.set(rx, ry, 0);
    m.updateMatrixWorld(true);
    return m;
  };
  const floor = () => {
    const g = new THREE.PlaneGeometry(80, 80);
    g.rotateX(-Math.PI / 2);
    return solid(g, 0, 0, 0);
  };

  function input() {
    return {
      keys: new Set(),
      pressed: new Set(),
      stickX: 0,
      stickY: 0,
      running: false,
      isDown(c) { return this.keys.has(c); },
      take(c) { return this.pressed.delete(c); },
      jumpPressed() { return this.pressed.has('Space'); },
      down(c) { this.keys.add(c); this.pressed.add(c); },
      up(c) { this.keys.delete(c); },
    };
  }

  const FWD = new THREE.Vector3(0, 0, -1);
  function sim(c, inp, world, seconds, waterR = R - 20, each) {
    const dt = 0.02;
    for (let t = 0; t < seconds; t += dt) {
      c.update(dt, inp, world, waterR, FWD);
      // A press lasts one frame in the game (Input.endFrame), and must here too, or anything
      // that only reads presses "works" by seeing the same one forever.
      inp.pressed.clear();
      each?.(t);
    }
  }
  const start = (x, y, z) => new Controller(new THREE.Vector3(x, R + y, z));
  const out = {};

  // Slide along a wall hit at 35 degrees, instead of sticking to it.
  {
    const wall = solid(new THREE.BoxGeometry(40, 3, 0.6), 0, 1.5, -3, 0.6);
    const c = start(0, 0.1, 0);
    const inp = input();
    inp.down('KeyW');
    sim(c, inp, [floor(), wall], 2.5);
    // Signed distance in front of the wall's face, so "did not go through it" holds wherever
    // along the angled wall the slide ended up.
    const front = c.feet.x * Math.sin(0.6) + (c.feet.z + 3) * Math.cos(0.6) - 0.3;
    out.slide = { lateral: +Math.abs(c.feet.x).toFixed(2), inFront: +front.toFixed(2) };
    out.slide.pass = out.slide.lateral > 2 && front > 0;
  }

  // A 0.4 step is walked up; a 1.0 block is not.
  for (const [name, h] of [['stepLow', 0.4], ['stepHigh', 1.0]]) {
    const box = solid(new THREE.BoxGeometry(6, h, 4), 0, h / 2, -4);
    const c = start(0, 0.1, 0);
    const inp = input();
    inp.down('KeyW');
    sim(c, inp, [floor(), box], 2);
    const rise = c.feet.length() - R;
    out[name] = { rise: +rise.toFixed(2), z: +c.feet.z.toFixed(2) };
    out[name].pass = name === 'stepLow' ? rise > 0.35 && c.feet.z < -2.5 : rise < 0.3 && c.feet.z > -2.3;
  }

  // Standing on a 72-degree face, you slide down it.
  {
    const g = new THREE.PlaneGeometry(30, 30);
    g.rotateX(-Math.PI / 2);
    const cliff = solid(g, 0, 0, 0, 0, (72 * Math.PI) / 180);
    const c = start(0, 0.3, 0);
    // Seat on the face first, then let go.
    sim(c, input(), [cliff], 0.1);
    const before = c.feet.clone();
    sim(c, input(), [cliff], 1);
    out.steepSlide = { moved: +c.feet.distanceTo(before).toFixed(2) };
    out.steepSlide.pass = out.steepSlide.moved > 1;
  }

  // A 30-degree ramp is walked up more slowly than flat ground.
  {
    const flatC = start(0, 0.1, 0);
    const inpA = input();
    inpA.down('KeyW');
    sim(flatC, inpA, [floor()], 1.5);
    const g = new THREE.PlaneGeometry(10, 40);
    g.rotateX(-Math.PI / 2);
    const ramp = solid(g, 0, 0, 0, 0, (30 * Math.PI) / 180);
    const rampC = start(0, 0.2, 0);
    sim(rampC, input(), [ramp], 0.1);
    const s0 = rampC.feet.clone();
    const inpB = input();
    inpB.down('KeyW');
    sim(rampC, inpB, [ramp], 1.4);
    out.uphill = { flat: +Math.abs(flatC.feet.z).toFixed(2), ramp: +rampC.feet.distanceTo(s0).toFixed(2) };
    out.uphill.pass = out.uphill.ramp < out.uphill.flat * 0.92 && out.uphill.ramp > out.uphill.flat * 0.5;
  }

  // Holding jump goes higher than tapping it.
  {
    const peak = (holdSteps) => {
      const c = start(0, 0.1, 0);
      const inp = input();
      sim(c, inp, [floor()], 0.2);
      inp.down('Space');
      let best = 0;
      let step = 0;
      sim(c, inp, [floor()], 1, R - 20, () => {
        if (++step === holdSteps) inp.up('Space');
        best = Math.max(best, c.feet.length() - R);
      });
      return best;
    };
    const held = peak(40);
    const tapped = peak(3);
    out.jumpHeight = { held: +held.toFixed(2), tapped: +tapped.toFixed(2) };
    out.jumpHeight.pass = held > 1.2 && tapped < held * 0.8 && tapped > 0.3;
  }

  // Coyote time: jump pressed just after running off a ledge still jumps.
  {
    const ledge = solid(new THREE.BoxGeometry(6, 2, 6), 0, 1, 0);
    const c = start(0, 2.1, 1.5);
    const inp = input();
    inp.down('KeyW');
    let leftAt = -1;
    let jumped = false;
    sim(c, inp, [floor(), ledge], 2, R - 20, (t) => {
      if (leftAt < 0 && !c.grounded) leftAt = t;
      if (leftAt >= 0 && t - leftAt > 0.06 && t - leftAt < 0.08) inp.down('Space');
      if (leftAt >= 0 && c.vel.dot(c.feet.clone().normalize()) > 5) jumped = true;
    });
    out.coyote = { pass: jumped };
  }

  // Jump buffer: pressed just before landing, it fires on landing.
  {
    const c = start(0, 1.2, 0);
    const inp = input();
    let pressed = false;
    let jumped = false;
    sim(c, inp, [floor()], 1, R - 20, () => {
      const h = c.feet.length() - R;
      if (!pressed && h < 0.35 && !c.grounded) {
        inp.down('Space');
        pressed = true;
      }
      if (pressed && c.vel.dot(c.feet.clone().normalize()) > 5) jumped = true;
    });
    out.buffer = { pass: jumped };
  }

  // Afloat, the boat glides on after you let go; on land you stop.
  {
    const glide = (waterR, y) => {
      const c = start(0, y, 0);
      const inp = input();
      inp.down('KeyW');
      sim(c, inp, [floor()], 3, waterR);
      inp.up('KeyW');
      sim(c, inp, [floor()], 0.8, waterR);
      return c.flatSpeed;
    };
    const boat = glide(R + 5, 5);
    const land = glide(R - 20, 0.1);
    out.boatGlide = { boat: +boat.toFixed(2), land: +land.toFixed(2) };
    out.boatGlide.pass = boat > 1.5 && land < 0.05;
  }

  // The stick walks however far it is pushed; running is the toggle's job.
  {
    const speed = (running) => {
      const c = start(0, 0.1, 0);
      const inp = input();
      inp.stickY = 1;
      inp.running = running;
      sim(c, inp, [floor()], 2);
      return c.flatSpeed;
    };
    const pushed = speed(false);
    const toggled = speed(true);
    out.stickWalks = { pushed: +pushed.toFixed(2), toggled: +toggled.toFixed(2) };
    out.stickWalks.pass = pushed < 4 && toggled > 6;
  }

  // The body has width: walking past a thin pole that only the shoulder would touch, you go
  // round it instead of through it.
  {
    const pole = solid(new THREE.CylinderGeometry(0.08, 0.08, 3, 8), 0.18, 1.5, -3);
    const c = start(0, 0.1, 0);
    const inp = input();
    inp.down('KeyW');
    let closest = Infinity;
    sim(c, inp, [floor(), pole], 2, R - 20, () => {
      c.depenetrate?.([floor(), pole]);
      closest = Math.min(closest, Math.hypot(c.feet.x - 0.18, c.feet.z + 3));
    });
    out.bodyWidth = { closest: +closest.toFixed(2), pass: closest > 0.08 + 0.22 };
  }

  // Standing half inside a wall, you are pushed back out of it.
  {
    const wall = solid(new THREE.BoxGeometry(6, 3, 0.4), 0, 1.5, -0.2);
    const c = start(0, 0.1, 0.2);
    sim(c, input(), [floor(), wall], 0.5, R - 20, () => c.depenetrate?.([floor(), wall]));
    const gap = c.feet.z - 0;
    out.depenetrate = { gap: +gap.toFixed(2), pass: gap > 0.22 };
  }

  // People are solid.
  {
    const c = start(0, 0.1, 0);
    const npc = new THREE.Vector3(0, R, -2);
    const inp = input();
    inp.down('KeyW');
    let closest = Infinity;
    sim(c, inp, [floor()], 1.5, R - 20, () => {
      c.pushOutOf?.([npc], 0.5);
      const d = Math.hypot(c.feet.x - npc.x, c.feet.z - npc.z);
      closest = Math.min(closest, d);
    });
    out.bodies = { closest: +closest.toFixed(2), pass: closest > 0.45 };
  }

  // --- rigid bodies --------------------------------------------------------------------
  const { createPhysics } = await import('/src/physics/world.ts');
  const { createRagdoll } = await import('/src/player/ragdoll.ts');
  const { loadModel } = await import('/src/world/assets.ts');
  const ground = () => new THREE.Mesh(new THREE.IcosahedronGeometry(R, 24));

  // Walk the player's capsule into a loose box: it is shoved along, and stays on the ground.
  {
    const physics = await createPhysics(R - 20);
    physics.addStatic(ground());
    const box = new THREE.Object3D();
    box.position.set(0, R, -1.5);
    physics.addLoose([{ object: box, centre: new THREE.Vector3(0, 0.3, 0), half: new THREE.Vector3(0.3, 0.3, 0.3), density: 300 }]);
    const feet = new THREE.Vector3(0, R, 1);
    for (let i = 0; i < 120; i++) {
      feet.z -= 3 / 60;
      physics.step(1 / 60, feet, true);
    }
    for (let i = 0; i < 120; i++) physics.step(1 / 60, feet, true);
    const shoved = Math.hypot(box.position.x, box.position.z + 1.5);
    const sunk = R - box.position.length();
    out.push = { shoved: +shoved.toFixed(2), sunk: +sunk.toFixed(2), pass: shoved > 0.5 && sunk < 0.05 };
  }

  // Drop the real character from height: she lands in a heap, nothing goes through the ground,
  // she comes to rest, and knees and elbows only ever bend the way they bend.
  {
    const physics = await createPhysics(R - 20);
    // Flat, so "below the ground" means exactly that; a faceted sphere's flats sit under R.
    physics.addStatic(floor());
    const ragdoll = createRagdoll(physics);
    const { root } = await loadModel('/models/Woman.glb');
    const holder = new THREE.Group();
    holder.add(root);
    root.scale.setScalar(1.65 / 1.8);
    holder.position.set(0, R + 4, 0);
    holder.updateMatrixWorld(true);
    const bone = (n) => { let b; root.traverse((o) => { if (o.isBone && o.name === n) b = b ?? o; }); return b; };
    const worldQ = (n) => bone(n).getWorldQuaternion(new THREE.Quaternion());
    const start = Object.fromEntries(['UpperLegL', 'UpperLegR', 'UpperArmL', 'UpperArmR'].map((n) => [n, worldQ(n)]));
    ragdoll.start(root, new THREE.Quaternion(), new THREE.Vector3(1.5, 0, 0));
    let lowest = Infinity;
    let rested = false;
    let t = 0;
    for (; t < 10 && !rested; t += 1 / 60) {
      physics.step(1 / 60, new THREE.Vector3(0, -1000, 0), false);
      rested = ragdoll.update(1 / 60);
      physics.world.forEachRigidBody((b) => {
        if (b.isDynamic()) lowest = Math.min(lowest, b.translation().y - R);
      });
    }
    // Bend about each upper segment's own hinge axis: its left (+X at the start), carried by
    // however far that segment has turned since.
    const bend = (upper, joint, end) => {
      const left = new THREE.Vector3(1, 0, 0).applyQuaternion(worldQ(upper).multiply(start[upper].clone().invert()));
      const p = (n) => bone(n).getWorldPosition(new THREE.Vector3());
      const u = p(joint).sub(p(upper));
      const v = p(end).sub(p(joint));
      return Math.atan2(u.clone().cross(v).dot(left), u.dot(v));
    };
    const knees = [bend('UpperLegL', 'LowerLegL', 'FootL'), bend('UpperLegR', 'LowerLegR', 'FootR')];
    const elbows = [bend('UpperArmL', 'LowerArmL', 'WristL'), bend('UpperArmR', 'LowerArmR', 'WristR')];
    out.ragdoll = {
      settledIn: +t.toFixed(2),
      lowestPart: +lowest.toFixed(3),
      knees: knees.map((k) => +k.toFixed(2)),
      elbows: elbows.map((e) => +e.toFixed(2)),
    };
    out.ragdoll.pass =
      // A body's centre never below the surface: nothing went THROUGH the ground. (A limb can
      // dip a couple of centimetres into it for a frame on a hard impact, as Rapier resolves
      // penetration over a few steps; that is not visible and not what this guards.)
      rested && lowest > 0 && knees.every((k) => k > -0.2 && k < 2.6) && elbows.every((e) => e < 0.2 && e > -2.7);
  }

  return out;
});

await browser.close();
let failed = false;
for (const [name, r] of Object.entries(results)) {
  const { pass, ...rest } = r;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name.padEnd(11)} ${JSON.stringify(rest)}`);
  failed ||= !pass;
}
if (failed) {
  console.error('PHYSICS FAIL');
  process.exit(1);
}
console.log('PHYSICS PASS');
