export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  yawDelta = 0;
  private lastX = 0;
  private dragging = false;

  constructor(el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    el.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yawDelta += (e.clientX - this.lastX) * 0.004;
      this.lastX = e.clientX;
    });
    window.addEventListener('pointerup', () => (this.dragging = false));
    window.addEventListener('pointercancel', () => (this.dragging = false));
    window.addEventListener('blur', () => this.keys.clear());
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  jumpPressed(): boolean {
    return this.pressed.has('Space');
  }

  endFrame(): void {
    this.pressed.clear();
  }
}
