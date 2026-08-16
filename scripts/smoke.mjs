import { chromium } from 'playwright-core';

const URL = process.env.URL ?? 'http://localhost:5173/';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--no-sandbox',
  ],
});

// Software rendering is fill-rate bound, and this scene got a lot heavier (1000+ objects,
// 46k grass instances, 1100+ skinned meshes). A smaller viewport is the cheapest way to buy
// back frames so the movement check actually gets to run.
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(String(err)));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => {
  const g = window.__game;
  return g && g.renderer && g.renderer.info;
}, null, { timeout: 20000 });

// The game now opens on a title screen and the player cannot move until it is dismissed.
// Begin, then wait out the white flash and the descent before testing anything.
await page.waitForSelector('#title .begin', { timeout: 20000 });
await page.click('#title .begin');
await page.waitForFunction(() => !document.querySelector('#flash'), null, { timeout: 20000 });
await page.waitForTimeout(3000);

const fps = await page.locator('.fps').textContent();

const pixels = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  const sample = (x, y) => {
    const px = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return Array.from(px);
  };
  // Sample a grid, not 3 points: spawn is randomized, so a single dark hillside or the
  // planet's night side used to false-fail the "did anything render" check.
  const grid = [];
  for (let gx = 1; gx <= 5; gx++) {
    for (let gy = 1; gy <= 5; gy++) {
      grid.push(sample(Math.round((w * gx) / 6), Math.round((h * gy) / 6)));
    }
  }
  return {
    center: sample(w >> 1, h >> 1),
    topLeft: sample(20, h - 20),
    bottomRight: sample(w - 20, 20),
    grid,
  };
});

const start = await page.evaluate(() => ({
  x: window.__game.controller.feet.x,
  y: window.__game.controller.feet.y,
  z: window.__game.controller.feet.z,
}));

// Held long enough to survive a software-rendered frame rate: post-processing drops
// SwiftShader to ~4fps, where 1.2s is only a handful of simulated frames.
//
// This tracks the FURTHEST the player gets from spawn rather than the net start-to-end
// distance, and tries other directions if the first is blocked. Spawn point and facing are
// both random, and roughly 3% of spawns face a cliff or a steep slope the controller
// correctly refuses to climb - measuring one direction's endpoint failed on those even
// though movement was working perfectly.
const readPos = () =>
  page.evaluate(() => ({
    x: window.__game.controller.feet.x,
    y: window.__game.controller.feet.y,
    z: window.__game.controller.feet.z,
  }));

let moved = 0;
async function walk(key, ms) {
  await page.keyboard.down(key);
  for (let waited = 0; waited < ms; waited += 250) {
    await page.waitForTimeout(250);
    const c = await readPos();
    moved = Math.max(moved, Math.hypot(c.x - start.x, c.y - start.y, c.z - start.z));
  }
  await page.keyboard.up(key);
}

await walk('KeyW', 3000);
if (moved < 0.5) await walk('KeyS', 2000);
if (moved < 0.5) await walk('KeyD', 2000);

const end = await readPos();
await page.screenshot({ path: '/tmp/wonders-smoke.png' });

const litSamples = pixels.grid.filter((px) => px.slice(0, 3).some((v) => v > 8)).length;
const nonBlack = litSamples >= 3;

console.log(
  JSON.stringify({ fps, litSamples, start, end, moved, consoleErrors }, null, 2)
);

await browser.close();

if (consoleErrors.length) {
  console.error('SMOKE FAIL: console errors present');
  process.exit(1);
}
if (!nonBlack) {
  console.error('SMOKE FAIL: all sampled pixels are black');
  process.exit(1);
}
if (moved < 0.5) {
  console.error('SMOKE FAIL: player did not move (moved=' + moved + ')');
  process.exit(1);
}
console.log('SMOKE PASS');
