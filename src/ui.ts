export interface Hud {
  update(now: number): void;
}

export function createHud(): Hud {
  const hud = document.getElementById('hud')!;
  hud.innerHTML = `
    <div class="title">wonders <span>of the world</span></div>
    <div class="controls">
      <b>WASD</b> move &nbsp;&middot;&nbsp; <b>Shift</b> run &nbsp;&middot;&nbsp;
      <b>Space</b> jump &nbsp;&middot;&nbsp; <b>drag</b> look
    </div>
    <div class="fps">-- fps</div>
  `;
  const fpsEl = hud.querySelector('.fps') as HTMLElement;

  let frames = 0;
  let last = performance.now();

  return {
    update(now: number) {
      frames++;
      if (now - last >= 500) {
        fpsEl.textContent = `${Math.round((frames * 1000) / (now - last))} fps`;
        frames = 0;
        last = now;
      }
    },
  };
}
