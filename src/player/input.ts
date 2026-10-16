export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  yawDelta = 0;
  pitchDelta = 0;
  /**
   * Analog move from the touch stick, -1..1 on each axis (y is forward). Zero on desktop; the
   * keyboard is read separately so a held key and a stick never fight over this.
   */
  stickX = 0;
  stickY = 0;
  /** Run toggle: R on a keyboard, the run button on a phone. Shift still runs while held. */
  running = false;
  private lastX = 0;
  private lastY = 0;
  /**
   * The ONE pointer steering the view. Tracking any pointer meant that on a phone, holding the
   * move stick with one thumb while dragging to aim with the other fed both thumbs' motion into
   * the same deltas, so walking swung the camera.
   */
  private dragId: number | null = null;

  constructor(el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      if (e.code === 'KeyR' && !e.repeat) this.toggleRun();
      this.keys.add(e.code);
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    el.addEventListener('pointerdown', (e) => {
      if (this.dragId !== null) return;
      this.dragId = e.pointerId;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.dragId) return;
      this.yawDelta += (e.clientX - this.lastX) * 0.004;
      // Dragging DOWN raises the camera to look up, the way every mouse-look does it.
      this.pitchDelta += (e.clientY - this.lastY) * 0.004;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    const release = (e: PointerEvent): void => {
      if (e.pointerId === this.dragId) this.dragId = null;
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.stickX = this.stickY = 0;
    });
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** Flips the run toggle, and presses R so the game can say so whichever way it was flipped. */
  toggleRun(): void {
    this.running = !this.running;
    this.pressed.add('KeyR');
    for (const f of this.onRun) f(this.running);
  }
  /** Told whenever the run toggle flips, so a button can show its state. */
  onRun: Array<(on: boolean) => void> = [];

  /** A one-frame press from an on-screen button, read exactly like a key going down. */
  tap(code: string): void {
    this.pressed.add(code);
  }

  /** An on-screen button held down, for the keys whose hold matters (a long jump). */
  press(code: string): void {
    if (!this.keys.has(code)) this.pressed.add(code);
    this.keys.add(code);
  }

  release(code: string): void {
    this.keys.delete(code);
  }

  /** Reads a press and consumes it, so code that runs several times a frame sees it once. */
  take(code: string): boolean {
    return this.pressed.delete(code);
  }

  justPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  endFrame(): void {
    this.pressed.clear();
  }
}
