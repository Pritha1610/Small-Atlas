import * as THREE from 'three';

/**
 * Sound: four licensed lofi tracks, and an ocean nobody recorded.
 *
 * The music is streamed from disk. The ocean, the wind and the muffle inside a cave are
 * SYNTHESISED from filtered noise instead of being sampled, for three reasons that all point the
 * same way: a wave loop is bytes on disk and these are not, a loop has a seam and noise has
 * none, and above all the game already knows the real answer every frame - how high the swell
 * is under your feet, how far above the waterline you are standing, how fast you are moving.
 * A recording cannot react to any of that. Filtered noise driven by the actual simulation can,
 * so the surf genuinely rises with the wave that is passing under you.
 */

/**
 * Two beds, not one playlist.
 *
 * Lofi was the wrong instinct: a beat implies motion and a certain cosy modernity, and this
 * world is tidal and patient - you wade, you stand in an empty street doing nothing. Worse, a
 * groove is the same everywhere, and this world has two quite different halves.
 *
 * So the music follows where you are. Among people it is a piano somebody sat down and played:
 * domestic, human-scale, unmistakably made by a person, which is the warm half of the story.
 * Alone - at sea, high up, out on empty ground - it thins to a bed with no events in it at all,
 * which is the drowning half. The game already knows which of those you are in, because it
 * knows where everybody lives.
 */
const BEDS = {
  settled: [
    { file: 'settled-nocturne-19', title: 'Nocturne No. 19 in E minor' },
    { file: 'settled-nocturne-16', title: 'Nocturne No. 16 in E flat' },
  ],
  open: [
    { file: 'open-lurking-deep', title: 'Lurking Deep' },
    { file: 'open-mirrors', title: 'Mirrors of Faolan' },
  ],
} as const;

type BedId = keyof typeof BEDS;

const MUSIC_GAIN = 0.4;
/** Above this height over the waterline the sea is inaudible. */
const SEA_EARSHOT = 34;
const STORE_KEY = 'wonders.muted';

export interface AudioState {
  /** Metres above the waterline. Negative while wading. */
  altitude: number;
  /** Displacement of the sea surface right where the player is, from the same wave function
   *  the water shader uses, so the surf and the visible swell are the same swell. */
  swell: number;
  afloat: boolean;
  /** Horizontal speed, which is most of what wind noise actually responds to. */
  speed: number;
  /** 0 outside, 1 well inside a rock chamber. */
  enclosed: number;
  /** 0 alone in open country, 1 standing among people. Chooses which bed you hear. */
  settled: number;
}

/**
 * Voices. Not recordings and not words - a short run of soft blips pitched to the speaker's age,
 * the way a lot of games imply speech without ever committing to a language. It suits this world
 * particularly well: every line is already written down, and hearing an approximate murmur under
 * your own reading is closer to overhearing than any voice actor would be.
 *
 * Synthesised for the same reason the sea is: no files, and it can key off the actual line, so a
 * long sentence murmurs for longer than a short one.
 */
const VOICES: Record<string, { hz: number; wave: OscillatorType; rate: number; jitter: number }> = {
  child: { hz: 520, wave: 'triangle', rate: 0.095, jitter: 0.22 },
  teen: { hz: 390, wave: 'triangle', rate: 0.105, jitter: 0.16 },
  adult: { hz: 290, wave: 'sine', rate: 0.115, jitter: 0.12 },
  elder: { hz: 215, wave: 'sine', rate: 0.145, jitter: 0.1 },
};
/** Long lines would otherwise murmur for fifteen seconds. */
const MAX_BLIPS = 16;
const VOICE_GAIN = 0.075;

export interface Audio {
  /** Must be called from inside a user gesture or the context stays suspended. */
  unlock(): void;
  update(dt: number, state: AudioState): void;
  toggleMute(): void;
  /** Murmurs a line in the speaker's register. Text only sets the length and cadence. */
  speak(voice: string, text: string): void;
  readonly muted: boolean;
  /** Debug read-out: context state, current track, and the live ambience gains. */
  probe(): Record<string, unknown>;
}

/**
 * Four seconds of brown noise, generated once. Brown rather than white because surf and wind are
 * both weighted heavily to the low end, and white noise through a lowpass still hisses.
 */
function brownNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    d[i] = last * 3.5;
  }
  // Crossfade the tail into the head so the loop point is inaudible.
  const fade = Math.min(2000, n >> 2);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    d[i] = d[i] * t + d[n - fade + i] * (1 - t);
  }
  return buf;
}

function noiseSource(ctx: AudioContext, buf: AudioBuffer): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.start();
  return src;
}

