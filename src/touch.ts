import type { Input } from './player/input';

/**
 * On-screen controls for phones and tablets.
 *
 * Every button injects the key the keyboard would have pressed, so the game loop keeps exactly
 * one input path and nothing in here knows what a key does. Walking is a floating stick: it
 * appears under the thumb wherever it lands on the left of the screen, because a fixed one is
 * always a few millimetres from where a thumb actually rests. Pushed to the rim it runs, so
 * there is no sprint button to hold down with a second finger.
 *
 * Talking needs no button of its own: the "Talk to ..." prompt is the button.
 */
const ICON = {
  jump: '<path d="M6 15l6-6 6 6"/>',
  shoot: '<circle cx="12" cy="12" r="7" fill="currentColor"/>',
  camera: '<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
  film: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
  album: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  swap: '<path d="M6 8h12l-3.5-3.5M18 16H6l3.5 3.5"/>',
  sound: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  run: '<path d="M5 6l6 6-6 6M12 6l6 6-6 6"/>',
};

const BUTTONS: Array<{ code: string; label: string; icon: keyof typeof ICON; cls: string }> = [
  { code: 'KeyR', label: 'Run (toggle)', icon: 'run', cls: 'run' },
  { code: 'Space', label: 'Jump', icon: 'jump', cls: 'big play-only' },
  { code: 'Enter', label: 'Take photo', icon: 'shoot', cls: 'big aim-only' },
  { code: 'KeyF', label: 'Camera', icon: 'camera', cls: '' },
  { code: 'Tab', label: 'Change film', icon: 'film', cls: 'aim-only' },
  { code: 'KeyG', label: 'Album', icon: 'album', cls: 'play-only' },
  { code: 'KeyC', label: 'Swap character', icon: 'swap', cls: 'play-only' },
  { code: 'KeyM', label: 'Sound on or off', icon: 'sound', cls: '' },
];

/** How far the knob travels from the centre of the stick, in CSS pixels. */
const STICK_R = 48;

function button(b: (typeof BUTTONS)[number]): string {
  return (
    `<button type="button" class="${b.cls}" data-code="${b.code}" aria-label="${b.label}">` +
    `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[b.icon]}</svg></button>`
  );
}

export function createTouch(input: Input): void {
  const hud = document.getElementById('hud')!;
  const root = document.createElement('div');
  root.className = 'touch';
  root.innerHTML = `
    <div class="stick-zone"><div class="stick"><i></i></div></div>
    <div class="buttons">${BUTTONS.filter((b) => /big|run/.test(b.cls)).map(button).join('')}
      <div class="small">${BUTTONS.filter((b) => !/big|run/.test(b.cls)).map(button).join('')}</div>
    </div>`;
  hud.appendChild(root);
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  // Shown for a coarse pointer, and also on the first real touch, so a touchscreen laptop gets
  // them the moment it is touched rather than never.
  const enable = (): void => document.body.classList.add('touch-ui');
  if (matchMedia('(pointer: coarse)').matches) enable();
  window.addEventListener('pointerdown', (e) => e.pointerType === 'touch' && enable(), { passive: true });

  root.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    const code = b.dataset.code!;
    // A toggle, not a hold: holding a sprint button with a second thumb while steering with
    // the first is the thing phone players most want to stop doing.
    if (code === 'KeyR') {
      b.setAttribute('aria-pressed', String(input.running));
      input.onRun.push((on) => {
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        input.toggleRun();
      });
      return;
    }
    // Jump is HELD, like the key: how long you hold it decides how high you go.
    if (code === 'Space') {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        input.press(code);
      });
      for (const ev of ['pointerup', 'pointercancel']) b.addEventListener(ev, () => input.release(code));
      return;
    }
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      input.tap(code);
    });
  });
  // The prompt is the talk button, and the open line is the "next" button.
  for (const sel of ['.prompt', '.dialogue']) {
    hud.querySelector(sel)?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      input.tap('KeyE');
    });
  }

  const zone = root.querySelector('.stick-zone') as HTMLElement;
  const stick = root.querySelector('.stick') as HTMLElement;
  const knob = stick.querySelector('i') as HTMLElement;
  let id: number | null = null;
  let cx = 0;
  let cy = 0;

  const move = (e: PointerEvent): void => {
    if (e.pointerId !== id) return;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const len = Math.hypot(dx, dy);
    if (len > STICK_R) {
      dx *= STICK_R / len;
      dy *= STICK_R / len;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    input.stickX = dx / STICK_R;
    // Screen y grows downward; the stick's forward is up.
    input.stickY = -dy / STICK_R;
  };
  const end = (e: PointerEvent): void => {
    if (e.pointerId !== id) return;
    id = null;
    input.stickX = input.stickY = 0;
    knob.style.transform = '';
    // Back to its resting spot, so the next thumb knows where to go.
    stick.removeAttribute('style');
    stick.classList.remove('on');
  };

  zone.addEventListener('pointerdown', (e) => {
    if (id !== null) return;
    e.preventDefault();
    id = e.pointerId;
    zone.setPointerCapture(id);
    const box = zone.getBoundingClientRect();
    // Kept wholly inside the zone, so a thumb landing at the very edge still has room to push.
    cx = Math.min(Math.max(e.clientX, box.left + STICK_R), box.right - STICK_R);
    cy = Math.min(Math.max(e.clientY, box.top + STICK_R), box.bottom - STICK_R);
    stick.style.left = `${cx - box.left - STICK_R}px`;
    stick.style.top = `${cy - box.top - STICK_R}px`;
    stick.style.bottom = 'auto';
    stick.classList.add('on');
    move(e);
  });
  zone.addEventListener('pointermove', move);
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
  // An app switch mid-walk does not always deliver the pointerup, which left the stick latched
  // on and the next thumb ignored.
  window.addEventListener('blur', () => id !== null && end({ pointerId: id } as PointerEvent));
}
