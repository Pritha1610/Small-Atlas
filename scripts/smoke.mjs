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

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

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
// SwiftShader to ~4fps, where 1.2s is only a handful of simulated frames. Also nudges left
// first, so a spawn facing a cliff does not read as "did not move".
await page.keyboard.down('KeyA');
await page.waitForTimeout(600);
await page.keyboard.up('KeyA');
await page.keyboard.down('KeyW');
await page.waitForTimeout(3000);
await page.keyboard.up('KeyW');

const end = await page.evaluate(() => ({
  x: window.__game.controller.feet.x,
  y: window.__game.controller.feet.y,
  z: window.__game.controller.feet.z,
}));

await page.screenshot({ path: '/tmp/wonders-smoke.png' });

const moved = Math.hypot(
  end.x - start.x,
  end.y - start.y,
  end.z - start.z
);

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