export function createAudio(): Audio {
  let ctx: AudioContext | null = null;
  let muted = false;
  try {
    muted = localStorage.getItem(STORE_KEY) === '1';
  } catch {
    muted = false;
  }

  let master: GainNode | null = null;
  let seaGain: GainNode | null = null;
  let seaFilter: BiquadFilterNode | null = null;
  let foamGain: GainNode | null = null;
  let windGain: GainNode | null = null;
  let windFilter: BiquadFilterNode | null = null;
  /** One lowpass across everything, closed down while the player is inside rock. */
  let muffle: BiquadFilterNode | null = null;
  /** Voices sit behind their own softener so the blips never sound like a test tone. */
  let voiceBus: BiquadFilterNode | null = null;

  /** One independent, always-running playlist per bed; the crossfade is purely in the gains. */
  interface Bed {
    id: BedId;
    gain: GainNode | null;
    players: HTMLAudioElement[];
    order: number[];
    cursor: number;
    current: HTMLAudioElement | null;
    fade: number;
  }
  const beds: Record<BedId, Bed> = {
    settled: { id: 'settled', gain: null, players: [], order: [], cursor: 0, current: null, fade: 0 },
    open: { id: 'open', gain: null, players: [], order: [], cursor: 0, current: null, fade: 0 },
  };
  let announced = '';

  const badge = document.createElement('div');
  badge.className = 'audio-badge';

  function showBadge(text: string): void {
    // Attached on FIRST USE, not at construction. createHud() assigns hud.innerHTML, which
    // deletes every child appended before it - the story layer already has a comment about
    // being built after the HUD for exactly this reason, and this was silently wiped too.
    if (!badge.isConnected) document.getElementById('hud')?.appendChild(badge);
    badge.textContent = text;
    badge.classList.add('on');
    window.setTimeout(() => badge.classList.remove('on'), 2600);
  }

  function track(bed: Bed, i: number): HTMLAudioElement {
    if (!bed.players[i]) {
      const el = new window.Audio(`./audio/${BEDS[bed.id][i].file}.mp3`);
      // Streamed, not decoded into an AudioBuffer: a five-minute nocturne decodes to ~26MB of
      // float samples, and holding the whole set would cost most of a hundred megabytes of RAM.
      el.preload = 'none';
      el.crossOrigin = 'anonymous';
      el.volume = 1;
      // Each bed loops its own list forever, so the handover is just the next index.
      el.addEventListener('ended', () => {
        bed.cursor = (bed.cursor + 1) % bed.order.length;
        // A breath before the next one, the way a pianist turns a page. Straight into the next
        // track reads as a playlist; a pause reads as somebody still sitting there.
        window.setTimeout(() => startTrack(bed), 3200);
      });
      bed.players[i] = el;
      // Routed INTO the graph. Without this the element plays straight out to the hardware,
      // which meant the master gain, the bed crossfade and the cave muffle all silently did
      // nothing. An element can only ever be connected once, hence doing it here.
      if (ctx && bed.gain) {
        try {
          ctx.createMediaElementSource(el).connect(bed.gain);
        } catch (err) {
          console.error('[audio] could not route music into the graph', err);
        }
      }
    }
    return bed.players[i];
  }

  function startTrack(bed: Bed): void {
    const el = track(bed, bed.order[bed.cursor]);
    el.currentTime = 0;
    void el.play().catch(() => {
      /* a refused play is not worth breaking the frame over */
    });
    bed.current = el;
  }

  function build(): void {
    if (ctx) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();

    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;

    muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = 20000;
    muffle.connect(master);
    master.connect(ctx.destination);

    for (const id of ['settled', 'open'] as BedId[]) {
      const g = ctx.createGain();
      // Starts silent: update() sets the real balance on the first frame from where you are.
      g.gain.value = 0;
      g.connect(muffle);
      beds[id].gain = g;
      beds[id].order = BEDS[id].map((_, i) => i);
      for (let i = beds[id].order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [beds[id].order[i], beds[id].order[j]] = [beds[id].order[j], beds[id].order[i]];
      }
    }

    voiceBus = ctx.createBiquadFilter();
    voiceBus.type = 'lowpass';
    voiceBus.frequency.value = 1500;
    voiceBus.Q.value = 0.6;
    voiceBus.connect(muffle);

    const noise = brownNoise(ctx, 4);

    // Sea: a low body that is the swell itself, plus a brighter foam band that only comes up
    // when you are close enough to the water to hear individual breaking.
    seaFilter = ctx.createBiquadFilter();
    seaFilter.type = 'lowpass';
    seaFilter.frequency.value = 420;
    seaFilter.Q.value = 0.7;
    seaGain = ctx.createGain();
    seaGain.gain.value = 0;
    noiseSource(ctx, noise).connect(seaFilter);
    seaFilter.connect(seaGain);
    seaGain.connect(muffle);

    const foamFilter = ctx.createBiquadFilter();
    foamFilter.type = 'bandpass';
    foamFilter.frequency.value = 2400;
    foamFilter.Q.value = 0.6;
    foamGain = ctx.createGain();
    foamGain.gain.value = 0;
    noiseSource(ctx, noise).connect(foamFilter);
    foamFilter.connect(foamGain);
    foamGain.connect(muffle);

    // Wind: higher, thinner, and mostly a function of how exposed and how fast you are.
    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 700;
    windFilter.Q.value = 0.4;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    noiseSource(ctx, noise).connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(muffle);

  }

  return {
    get muted() {
      return muted;
    },

    unlock() {
      build();
      if (!ctx) return;
      void ctx.resume();
      // Both beds run from the start. Only the gains change, so walking into a village
      // crossfades rather than restarting a track halfway through.
      for (const id of ['settled', 'open'] as BedId[]) {
        if (!beds[id].current) startTrack(beds[id]);
      }
    },

    speak(voice, text) {
      if (!ctx || ctx.state !== 'running' || muted || !voiceBus) return;
      const v = VOICES[voice] ?? VOICES.adult;
      const words = text.trim().split(/\s+/).length;
      const n = Math.max(2, Math.min(MAX_BLIPS, Math.round(words * 0.8)));
      const now = ctx.currentTime;
      for (let i = 0; i < n; i++) {
        const t = now + i * v.rate;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = v.wave;
        // Drifts down across the line, so it lands like a sentence rather than a tone row.
        const fall = 1 - (i / n) * 0.18;
        osc.frequency.setValueAtTime(v.hz * fall * (1 + (Math.random() - 0.5) * v.jitter), t);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(VOICE_GAIN, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + v.rate * 0.72);
        osc.connect(g);
        g.connect(voiceBus);
        osc.start(t);
        osc.stop(t + v.rate);
      }
    },

    toggleMute() {
      muted = !muted;
      try {
        localStorage.setItem(STORE_KEY, muted ? '1' : '0');
      } catch {
        /* a private-mode failure should not silence the game */
      }
      if (master && ctx) {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.12);
      }
      showBadge(muted ? 'sound off' : 'sound on');
    },

    probe() {
      const loud = (beds.settled.gain?.gain.value ?? 0) >= (beds.open.gain?.gain.value ?? 0)
        ? beds.settled : beds.open;
      return {
        ctx: ctx?.state ?? 'none',
        muted,
        bed: loud.id,
        track: loud.current ? BEDS[loud.id][loud.order[loud.cursor]].title : null,
        playing: loud.current ? !loud.current.paused : false,
        settledGain: +(beds.settled.gain?.gain.value ?? 0).toFixed(3),
        openGain: +(beds.open.gain?.gain.value ?? 0).toFixed(3),
        sea: seaGain ? +seaGain.gain.value.toFixed(4) : 0,
        foam: foamGain ? +foamGain.gain.value.toFixed(4) : 0,
        wind: windGain ? +windGain.gain.value.toFixed(4) : 0,
        muffleHz: muffle ? Math.round(muffle.frequency.value) : 0,
      };
    },

    update(dt, s) {
      if (!ctx || ctx.state !== 'running') return;

      // ---- which bed you are in. Equal-power, so the two never sum to a dip in the middle
      // the way a plain linear crossfade would.
      const t = THREE.MathUtils.clamp(s.settled, 0, 1);
      const eased = t * t * (3 - 2 * t);
      for (const id of ['settled', 'open'] as BedId[]) {
        const bed = beds[id];
        if (!bed.gain) continue;
        bed.fade = Math.min(1, bed.fade + dt / 3);
        const share = id === 'settled' ? Math.sqrt(eased) : Math.sqrt(1 - eased);
        bed.gain.gain.setTargetAtTime(MUSIC_GAIN * share * bed.fade, ctx.currentTime, 1.2);
      }
      const front = eased > 0.5 ? beds.settled : beds.open;
      const name = front.current ? BEDS[front.id][front.order[front.cursor]].title : '';
      if (name && name !== announced) {
        announced = name;
        showBadge(`\u266a  ${name}`);
      }

      // ---- sea: audible below the earshot height, loudest at the waterline, and modulated by
      // the very wave that is passing under the player rather than by a canned LFO.
      const nearness = 1 - THREE.MathUtils.clamp(s.altitude / SEA_EARSHOT, 0, 1);
      const body = Math.pow(nearness, 1.6);
      const swell = 0.72 + THREE.MathUtils.clamp(s.swell / 1.6, -0.28, 0.42);
      if (seaGain && seaFilter) {
        seaGain.gain.setTargetAtTime((s.afloat ? 0.5 : 0.34) * body * swell, ctx.currentTime, 0.25);
        // Distant sea is all rumble; standing in it you hear the top end of it as well.
        seaFilter.frequency.setTargetAtTime(300 + 900 * body, ctx.currentTime, 0.4);
      }
      if (foamGain) {
        const close = 1 - THREE.MathUtils.clamp((s.altitude - 0.5) / 7, 0, 1);
        foamGain.gain.setTargetAtTime(0.05 * close * swell, ctx.currentTime, 0.3);
      }

      // ---- wind: exposure plus how fast you are moving through it
      if (windGain && windFilter) {
        const exposure = THREE.MathUtils.clamp(s.altitude / 40, 0, 1);
        const rush = THREE.MathUtils.clamp(s.speed / 9.4, 0, 1);
        windGain.gain.setTargetAtTime(0.018 + 0.05 * exposure + 0.03 * rush, ctx.currentTime, 0.35);
        windFilter.frequency.setTargetAtTime(520 + 700 * rush, ctx.currentTime, 0.4);
      }

      // ---- rock overhead: one lowpass across the whole mix
      if (muffle) {
        muffle.frequency.setTargetAtTime(20000 - 18400 * s.enclosed, ctx.currentTime, 0.3);
      }
    },
  };
}
