/**
 * Opening screen. The world is fully built behind it, so BEGIN drops you straight in with no
 * second load: the orbit is the loading screen's reward, not a stand-in for one.
 */
export interface Title {
  /** Resolves when the player chooses to begin. */
  waitForStart(): Promise<void>;
  /** Fades the overlay out; call once play has started. */
  dismiss(): void;
  /** Blooms to white and resolves once the screen is fully covered. */
  whiteOut(ms: number): Promise<void>;
  /** Clears the white away over the given time. */
  whiteIn(ms: number): void;
}

export function createTitle(): Title {
  const el = document.createElement('div');
  el.id = 'title';
  el.innerHTML = `
    <div class="title-inner">
      <h1>wonders<span>of the world</span></h1>
      <p class="tagline">The sea has been rising for six generations.<br>Someone should see what is left.</p>
      <button class="begin" type="button">Begin</button>
      <p class="hint">WASD move &middot; Shift run &middot; E talk</p>
    </div>
  `;
  document.body.appendChild(el);

  const button = el.querySelector('.begin') as HTMLButtonElement;

  // The white sits above everything, including the title, so the cut from orbit to the ground
  // happens entirely behind it.
  const flash = document.createElement('div');
  flash.id = 'flash';
  document.body.appendChild(flash);

  return {
    waitForStart() {
      return new Promise<void>((resolve) => {
        let done = false;
        const go = (): void => {
          if (done) return;
          done = true;
          window.removeEventListener('keydown', onKey);
          resolve();
        };
        const onKey = (e: KeyboardEvent): void => {
          if (e.code === 'Enter' || e.code === 'Space') {
            e.preventDefault();
            go();
          }
        };
        button.addEventListener('click', go);
        window.addEventListener('keydown', onKey);
      });
    },
    dismiss() {
      el.classList.add('gone');
      // Left in the DOM for the length of the fade, then removed so it cannot swallow clicks.
      setTimeout(() => el.remove(), 900);
    },
    whiteOut(ms: number) {
      flash.style.transition = `opacity ${ms}ms ease-in`;
      // Next frame, so the browser has a computed starting opacity to animate away from.
      requestAnimationFrame(() => flash.classList.add('on'));
      return new Promise<void>((resolve) => setTimeout(resolve, ms + 30));
    },
    whiteIn(ms: number) {
      flash.style.transition = `opacity ${ms}ms ease-out`;
      flash.classList.remove('on');
      setTimeout(() => flash.remove(), ms + 200);
    },
  };
}
