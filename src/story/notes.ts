/**
 * Where a note or a keepsake can be put. The world is regenerated on every load and no fixed
 * place survives, so each one names a KIND of spot:
 *   peak    - the highest ground on the planet
 *   high    - high ground, but not the very top
 *   shore   - dry ground at the water's edge
 *   cave    - just inside a cave mouth
 *   far     - the dry land furthest from where you woke up
 *   wonder  - tucked behind one of the seven monuments
 *   drowned - out in the water over a drowned settlement (reach it by boat)
 *   anywhere
 * If a world has no such spot (no caves, say), it goes somewhere random instead. Everything
 * placed this way is also kept well apart from everything else placed this way.
 */
export type Where = 'peak' | 'high' | 'shore' | 'cave' | 'far' | 'wonder' | 'drowned' | 'anywhere';

/**
 * Notes from the developer, pinned to posts in out-of-the-way corners of the world. Walk up to
 * one and it opens; E reads it again. Add, remove or reorder entries freely - one post is placed
 * per note, and a note with no text is not placed at all, so an unwritten slot never reaches a
 * player.
 */
export interface DevNote {
  where: Where;
  text: string;
}

// Still to be written. Fill in `text` and the post appears in the world.
export const DEV_NOTES: DevNote[] = [
  { where: 'peak', text: '' },
  { where: 'cave', text: '' },
  { where: 'drowned', text: '' },
  { where: 'far', text: '' },
];

export const NOTE_SIGNATURE = '— the developer';
