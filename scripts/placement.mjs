// Placement audit. Boots a few fresh worlds (each page load is a new planet) and checks that
// nothing was seated inside anything else and that nothing floats off a slope.
//
//   npm run dev          # in one terminal
//   npm run placement    # in another (RUNS=5 for more worlds)
//
// Reads the `userData.kind` tags settlements.ts puts on what it places. Thresholds match the
// placement code's own footprint fraction (0.8 of a model's half-extent), so a failure here
// means a rule was actually broken, not that two eaves touch.
import { chromium } from 'playwright-core';

const URL = process.env.URL ?? 'http://localhost:5173/';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const RUNS = Number(process.env.RUNS ?? 3);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
});

let failed = false;
for (let run = 0; run < RUNS; run++) {
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL);
  await page.waitForFunction(() => window.__game, null, { timeout: 180000 });

  const r = await page.evaluate(() => {
    const g = window.__game;
    const T = g.THREE;
    const FP = 0.8;
    const objs = [];
    g.scene.traverse((o) => o.userData?.kind && objs.push(o));
    for (const o of objs) {
      const c = o.clone();
      c.position.set(0, 0, 0);
      c.quaternion.identity();
      c.updateMatrixWorld(true);
      const s = new T.Box3().setFromObject(c).getSize(new T.Vector3());
      o.userData.r = (Math.max(s.x, s.z) / 2) * FP;
    }
    const of = (k) => objs.filter((o) => o.userData.kind === k);
    const B = of('building');
    const d = (a, b) => a.position.distanceTo(b.position);
    const overlapsBuilding = (o) => B.some((b) => b !== o && d(o, b) < b.userData.r + o.userData.r - 0.05);

    let buildingOverlaps = 0;
    for (let i = 0; i < B.length; i++)
      for (let j = i + 1; j < B.length; j++)
        if (d(B[i], B[j]) < B[i].userData.r + B[j].userData.r - 0.05) buildingOverlaps++;

    // Floating: a dry model's base above the lowest ground under its footprint ring.
    const planet = g.collidables[0];
    const ray = new T.Raycaster();
    ray.firstHitOnly = true;
    const ground = (dir) => {
      ray.set(dir.clone().multiplyScalar(140), dir.clone().negate());
      ray.far = 140;
      const h = ray.intersectObject(planet, false);
      return h.length ? h[0].point.length() : Infinity;
    };
    let floating = 0;
    for (const b of [...B, ...of('vertical')]) {
      const R = b.position.length();
      if (R < 75 + 1.05 + 0.2) continue;
      const up = b.position.clone().normalize();
      const ref = Math.abs(up.y) < 0.9 ? new T.Vector3(0, 1, 0) : new T.Vector3(1, 0, 0);
      const t1 = ref.sub(up.clone().multiplyScalar(up.dot(ref))).normalize();
      const t2 = up.clone().cross(t1);
      const rr = (b.userData.r / FP) * 0.85;
      let lo = Infinity;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        lo = Math.min(lo, ground(b.position.clone().addScaledVector(t1, Math.cos(a) * rr).addScaledVector(t2, Math.sin(a) * rr).normalize()));
      }
      if (R - lo > 0.3) floating++;
    }

    let treesInBuilding = 0;
    const m = new T.Matrix4();
    const p = new T.Vector3();
    g.scene.traverse((o) => {
      if (!o.isInstancedMesh || o.material.side === T.DoubleSide) return; // grass is DoubleSide
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m);
        p.setFromMatrixPosition(m);
        if (B.some((b) => b.position.distanceTo(p) < b.userData.r)) treesInBuilding++;
      }
    });

    return {
      buildings: B.length,
      speakers: g.speakers.length,
      buildingOverlaps,
      clutterInBuilding: of('clutter').filter(overlapsBuilding).length,
      connectorInBuilding: of('connector').filter(overlapsBuilding).length,
      verticalInBuilding: of('vertical').filter(overlapsBuilding).length,
      buildingInMonument: B.filter((b) => g.wonderSites.some((w) => d(b, w) < w.radius)).length,
      treesInBuilding,
      floating,
    };
  });

  const hard = ['buildingOverlaps', 'clutterInBuilding', 'connectorInBuilding', 'verticalInBuilding', 'buildingInMonument', 'treesInBuilding'];
  const bad = hard.filter((k) => r[k] > 0);
  // A ring of six probes cannot see every dip, so a stray model a hair over is not a regression.
  if (r.floating > 2) bad.push('floating');
  if (errors.length) bad.push('errors');
  // No tagged buildings means the tags went missing, not that placement is perfect.
  if (r.buildings === 0) bad.push('no tagged buildings');
  console.log(JSON.stringify({ world: run + 1, ...r, errors: errors.length }), bad.length ? `FAIL: ${bad.join(', ')}` : 'ok');
  failed ||= bad.length > 0;
  await page.close();
}
await browser.close();

if (failed) {
  console.error('PLACEMENT FAIL');
  process.exit(1);
}
console.log('PLACEMENT PASS');
