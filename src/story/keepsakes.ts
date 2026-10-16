import type { Where } from './notes';


export interface Keepsake {
  where: Where;
  text: string;
}

export const KEEPSAKES: Keepsake[] = [
  {
    where: 'shore',
    text: 'I left the good rope where you would find it. You thanked the tide.',
  },
  {
    where: 'cave',
    text: 'Two names, cut low, where the lamp does not reach. Only one of them has ever been this far in.',
  },
  {
    where: 'wonder',
    text: 'They say this was built to measure the water. I came here every spring to measure something else. It never once rose to meet me.',
  },
  {
    where: 'high',
    text: 'From up here your roof is the size of a thumbnail. I still know which one.',
  },
  {
    where: 'drowned',
    text: 'Your door is still blue, down there. You took the colour uphill with you. You left the door. You left the rest.',
  },
  {
    where: 'far',
    text: 'This is the furthest a person can walk from you. I checked. It is not far enough.',
  },
];

/** The only heading they get. */
export const KEEPSAKE_TITLE = 'Unsent';
