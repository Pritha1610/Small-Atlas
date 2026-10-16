export type Voice = 'child' | 'teen' | 'adult' | 'elder';
export type Band = 'waterline' | 'shore' | 'upland' | 'mountain' | 'cave' | 'drowned' | 'any';

export interface Line {
  /** Short ambient murmur shown as you pass, or a longer beat shown when you press E. */
  kind: 'ambient' | 'beat';
  voice: Voice;
  band: Band;
  /** 0 = weather and work, 4 = what people do with an ending. Gated by discovery. */
  stage: number;
  text: string;
}

export interface LoreEntry {
  /** 'wonder:Giza', 'place:drowned', 'place:cave', ... */
  target: string;
  stage: number;
  text: string;
}

export interface Corpus {
  lines: Line[];
  lore: LoreEntry[];
}

/**
 * Which stage of the story the player has unlocked. Discovery drives it rather than a counter
 * of conversations, so the story deepens because you explored, not because you pressed E a lot.
 */
export function stageFor(wondersFound: number, settlementsSeen: number): number {
  const score = wondersFound * 2 + settlementsSeen;
  if (score >= 16) return 4;
  if (score >= 10) return 3;
  if (score >= 6) return 2;
  if (score >= 3) return 1;
  return 0;
}

interface Speaker {
  voice: Voice;
  band: Band;
}

/** What one speaker (or one place) has already said, and the very last thing. */
interface Memory<T> {
  said: Set<T>;
  last?: T;
}

/**
 * The next thing to say from `pool`, so that pressing E again always moves on.
 *
 * Deepest stage first among what has not been said, so a newly unlocked stage is heard straight
 * away instead of being shuffled in among the old material. Once everything has been said it
 * goes round again - but never straight back to the line on screen. At the start a monument has
 * just two lines, and the old reset picked the one already showing half the time: measured, 3
 * presses in 20 at Giza changed nothing, which reads as E being broken.
 */
function nextFrom<T extends { stage: number }>(pool: T[], memory: Memory<T>): T | null {
  if (pool.length === 0) return null;
  let fresh = pool.filter((x) => !memory.said.has(x));
  if (fresh.length === 0) {
    for (const x of pool) memory.said.delete(x);
    fresh = pool.length > 1 ? pool.filter((x) => x !== memory.last) : pool;
  }
  const deepest = Math.max(...fresh.map((x) => x.stage));
  const top = fresh.filter((x) => x.stage === deepest);
  const choice = top[Math.floor(Math.random() * top.length)];
  memory.said.add(choice);
  memory.last = choice;
  return choice;
}

export class Dialogue {
  private lines: Line[] = [];
  private lore: LoreEntry[] = [];
  /** Per speaker and kind of line, and per place. */
  private memory = new Map<string, Memory<unknown>>();

  async load(url: string): Promise<void> {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Corpus;
      this.lines = data.lines ?? [];
      this.lore = data.lore ?? [];
    } catch (err) {
      // Loud, because the symptom is so quiet: nobody has anything to say and E does nothing.
      console.error(`[story] could not load the dialogue from ${url}; talking and examining will be silent.`, err);
    }
  }

  get size(): number {
    return this.lines.length + this.lore.length;
  }

  private remember<T>(key: string): Memory<T> {
    let m = this.memory.get(key);
    if (!m) this.memory.set(key, (m = { said: new Set() }));
    return m as Memory<T>;
  }

  /**
   * Picks a line for a speaker: their voice, their place, anything up to the unlocked stage, and
   * whatever this particular speaker has not said yet.
   */
  pick(id: string, speaker: Speaker, kind: Line['kind'], stage: number): string | null {
    const pool = this.lines.filter(
      (l) => l.kind === kind && l.voice === speaker.voice && (l.band === 'any' || l.band === speaker.band) && l.stage <= stage
    );
    return nextFrom(pool, this.remember<Line>(`${id}:${kind}`))?.text ?? null;
  }

  /** Environmental text for a place, deepening as the story unlocks. */
  pickLore(target: string, stage: number): string | null {
    const pool = this.lore.filter((l) => l.target === target && l.stage <= stage);
    return nextFrom(pool, this.remember<LoreEntry>(`lore:${target}`))?.text ?? null;
  }
}
