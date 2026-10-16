// Talk/examine cycling check. Presses E, over and over, at every place, every monument and every
// kind of person at several story stages, and fails if a press ever shows the line already on
// screen, if a round skips a line, or if a newly unlocked stage is not heard first.
//
//   npm run dev          # in one terminal
//   npm run dialogue     # in another
import { chromium } from 'playwright-core';

const URL = process.env.URL ?? 'http://localhost:5173/';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.goto(new globalThis.URL('src/style.css', URL).href);

const failures = await page.evaluate(async () => {
  const { Dialogue } = await import('/src/story/dialogue.ts');
  const corpus = await (await fetch('/story/corpus.json')).json();
  const stageOf = new Map([...corpus.lines, ...corpus.lore].map((l) => [l.text, l.stage]));
  const bad = [];

  /** Presses `press` round the pool `rounds` times and checks the loop is a proper loop. */
  function check(name, pool, press, rounds = 3) {
    const seq = [];
    for (let i = 0; i < pool * rounds; i++) seq.push(press());
    if (seq.some((t) => t === null)) return bad.push(`${name}: E said nothing`);
    for (let i = 1; i < seq.length; i++) {
      if (pool > 1 && seq[i] === seq[i - 1]) return bad.push(`${name}: press ${i + 1} repeated the line on screen`);
    }
    if (new Set(seq.slice(0, pool)).size !== pool) bad.push(`${name}: the first round skipped a line`);
  }

  const targets = [...new Set(corpus.lore.map((l) => l.target))].filter((t) => !t.startsWith('capture:'));
  for (const target of targets) {
    for (let stage = 0; stage <= 4; stage++) {
      const d = new Dialogue();
      await d.load('/story/corpus.json');
      const pool = corpus.lore.filter((l) => l.target === target && l.stage <= stage).length;
      check(`${target} @${stage}`, pool, () => d.pickLore(target, stage));
    }
  }

  for (const voice of ['child', 'teen', 'adult', 'elder']) {
    for (const band of ['waterline', 'shore', 'upland', 'mountain', 'cave']) {
      for (const stage of [0, 2, 4]) {
        const d = new Dialogue();
        await d.load('/story/corpus.json');
        const pool = corpus.lines.filter(
          (l) => l.kind === 'beat' && l.voice === voice && (l.band === 'any' || l.band === band) && l.stage <= stage
        ).length;
        check(`${voice}/${band} @${stage}`, pool, () => d.pick('npc', { voice, band }, 'beat', stage), 2);
      }
    }
  }

  // When the story deepens, the next thing anyone says comes from the new stage.
  {
    const d = new Dialogue();
    await d.load('/story/corpus.json');
    d.pickLore('wonder:Giza', 0);
    d.pick('npc', { voice: 'elder', band: 'shore' }, 'beat', 0);
    const lore = stageOf.get(d.pickLore('wonder:Giza', 3));
    const beat = stageOf.get(d.pick('npc', { voice: 'elder', band: 'shore' }, 'beat', 3));
    if (lore !== 3) bad.push(`deepest first: examining after stage 3 unlocked gave a stage ${lore} line`);
    if (beat !== 3) bad.push(`deepest first: talking after stage 3 unlocked gave a stage ${beat} line`);
  }

  return bad;
});

await browser.close();
for (const f of failures) console.error('FAIL', f);
if (failures.length) {
  console.error(`DIALOGUE FAIL (${failures.length})`);
  process.exit(1);
}
console.log('DIALOGUE PASS');
