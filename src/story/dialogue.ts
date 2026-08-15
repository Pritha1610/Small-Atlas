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

export class Dialogue {
  private lines: Line[] = [];
  private lore: LoreEntry[] = [];
  /** Per-speaker memory of what they have already said, so nobody repeats until they must. */
  private spoken = new Map<string, Set<number>>();

  async load(url: string): Promise<void> {
    try {
      const res = await fetch(url);
      const data = (await res.json()) as Corpus;
      this.lines = data.lines ?? [];
      this.lore = data.lore ?? [];
    } catch (err) {
      console.error('[story] failed to load corpus', err);
    }
  }

  get size(): number {
    return this.lines.length + this.lore.length;
  }

  /**
   * Picks a line for a speaker. Filters to their voice and place, allows anything up to the
   * unlocked stage so early material keeps showing up, then prefers lines this particular
   * speaker has not used yet.
   */
  pick(id: string, speaker: Speaker, kind: Line['kind'], stage: number): string | null {
    const pool: number[] = [];
    for (let i = 0; i < this.lines.length; i++) {
      const l = this.lines[i];
      if (l.kind !== kind) continue;
      if (l.voice !== speaker.voice) continue;
      if (l.band !== 'any' && l.band !== speaker.band) continue;
      if (l.stage > stage) continue;
      pool.push(i);
    }
    if (pool.length === 0) return null;

    let used = this.spoken.get(id);
    if (!used) {
      used = new Set();
      this.spoken.set(id, used);
    }
    let fresh = pool.filter((i) => !used.has(i));
    if (fresh.length === 0) {
      // Said everything they have; start over rather than going silent.
      used.clear();
      fresh = pool;
    }
    const choice = fresh[Math.floor(Math.random() * fresh.length)];
    used.add(choice);
    return this.lines[choice].text;
  }

  /** Environmental text for a place, deepening as the story unlocks. */
  pickLore(target: string, stage: number): string | null {
    const pool = this.lore.filter((l) => l.target === target && l.stage <= stage);
    if (pool.length === 0) return null;
    // Prefer the deepest available so a returning player gets new information.
    const best = Math.max(...pool.map((l) => l.stage));
    const top = pool.filter((l) => l.stage === best);
    return top[Math.floor(Math.random() * top.length)].text;
  }
}
