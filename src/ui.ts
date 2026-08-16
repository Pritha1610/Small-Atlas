import * as THREE from 'three';
import type { WonderSite } from './world/wonders';

/** How close you have to get before a wonder is marked as visited on the map. */
const VISIT_RADIUS = 10;
const MAP_SIZE = 148;

export interface Hud {
  update(now: number, feet: THREE.Vector3, forward: THREE.Vector3): void;
  /** Drives how far the story has unlocked. */
  readonly wondersFound: number;
}

export function createHud(sites: WonderSite[]): Hud {
  const hud = document.getElementById('hud')!;
  hud.innerHTML = `
    <div class="title">wonders <span>of the world</span></div>
    <div class="controls">
      <b>WASD</b> move &nbsp;&middot;&nbsp; <b>Shift</b> run &nbsp;&middot;&nbsp;
      <b>Space</b> jump &nbsp;&middot;&nbsp; <b>E</b> talk &nbsp;&middot;&nbsp; <b>C</b> swap &middot; <b>F</b> camera &middot; <b>G</b> album &middot; <b>M</b> sound
    </div>
    <div class="fps">-- fps</div>
    <div class="map">
      <canvas width="${MAP_SIZE}" height="${MAP_SIZE}"></canvas>
      <div class="found">0 / ${sites.length} found</div>
    </div>
  `;
  const fpsEl = hud.querySelector('.fps') as HTMLElement;
  const foundEl = hud.querySelector('.found') as HTMLElement;
  const canvas = hud.querySelector('.map canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;

  const visited = sites.map(() => false);
  const up = new THREE.Vector3();
  const right = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const tangent = new THREE.Vector3();

  let frames = 0;
  let last = performance.now();

  const c = MAP_SIZE / 2;
  const radius = c - 8;

  function draw(feet: THREE.Vector3, forward: THREE.Vector3): void {
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

    // Azimuthal projection: angular distance from the player maps straight to map radius, so
    // the far side of the planet sits on the rim and the whole world is always on screen.
    for (let i = 0; i < sites.length; i++) {
      tangent.copy(sites[i].position).normalize();
      const angle = Math.acos(THREE.MathUtils.clamp(tangent.dot(up), -1, 1));
      tangent.addScaledVector(up, -tangent.dot(up));
      if (tangent.lengthSq() < 1e-9) continue;
      tangent.normalize();
      const r = (angle / Math.PI) * radius;
      const x = c + tangent.dot(right) * r;
      const y = c - tangent.dot(fwd) * r;

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
    update(now: number, feet: THREE.Vector3, forward: THREE.Vector3) {
      frames++;
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
      draw(feet, forward);
    },
  };
}
