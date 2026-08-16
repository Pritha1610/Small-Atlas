import * as THREE from 'three';
import { Dialogue, stageFor } from './dialogue';
import type { Speaker, Landmark } from '../world/settlements';

/** Close enough to read a name badge; the prompt appears inside this. */
const TALK_RANGE = 7;
/** Landmarks are big, so you can examine them from further out than you can talk to someone. */
const EXAMINE_RANGE = 13;
/** An overheard murmur needs you closer than the prompt, so passers-by feel incidental. */
const AMBIENT_RANGE = 10;
const AMBIENT_EVERY = 6.5;
/**
 * How long a line stays up, scaled to how long it takes to read.
 *
 * These were fixed at 4.5s and 9s, which fitted an ambient layer whose median line was eight
 * words. The rewrite doubled that - a bark now names its own referent instead of assuming it -
 * and a fixed hold cuts the back half off the longer ones. Roughly three words a second, plus a
 * beat to notice it has appeared, bounded so a short line does not linger and a long one does
 * not outstay its speaker.
 */
function holdFor(text: string, max: number): number {
  return Math.min(Math.max(text.split(/\s+/).length / 3 + 1.4, 3.2), max);
}
const AMBIENT_HOLD_MAX = 9;
const PANEL_HOLD_MAX = 15;

interface Target {
  kind: 'speaker' | 'landmark';
  label: string;
  speaker?: Speaker;
  landmark?: Landmark;
}

export interface Story {
  update(dt: number, feet: THREE.Vector3, wondersFound: number): void;
  /** Called on the E keypress; returns true if something was said. */
  interact(): boolean;
}

export function createStory(
  dialogue: Dialogue,
  speakers: Speaker[],
  landmarks: Landmark[],
  /** Murmurs the line in the speaker's register. Places have no voice and stay silent. */
  speak: (voice: string, text: string) => void = () => {}
): Story {
  const hud = document.getElementById('hud')!;

  const prompt = document.createElement('div');
  prompt.className = 'prompt';
  hud.appendChild(prompt);

  const panel = document.createElement('div');
  panel.className = 'dialogue';
  hud.appendChild(panel);

  const murmur = document.createElement('div');
  murmur.className = 'murmur';
  hud.appendChild(murmur);

  let target: Target | null = null;
  let stage = 0;
  const seenPlaces = new Set<string>();
  let panelTimer = 0;
  let murmurTimer = 0;
  let ambientCooldown = 2;

  function nearest(feet: THREE.Vector3): Target | null {
    let best: Target | null = null;
    let bestD = Infinity;
    for (const s of speakers) {
      const d = feet.distanceTo(s.position);
      if (d < TALK_RANGE && d < bestD) {
        bestD = d;
        best = { kind: 'speaker', label: `Talk to ${s.name}`, speaker: s };
      }
    }
    if (best) return best;
    for (const l of landmarks) {
      const d = feet.distanceTo(l.position);
      if (d < EXAMINE_RANGE && d < bestD) {
        bestD = d;
        best = { kind: 'landmark', label: 'Examine', landmark: l };
      }
    }
    return best;
  }

  function show(text: string, who: string | null): void {
    panel.innerHTML = who
      ? `<span class="who">${who}</span>${text}`
      : `<span class="place">${text}</span>`;
    panel.classList.add('on');
    panelTimer = holdFor(text, PANEL_HOLD_MAX);
  }

  return {
    update(dt, feet, wondersFound) {
      // Places count toward the story as you find them, so the world opens up by being walked.
      for (const l of landmarks) {
        if (feet.distanceTo(l.position) < EXAMINE_RANGE) seenPlaces.add(l.target + l.position.x.toFixed(0));
      }
      stage = stageFor(wondersFound, seenPlaces.size);

      target = nearest(feet);
      prompt.textContent = target ? `E  ${target.label}` : '';
      prompt.classList.toggle('on', target !== null);

      if (panelTimer > 0) {
        panelTimer -= dt;
        if (panelTimer <= 0) panel.classList.remove('on');
      }

      // Ambient murmurs: someone near you says something small, unprompted.
      if (murmurTimer > 0) {
        murmurTimer -= dt;
        if (murmurTimer <= 0) murmur.classList.remove('on');
      }
      ambientCooldown -= dt;
      if (ambientCooldown <= 0) {
        ambientCooldown = AMBIENT_EVERY;
        const near = speakers.filter((s) => feet.distanceTo(s.position) < AMBIENT_RANGE);
        if (near.length > 0 && panelTimer <= 0) {
          const who = near[Math.floor(Math.random() * near.length)];
          const text = dialogue.pick(who.id, who, 'ambient', stage);
          if (text) {
            murmur.textContent = text;
            murmur.classList.add('on');
            speak(who.voice, text);
            murmurTimer = holdFor(text, AMBIENT_HOLD_MAX);
          }
        }
      }
    },

    interact() {
      if (!target) return false;
      if (target.kind === 'speaker' && target.speaker) {
        const s = target.speaker;
        const text = dialogue.pick(s.id, s, 'beat', stage);
        if (!text) return false;
        show(text, s.name);
        speak(s.voice, text);
        return true;
      }
      if (target.landmark) {
        const text = dialogue.pickLore(target.landmark.target, stage);
        if (!text) return false;
        show(text, null);
        return true;
      }
      return false;
    },
  };
}
