import * as THREE from 'three';
import { Dialogue, stageFor } from './dialogue';
import { CHAPTERS, chapterHeading, leadLine, objective } from './chapters';
import { NOTE_SIGNATURE } from './notes';
import { KEEPSAKE_TITLE } from './keepsakes';
import type { Speaker, Landmark } from '../world/settlements';
import type { WonderSite } from '../world/wonders';
import type { PlacedNote } from '../world/notes';

/** Close enough to read a name badge; the prompt appears inside this. */
const TALK_RANGE = 6;
/** Landmarks are big, so you can examine them from further out than you can talk to someone. */
const EXAMINE_RANGE = 13;
/** A monument is examinable from this far outside its own footprint. */
const WONDER_REACH = 7;
/** Notes are small; you have to actually walk up to one. */
const NOTE_RANGE = 3;
/** A keepsake is offered from a little further, since it is what the map sent you to find. */
const KEEPSAKE_RANGE = 4.5;
/** An overheard murmur needs you closer than the prompt, so passers-by feel incidental. */
const AMBIENT_RANGE = 10;
const AMBIENT_EVERY = 6.5;
/**
 * Walk this much further away than the range a line was opened at and it closes. A line used to
 * hang on screen for its whole timer wherever you went, so Meera was still talking while you
 * stood at a monument on the far side of the world.
 */
const LEAVE_SLACK = 4;
/** How long a chapter card stays up, in seconds. */
const CARD_HOLD = 7;
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

/** What "Examine" means at each kind of place, so the prompt says what you are looking at. */
const PLACE_LABEL: Record<string, string> = {
  'place:drowned': 'Examine the drowned houses',
  'place:waterline': 'Examine the stilt houses',
  'place:shore': 'Examine the shore houses',
  'place:upland': 'Examine the hill settlement',
  'place:mountain': 'Examine the mountain camp',
  'place:cave': 'Examine the cave',
  'place:sea': 'Look down into the water',
};

interface Target {
  kind: 'speaker' | 'place' | 'note';
  label: string;
  at: THREE.Vector3;
  range: number;
  speaker?: Speaker;
  /** Corpus lore key, for places and monuments. */
  lore?: string;
  note?: PlacedNote;
  /** Where the floating marker goes, if this is a person or a thing rather than an area. */
  mark?: number;
}

export interface StoryDeps {
  dialogue: Dialogue;
  speakers: Speaker[];
  landmarks: Landmark[];
  wonders: WonderSite[];
  notes: PlacedNote[];
  camera: THREE.Camera;
  /** Which monuments have been reached; owned by the HUD, read here. */
  visited: readonly boolean[];
  /** Murmurs the line in the speaker's register. Places have no voice and stay silent. */
  speak?: (voice: string, text: string) => void;
}

export interface Story {
  update(dt: number, feet: THREE.Vector3, forward: THREE.Vector3, afloat: boolean, wondersFound: number): void;
  /** Called on the E keypress; returns true if something was said. */
  interact(): boolean;
  /** The monument someone last pointed you to, until you reach it. */
  readonly lead: WonderSite | null;
  /** The keepsakes, for the map: where each one is and whether it has been read. */
  readonly keepsakes: ReadonlyArray<{ position: THREE.Vector3; found: boolean }>;
  isRead(note: PlacedNote): boolean;
}

