import * as THREE from 'three';
import type { Voice } from './dialogue';
import type { WonderSite } from '../world/wonders';

/**
 * The story, said out loud.
 *
 * The corpus was written to be overheard - docs/STORY.md tells nobody anything directly - and on
 * its own that left players unsure there was a story at all, or what to do next. This is the
 * thin direct layer on top: a card naming each stage as it unlocks, one line saying what to do
 * now, and people who will point you at a monument you have not seen. The fragments still carry
 * the meaning; this just makes sure you go and find them.
 */

export interface Chapter {
  title: string;
  line: string;
}

/** One per story stage (see stageFor in dialogue.ts). Shown once, as the stage unlocks. */
export const CHAPTERS: Chapter[] = [
  {
    title: 'Weather and Work',
    line: 'The sea has been rising for six generations. The people who stayed are still mending nets. Go and talk to them.',
  },
  {
    title: 'The Water',
    line: 'Every street here used to be somewhere else, and everyone knows exactly where. The water is not news to them. It is the neighbour.',
  },
  {
    title: 'What Was Lost',
    line: 'The drowned houses had names, and the people nearby still use them. Swim out to one and look.',
  },
  {
    title: 'The Wonders',
    line: 'Seven things still stand. Nobody agrees what they were for, and everyone is a little bit right.',
  },
  {
    title: 'What People Do With an Ending',
    line: 'It is not going to stop. Ask them what they mean to do with the time.',
  },
];

const NUMERALS = ['I', 'II', 'III', 'IV', 'V'];

export interface StoryState {
  stage: number;
  /** Conversations had, in total. */
  talked: number;
  lead: WonderSite | null;
  unvisited: number;
}

/** The one line under the title saying what to do now. */
export function objective(s: StoryState): string {
  if (s.talked === 0) return 'Find someone and talk to them.';
  if (s.lead) return `Head for ${s.lead.label}. It is marked on your map.`;
  if (s.unvisited > 0) return 'Ask someone where to go next.';
  if (s.stage < 4) return 'You have seen all seven. Keep talking; they have more to say now.';
  return 'You have seen all seven. Listen to what they make of it.';
}

/**
 * Pointing the way. {known} is the monument as this world names it, {dir} which way from where
 * you are facing, {dist} how far. A capital letter on a slot capitalises what goes in it.
 * No verb ever follows {known}: some names are plural ("the flood markers at Giza"), and "the
 * flood markers is ahead of you" was the first thing anyone pointed at.
 */
const LEADS: Record<Voice, string[]> = {
  child: [
    'Have you been to {known}? {Dir}. {dist} I went nearly all the way once.',
    '{Known}? {Dir}. {dist} Tan says that whole place is haunted. It is not. Probably not.',
  ],
  teen: [
    'If you are going anywhere, go to {known}. {Dir}. {dist} Everyone here says it is too far. It is not.',
    '{Known}. {Dir}. {dist} Go before the old ones tell you what it means.',
  ],
  adult: [
    'You want {known}. {Dir}. {dist} Take water, and stay off the shore path, it is gone.',
    'Head for {known}. {Dir}. {dist} Do not let anyone sell you a map.',
  ],
  elder: [
    'My mother walked to {known} once. {Dir}. {dist} She said it was smaller than she expected. She was lying.',
    '{Known}? {Dir}. {dist} It was there before the water and it will be there after. Go and look at it.',
  ],
};

const SIDES = [
  'straight ahead of you',
  'ahead of you, off to the right',
  'off to your right',
  'behind you, to the right',
  'right behind you',
  'behind you, to the left',
  'off to your left',
  'ahead of you, off to the left',
];

const tmp = new THREE.Vector3();
const right = new THREE.Vector3();

/** Which way `target` lies from someone at `feet` facing `forward`, in words. */
export function directionWords(feet: THREE.Vector3, forward: THREE.Vector3, target: THREE.Vector3): string {
  const up = feet.clone().normalize();
  tmp.copy(target).normalize().addScaledVector(up, -target.clone().normalize().dot(up));
  // forward x up is the player's right, as in the controller.
  right.crossVectors(forward, up).normalize();
  const a = Math.atan2(tmp.dot(right), tmp.dot(forward));
  const sector = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return SIDES[sector];
}

function distanceWords(feet: THREE.Vector3, target: THREE.Vector3): string {
  const arc = feet.angleTo(target) * feet.length();
  if (arc < 45) return 'Not far.';
  if (arc < 120) return 'A good walk.';
  return 'A long way. Most of the way round the world.';
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function leadLine(voice: Voice, site: WonderSite, feet: THREE.Vector3, forward: THREE.Vector3): string {
  const pool = LEADS[voice] ?? LEADS.adult;
  const dir = directionWords(feet, forward, site.position);
  return pool[Math.floor(Math.random() * pool.length)]
    .replace('{known}', site.known)
    .replace('{Known}', cap(site.known))
    .replace('{dir}', dir)
    .replace('{Dir}', cap(dir))
    .replace('{dist}', distanceWords(feet, site.position));
}

export function chapterHeading(stage: number): string {
  return `${NUMERALS[stage]} · ${CHAPTERS[stage].title}`;
}

// A self-check for the one piece of geometry here, run in dev: on a sphere it is easy to get
// left and right swapped, which would send every player the wrong way.
if (import.meta.env.DEV) {
  const feet = new THREE.Vector3(0, 80, 0);
  const fwd = new THREE.Vector3(0, 0, -1);
  const at = (x: number, z: number) => directionWords(feet, fwd, new THREE.Vector3(x, 80, z));
  console.assert(at(0, -10) === SIDES[0], 'ahead', at(0, -10));
  console.assert(at(10, 0) === SIDES[2], 'right', at(10, 0));
  console.assert(at(-10, 0) === SIDES[6], 'left', at(-10, 0));
  console.assert(at(0, 10) === SIDES[4], 'behind', at(0, 10));
}
