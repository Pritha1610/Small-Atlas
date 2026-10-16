import * as THREE from 'three';
import type { WonderSite } from './world/wonders';

/** How close you have to get before a wonder is marked as visited on the map. */
const VISIT_RADIUS = 10;
const MAP_SIZE = 148;
/**
 * Distance walked before the key list folds itself away into a small "H controls" chip. By then
 * the keys are learned, and a permanent strip of them is just something between you and the
 * view. Distance rather than time, so leaving the tab on the title does not count.
 */
const HELP_FOLD_AFTER = 80;

/** Something special on the map that is not a monument. */
export interface MapMark {
  position: THREE.Vector3;
  found: boolean;
}

export interface Hud {
  /** `lead` is the monument someone has pointed you to; it gets a ring on the map. */
  update(now: number, feet: THREE.Vector3, forward: THREE.Vector3, lead?: WonderSite | null, marks?: ReadonlyArray<MapMark>): void;
  /** Drives how far the story has unlocked. */
  readonly wondersFound: number;
  /** Per site, in the same order as the sites passed in. */
  readonly visited: readonly boolean[];
  /** A word or two at the top of the screen for a moment - "running", "walking". */
  flash(text: string): void;
}

export function createHud(sites: WonderSite[]): Hud {
  const hud = document.getElementById('hud')!;
  hud.innerHTML = `
    <div class="title">wonders <span>of the world</span></div>
    <div class="controls keys-only">
      <span class="full">
        <span><kbd>WASD</kbd> move</span><span><kbd>Shift</kbd> run</span><span><kbd>R</kbd> run toggle</span><span><kbd>Space</kbd> jump</span>
        <span><kbd>E</kbd> talk</span><span><kbd>F</kbd> camera</span><span><kbd>G</kbd> album</span>
        <span><kbd>C</kbd> swap</span><span><kbd>M</kbd> sound</span><span><kbd>H</kbd> hide</span>
      </span>
      <span class="chip"><kbd>H</kbd> controls</span>
    </div>
    <div class="fps keys-only">-- fps</div>
    <div class="flash-word"></div>
    <div class="map">
      <canvas width="${MAP_SIZE}" height="${MAP_SIZE}"></canvas>
      <div class="found">0 / ${sites.length} found</div>
    </div>
  `;
  const fpsEl = hud.querySelector('.fps') as HTMLElement;
  const foundEl = hud.querySelector('.found') as HTMLElement;
  const canvas = hud.querySelector('.map canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const controlsEl = hud.querySelector('.controls') as HTMLElement;
  const flashEl = hud.querySelector('.flash-word') as HTMLElement;
  let flashTimer = 0;

  let travelled = 0;
  let folded = false;
  const lastFeet = new THREE.Vector3();
  const setFolded = (on: boolean): void => {
    folded = on;
    controlsEl.classList.toggle('folded', on);
  };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyH' && !e.repeat) setFolded(!folded);
  });

  const visited = sites.map(() => false);
  const up = new THREE.Vector3();
  const right = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const tangent = new THREE.Vector3();

  let frames = 0;
  let last = performance.now();

  const c = MAP_SIZE / 2;
  const radius = c - 8;

  const at = { x: 0, y: 0 };
  /**
   * Azimuthal projection: angular distance from the player maps straight to map radius, so the
   * far side of the planet sits on the rim and the whole world is always on screen.
   */
  function toMap(p: THREE.Vector3): typeof at | null {
    tangent.copy(p).normalize();
    const angle = Math.acos(THREE.MathUtils.clamp(tangent.dot(up), -1, 1));
    tangent.addScaledVector(up, -tangent.dot(up));
    if (tangent.lengthSq() < 1e-9) return null;
    tangent.normalize();
    const r = (angle / Math.PI) * radius;
    at.x = c + tangent.dot(right) * r;
    at.y = c - tangent.dot(fwd) * r;
    return at;
  }

  function draw(now: number, feet: THREE.Vector3, forward: THREE.Vector3, lead: WonderSite | null, marks: ReadonlyArray<MapMark>): void {
    up.copy(feet).normalize();
    // Rebuilt every frame: on a sphere there is no fixed north, so the map is player-centred
    // and rotates to whichever way you are facing.
    fwd.copy(forward).addScaledVector(up, -forward.dot(up));
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1);
    fwd.normalize();
    right.crossVectors(fwd, up).normalize();

    ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
    ctx.beginPath();
    ctx.arc(c, c, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10, 14, 24, 0.5)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();

    for (let i = 0; i < sites.length; i++) {
      const p = toMap(sites[i].position);
      if (!p) continue;
      const { x, y } = p;

      if (sites[i] === lead) {
        // Pulsing, so the one place you were sent reads at a glance among the other six.
        const pulse = 0.5 + 0.5 * Math.sin(now / 260);
        ctx.beginPath();
        ctx.arc(x, y, 6 + pulse * 3, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(244, 162, 97, ${0.45 + pulse * 0.5})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x, y, visited[i] ? 4 : 3, 0, Math.PI * 2);
      if (visited[i]) {
        ctx.fillStyle = '#f4a261';
        ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(244, 241, 234, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // The keepsakes: a rose "?" each, bright and breathing until read, then dimmed and still.
    // The map says only that they are something, and not what - the reading is the point.
    const breath = 0.55 + 0.45 * Math.sin(now / 520);
    ctx.font = 'bold 12px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const m of marks) {
      const p = toMap(m.position);
      if (!p) continue;
      // A dark edge so it reads over the pale rim of the map and over a monument's dot.
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(10, 14, 24, 0.85)';
      ctx.strokeText('?', p.x, p.y);
      ctx.fillStyle = m.found ? 'rgba(214, 112, 132, 0.45)' : `rgba(240, 136, 158, ${0.6 + breath * 0.4})`;
      ctx.fillText('?', p.x, p.y);
    }

    // The player sits at the centre pointing up, since the map rotates rather than the marker.
    ctx.beginPath();
    ctx.moveTo(c, c - 6);
    ctx.lineTo(c - 4.5, c + 5);
    ctx.lineTo(c + 4.5, c + 5);
    ctx.closePath();
    ctx.fillStyle = '#f4f1ea';
    ctx.fill();
  }

  let found = 0;

  return {
    get wondersFound() {
      return found;
    },
    visited,
    flash(text: string) {
      flashEl.textContent = text;
      flashEl.classList.add('on');
      window.clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => flashEl.classList.remove('on'), 1400);
    },
    update(now: number, feet: THREE.Vector3, forward: THREE.Vector3, lead: WonderSite | null = null, marks: ReadonlyArray<MapMark> = []) {
      frames++;
      if (travelled < HELP_FOLD_AFTER) {
        // Capped per frame so the descent's spawn snap cannot count as walking.
        if (lastFeet.lengthSq() > 0) travelled += Math.min(feet.distanceTo(lastFeet), 1);
        lastFeet.copy(feet);
        if (travelled >= HELP_FOLD_AFTER) setFolded(true);
      }
      // A gap this long means the loop was not drawing at all - the album was open, or the tab
      // was backgrounded. Counting those frames against wall-clock time reports a stall that
      // never happened: closing the album read 18fps purely because `last` was still sitting
      // where it was four seconds earlier. Restart the window instead of publishing a lie.
      if (now - last > 1500) {
        frames = 0;
        last = now;
        return;
      }
      if (now - last >= 500) {
        fpsEl.textContent = `${Math.round((frames * 1000) / (now - last))} fps`;
        frames = 0;
        last = now;

        // Twice a second is plenty for a 16-unit proximity test.
        let count = 0;
        for (let i = 0; i < sites.length; i++) {
          if (!visited[i] && feet.distanceTo(sites[i].position) < VISIT_RADIUS) visited[i] = true;
          if (visited[i]) count++;
        }
        found = count;
        foundEl.textContent = `${count} / ${sites.length} found`;
      }
      draw(now, feet, forward, lead, marks);
    },
  };
}