export function createStory(deps: StoryDeps): Story {
  const { dialogue, speakers, landmarks, wonders, notes } = deps;
  const hud = document.getElementById('hud')!;
  const el = (cls: string): HTMLElement => {
    const e = document.createElement('div');
    e.className = cls;
    hud.appendChild(e);
    return e;
  };

  const prompt = el('prompt');
  const panel = el('dialogue');
  const murmur = el('murmur');
  const marker = el('marker');
  const thread = el('thread');
  const card = el('chapter');

  let target: Target | null = null;
  let shownLabel = '';
  let stage = -1;
  const seenPlaces = new Set<string>();
  let panelTimer = 0;
  let panelAt: THREE.Vector3 | null = null;
  let panelRange = 0;
  let murmurTimer = 0;
  let ambientCooldown = 2;
  let cardTimer = 0;
  let talked = 0;
  let lead: WonderSite | null = null;
  let shownThread = '';
  /** Read so far, as "kind:index". */
  const read = new Set<string>();
  const keepsakes = notes.filter((n) => n.kind === 'keepsake').map((n) => ({ note: n, position: n.position, found: false }));
  const total = (kind: PlacedNote['kind']) => notes.filter((n) => n.kind === kind).length;
  const foundOf = (kind: PlacedNote['kind']) => [...read].filter((k) => k.startsWith(`${kind}:`)).length;
  /** Whoever you are talking to turns to face you. */
  let listener: Speaker | null = null;

  const feetNow = new THREE.Vector3();
  const forwardNow = new THREE.Vector3(0, 0, -1);
  const tmp = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const faceQ = new THREE.Quaternion();

  function nearest(feet: THREE.Vector3, afloat: boolean): Target | null {
    // In priority order: a note, a person, a monument, a place; within a kind, the closest wins.
    // The note goes first because its range is so small that being in it is deliberate - and the
    // highest ground on a world is often somebody's mountain camp.
    let best: Target | null = null;
    let bestD = Infinity;
    const offer = (t: Target): void => {
      const d = feet.distanceTo(t.at);
      if (d < t.range && d < bestD) {
        bestD = d;
        best = t;
      }
    };
    for (const n of notes) {
      // A keepsake says nothing about itself until you have read it.
      const label = n.kind === 'keepsake' ? 'Look closer' : 'Read the note';
      const keepsake = n.kind === 'keepsake';
      offer({ kind: 'note', label, at: n.position, range: keepsake ? KEEPSAKE_RANGE : NOTE_RANGE, note: n, mark: keepsake ? 1.55 : 1.6 });
    }
    if (best) return best;
    for (const s of speakers) offer({ kind: 'speaker', label: `Talk to ${s.name}`, at: s.position, range: TALK_RANGE, speaker: s, mark: headHeight(s) + 0.35 });
    if (best) return best;
    for (const w of wonders) offer({ kind: 'place', label: `Examine ${w.label}`, at: w.position, range: w.radius + WONDER_REACH, lore: `wonder:${w.name}` });
    if (best) return best;
    for (const l of landmarks) offer({ kind: 'place', label: PLACE_LABEL[l.target] ?? 'Examine', at: l.position, range: EXAMINE_RANGE, lore: l.target });
    if (best) return best;
    // Open water has its own sixteen lines, and nothing to hang them on but the water itself.
    if (afloat) return { kind: 'place', label: PLACE_LABEL['place:sea'], at: feet.clone(), range: 6, lore: 'place:sea' };
    return null;
  }

  /** Says there is more, since the prompt that would say so is hidden while a line is up. */
  const MORE = '<span class="more"><span class="keys-only"><kbd>E</kbd>more</span><span class="touch-only">tap for more</span></span>';

  /** `paper` is for things that were written down rather than said: one page, no "more". */
  function show(html: string, at: THREE.Vector3, range: number, holdText: string, paper: PlacedNote['kind'] | null = null): void {
    panel.innerHTML = paper ? html : html + MORE;
    // Whatever you chose to read wins over whatever was being overheard; the two share a spot.
    murmur.classList.remove('on');
    murmurTimer = 0;
    panel.classList.toggle('note', paper === 'note');
    panel.classList.toggle('keepsake', paper === 'keepsake');
    panel.classList.add('on');
    // Replay the line's entrance on every press. Swapping the text in place of a panel that was
    // already open changed nothing you could see, so a second E looked like it had not landed.
    panel.classList.remove('fresh');
    void panel.offsetWidth;
    panel.classList.add('fresh');
    panelTimer = holdFor(holdText, PANEL_HOLD_MAX);
    panelAt = at.clone();
    panelRange = range;
  }

  function closePanel(): void {
    panel.classList.remove('on');
    panelTimer = 0;
    panelAt = null;
    listener = null;
  }

  function showCard(s: number): void {
    card.innerHTML = `<small>${chapterHeading(s).split(' · ')[0]}</small><h2>${CHAPTERS[s].title}</h2><p>${CHAPTERS[s].line}</p>`;
    card.classList.add('on');
    cardTimer = CARD_HOLD;
  }

  /** Opens something written - by walking up to it the first time, or by E after that. */
  function readNote(t: Target): void {
    const n = t.note!;
    read.add(`${n.kind}:${n.index}`);
    cardTimer = 0;
    card.classList.remove('on');
    if (n.kind === 'keepsake') {
      const k = keepsakes.find((x) => x.note === n);
      if (k) k.found = true;
      show(
        `<span class="who">${KEEPSAKE_TITLE} · ${foundOf('keepsake')} of ${total('keepsake')}</span><span class="line">${n.text}</span>`,
        t.at,
        t.range,
        n.text,
        'keepsake'
      );
    } else {
      show(
        `<span class="who">A note · ${foundOf('note')} of ${total('note')} found</span><span class="line">${n.text}</span><span class="sig">${NOTE_SIGNATURE}</span>`,
        t.at,
        t.range,
        n.text,
        'note'
      );
    }
  }

  /** The closest monument nobody has walked you to yet. */
  function nextLead(feet: THREE.Vector3): WonderSite | null {
    let best: WonderSite | null = null;
    let bestD = Infinity;
    wonders.forEach((w, i) => {
      const d = feet.angleTo(w.position);
      if (!deps.visited[i] && d < bestD) {
        bestD = d;
        best = w;
      }
    });
    return best;
  }

  /**
   * How tall someone actually is, measured once from their body in its own upright frame. A
   * fixed height left the marker floating a head above the adults and two above the children.
   */
  const heights = new WeakMap<Speaker, number>();
  function headHeight(s: Speaker): number {
    let h = heights.get(s);
    if (h !== undefined) return h;
    h = 1.7;
    const root = s.root;
    if (root) {
      const p = root.position.clone();
      const q = root.quaternion.clone();
      root.position.set(0, 0, 0);
      root.quaternion.identity();
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      if (!box.isEmpty() && box.max.y > 0.5 && box.max.y < 3) h = box.max.y;
      root.position.copy(p);
      root.quaternion.copy(q);
      root.updateMatrixWorld(true);
    }
    heights.set(s, h);
    return h;
  }

  function placeMarker(): void {
    if (!target || target.mark === undefined) {
      marker.classList.remove('on');
      return;
    }
    // Above the head, along the local up - on a sphere "above" is never world +Y.
    tmp.copy(target.at).addScaledVector(target.at.clone().normalize(), target.mark).project(deps.camera);
    if (tmp.z > 1 || Math.abs(tmp.x) > 1.1 || Math.abs(tmp.y) > 1.1) {
      marker.classList.remove('on');
      return;
    }
    const x = ((tmp.x + 1) / 2) * window.innerWidth;
    const y = ((1 - tmp.y) / 2) * window.innerHeight;
    marker.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    marker.classList.add('on');
  }

  function turnToFace(dt: number): void {
    const root = listener?.root;
    if (!root) return;
    const up = tmp.copy(root.position).normalize();
    const to = feetNow.clone().sub(root.position);
    to.addScaledVector(up, -to.dot(up));
    if (to.lengthSq() < 1e-4) return;
    to.normalize();
    // Bodies face +Z, the same convention the player model uses.
    const x = new THREE.Vector3().crossVectors(up, to).normalize();
    basis.makeBasis(x, up, to);
    faceQ.setFromRotationMatrix(basis);
    root.quaternion.slerp(faceQ, 1 - Math.exp(-6 * dt));
  }

  return {
    get lead() {
      return lead;
    },
    keepsakes,
    isRead: (n) => read.has(`${n.kind}:${n.index}`),

    update(dt, feet, forward, afloat, wondersFound) {
      feetNow.copy(feet);
      forwardNow.copy(forward);

      // Places count toward the story as you find them, so the world opens up by being walked.
      for (const l of landmarks) {
        if (feet.distanceTo(l.position) < EXAMINE_RANGE) seenPlaces.add(l.target + l.position.x.toFixed(0));
      }
      const next = stageFor(wondersFound, seenPlaces.size);
      if (next > stage) {
        stage = next;
        showCard(stage);
      }
      if (lead && deps.visited[wonders.indexOf(lead)]) lead = null;

      const unvisited = deps.visited.filter((v) => !v).length;
      const line = `<b>${chapterHeading(stage)}</b><span>${objective({ stage, talked, lead, unvisited })}</span>`;
      if (line !== shownThread) {
        shownThread = line;
        thread.innerHTML = line;
      }

      target = nearest(feet, afloat);
      // Only touched when it changes: rewriting the DOM every frame for a label that is the
      // same 99% of the time is layout work for nothing.
      const label = target?.label ?? '';
      if (label !== shownLabel) {
        shownLabel = label;
        if (label) prompt.innerHTML = `<kbd>E</kbd>${label}`;
        prompt.classList.toggle('on', label !== '');
      }
      placeMarker();
      // The first time something written comes within reach, it opens by itself. Having walked
      // to a "?" on the map, arriving at the stone and seeing nothing until you guessed to press
      // a key read as there being nothing there. E reads it again after that.
      if (target?.note && !read.has(`${target.note.kind}:${target.note.index}`)) readNote(target);

      if (panelTimer > 0) {
        panelTimer -= dt;
        const walkedOff = panelAt !== null && feet.distanceTo(panelAt) > panelRange + LEAVE_SLACK;
        if (panelTimer <= 0 || walkedOff) closePanel();
        else turnToFace(dt);
      }

      if (cardTimer > 0) {
        cardTimer -= dt;
        if (cardTimer <= 0) card.classList.remove('on');
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
        if (near.length > 0 && panelTimer <= 0 && cardTimer <= 0) {
          const who = near[Math.floor(Math.random() * near.length)];
          const text = dialogue.pick(who.id, who, 'ambient', stage);
          if (text) {
            // Named, so an overheard line can be traced back to somebody you can go and talk to.
            murmur.innerHTML = `${text}<span class="by">${who.name}</span>`;
            murmur.classList.add('on');
            deps.speak?.(who.voice, text);
            murmurTimer = holdFor(text, AMBIENT_HOLD_MAX);
          }
        }
      }
    },

    interact() {
      if (!target) return false;
      const t = target;
      // A card is dismissed by doing anything, so it never sits over the conversation.
      cardTimer = 0;
      card.classList.remove('on');

      if (t.kind === 'speaker' && t.speaker) {
        const s = t.speaker;
        talked++;
        // From the second conversation on, anyone will point you at the nearest monument you
        // have not seen - once per lead, so most lines are still their own.
        let text: string | null = null;
        const unseen = lead ? null : nextLead(feetNow);
        if (unseen && talked > 1) {
          lead = unseen;
          text = leadLine(s.voice, unseen, feetNow, forwardNow);
        } else {
          text = dialogue.pick(s.id, s, 'beat', stage);
        }
        if (!text) return false;
        show(`<span class="who">${s.name}</span><span class="line">${text}</span>`, t.at, t.range, text);
        listener = s;
        murmur.classList.remove('on');
        deps.speak?.(s.voice, text);
        return true;
      }
      if (t.kind === 'note' && t.note) {
        readNote(t);
        return true;
      }
      if (t.lore) {
        const text = dialogue.pickLore(t.lore, stage);
        if (!text) return false;
        show(`<span class="line place">${text}</span>`, t.at, t.range, text);
        return true;
      }
      return false;
    },
  };
}
