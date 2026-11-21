// Vowel-shaped lip sync (roadmap 13): pick a mouth SHAPE per frame, not just how wide it opens.
//
// Each frame of the voice clip is analyzed with a small FFT. Vowels are told apart by their
// first two formants (resonances of the mouth): "ah" has a high F1, "ee" a high F2, "oo" and
// "oh" low F2. Hiss (s, f, sh) puts most of its energy above 4 kHz; a hummed "m" keeps nearly
// all of it under 400 Hz. No speech recognition and no network: pure, deterministic math, good
// enough to read as talking (the same trade-off Animate's own Lip Sync makes).
//
// The mouth symbol's frame-by-frame keys are the poses. Frame LABELS name the shapes ("A", "E",
// "O", "U", "M", "FV", "rest", with common aliases); unlabeled poses are taken in the default
// order rest, M, A, E, O, U, FV.
import type { SceneObject, SymbolAsset } from './types';

/** The mouth shapes, after the classic animation set (Preston Blair, reduced). */
export type Viseme = 'rest' | 'MBP' | 'AI' | 'E' | 'O' | 'U' | 'FV';

export const VISEMES: readonly Viseme[] = ['rest', 'MBP', 'AI', 'E', 'O', 'U', 'FV'];

/** A frame's sound class before loudness gating: every viseme but rest. */
export type VoicedViseme = Exclude<Viseme, 'rest'>;

export const VISEME_NAMES: Record<Viseme, string> = {
  rest: 'Rest',
  MBP: 'M / B / P',
  AI: 'A / I',
  E: 'E',
  O: 'O',
  U: 'U / W',
  FV: 'F / V / S',
};

// --- Spectrum ---------------------------------------------------------------------------------

/** In-place iterative radix-2 FFT. `re`/`im` lengths must be the same power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** The spectral features one frame is classified by. */
export interface VowelFeatures {
  /** Estimated first formant (Hz): the strongest resonance in 250-1000 Hz. */
  f1: number;
  /** Estimated second formant (Hz): the strongest resonance in 850-2800 Hz, above F1. */
  f2: number;
  /** Share of the 80 Hz-8 kHz energy above 4 kHz (hiss). */
  hiss: number;
  /** Share of the 80 Hz-8 kHz energy below 400 Hz (hum). */
  hum: number;
  /** RMS of the analyzed window. */
  rms: number;
}

/** Power spectrum, smoothed over ~150 Hz so single harmonics don't read as formants. */
function smoothedPower(power: Float64Array, binHz: number): Float64Array {
  const r = Math.max(1, Math.round(75 / binHz));
  const out = new Float64Array(power.length);
  let acc = 0;
  for (let i = 0; i < Math.min(power.length, r); i++) acc += power[i]!;
  for (let i = 0; i < power.length; i++) {
    if (i + r < power.length) acc += power[i + r]!;
    if (i - r - 1 >= 0) acc -= power[i - r - 1]!;
    out[i] = acc;
  }
  return out;
}

/** Analyze `samples[a..b)` (one frame) for vowel features. */
export function vowelFeatures(samples: Float32Array, sampleRate: number, a: number, b: number): VowelFeatures {
  const len = Math.max(0, Math.min(samples.length, b) - Math.max(0, a));
  let size = 256;
  while (size < len && size < 4096) size <<= 1;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  // Centre the window on the frame; Hann-weight it; pre-emphasis lifts the formants over the
  // strong low harmonics of a voice.
  const mid = Math.floor((Math.max(0, a) + Math.min(samples.length, b)) / 2);
  const from = mid - Math.floor(size / 2);
  let sq = 0;
  let count = 0;
  let prev = 0;
  for (let i = 0; i < size; i++) {
    const k = from + i;
    const x = k >= 0 && k < samples.length ? samples[k]! : 0;
    if (k >= a && k < b) {
      sq += x * x;
      count++;
    }
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    re[i] = (x - 0.94 * prev) * w;
    prev = x;
  }
  fft(re, im);
  const half = size / 2;
  const binHz = sampleRate / size;
  const power = new Float64Array(half);
  for (let i = 0; i < half; i++) power[i] = re[i]! * re[i]! + im[i]! * im[i]!;
  const bin = (hz: number) => Math.max(0, Math.min(half - 1, Math.round(hz / binHz)));
  let total = 0;
  let high = 0;
  let low = 0;
  // The TRUE spectrum (pre-emphasis divided out) for hum, hiss and F1; the emphasized one for
  // F2, where a voice's natural roll-off would otherwise hide it.
  const truePower = new Float64Array(half);
  for (let i = 0; i < half; i++) {
    const w = (2 * Math.PI * i) / size;
    truePower[i] = power[i]! / Math.max(1e-6, 1 + 0.94 * 0.94 - 2 * 0.94 * Math.cos(w));
  }
  for (let i = bin(80); i <= bin(8000); i++) {
    const p = truePower[i]!;
    total += p;
    if (i * binHz >= 4000) high += p;
    if (i * binHz < 400) low += p;
  }
  const smoothTrue = smoothedPower(truePower, binHz);
  const smoothEmph = smoothedPower(power, binHz);
  // F1: the LOWEST clear peak in 250-1000 Hz (back vowels put F2 close above F1, and it can be
  // as strong), i.e. the first local maximum reaching 40% of the band's strongest.
  const lo1 = bin(250);
  const hi1 = bin(1000);
  let max1 = 0;
  for (let i = lo1; i <= hi1; i++) max1 = Math.max(max1, smoothTrue[i]!);
  let f1Bin = lo1;
  for (let i = lo1; i <= hi1; i++) {
    const v = smoothTrue[i]!;
    const left = i > 0 ? smoothTrue[i - 1]! : -Infinity;
    const right = i + 1 < half ? smoothTrue[i + 1]! : -Infinity;
    if (v >= 0.4 * max1 && v >= left && v >= right) {
      f1Bin = i;
      break;
    }
  }
  const f1 = f1Bin * binHz;
  let f2Bin = bin(Math.max(850, f1 + 200));
  for (let i = f2Bin; i <= bin(2800); i++) if (smoothEmph[i]! > smoothEmph[f2Bin]!) f2Bin = i;
  const f2 = f2Bin * binHz;
  return {
    f1,
    f2,
    hiss: total > 0 ? high / total : 0,
    hum: total > 0 ? low / total : 0,
    rms: count > 0 ? Math.sqrt(sq / count) : 0,
  };
}

// Reference formants (Hz) for adult speech; classification is nearest in log-frequency space.
const VOWEL_FORMANTS: [VoicedViseme, number, number][] = [
  ['AI', 760, 1300],
  ['AI', 650, 1700], // "a" as in cat
  ['E', 480, 1900],
  ['E', 300, 2250], // "ee"
  ['O', 520, 900],
  ['U', 330, 820],
];

/** Classify one frame's features into a voiced viseme. */
export function classifyVowel(f: VowelFeatures): VoicedViseme {
  if (f.hiss > 0.45) return 'FV';
  if (f.hum > 0.82) return 'MBP';
  let best: VoicedViseme = 'AI';
  let bestD = Infinity;
  const l1 = Math.log(Math.max(1, f.f1));
  const l2 = Math.log(Math.max(1, f.f2));
  for (const [v, r1, r2] of VOWEL_FORMANTS) {
    // F1 separates open from closed vowels most reliably, so it weighs a little more.
    const d = 1.3 * (l1 - Math.log(r1)) ** 2 + (l2 - Math.log(r2)) ** 2;
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

/** The voiced viseme of every frame of `samples` from `from` to `to` seconds (one per 1/fps),
 *  frame for frame with frameLoudness. Loudness gating happens later (lipSyncVisemes). */
export function frameVowels(samples: Float32Array, sampleRate: number, fps: number, from = 0, to?: number): VoicedViseme[] {
  if (!(sampleRate > 0) || !(fps > 0)) return [];
  const total = samples.length / sampleRate;
  const start = Math.max(0, from);
  const end = Math.min(total, to ?? total);
  if (end <= start) return [];
  const frames = Math.ceil((end - start) * fps - 1e-9);
  const out: VoicedViseme[] = [];
  for (let f = 0; f < frames; f++) {
    const a = Math.floor((start + f / fps) * sampleRate);
    const b = Math.min(Math.floor(Math.min(end, start + (f + 1) / fps) * sampleRate), samples.length);
    out.push(classifyVowel(vowelFeatures(samples, sampleRate, a, b)));
  }
  return out;
}

// --- Frames -> visemes ------------------------------------------------------------------------

export interface VisemeOptions {
  /** 0..1: higher opens the mouth on quieter sound (default 0.5). Same scale as loudness sync. */
  sensitivity?: number;
  /** Shortest time (frames) a shape is held, to stop flicker (default 2). */
  minHold?: number;
}

/** One viseme per frame: frames under the silence gate rest; quiet voiced frames close to MBP;
 *  the rest keep their vowel. Very short shapes merge into their neighbor (minHold). */
export function lipSyncVisemes(levels: readonly number[], vowels: readonly VoicedViseme[], opts: VisemeOptions = {}): Viseme[] {
  const n = Math.min(levels.length, vowels.length);
  if (n === 0) return [];
  const sens = Math.min(1, Math.max(0, opts.sensitivity ?? 0.5));
  const minHold = Math.max(1, Math.round(opts.minHold ?? 2));
  const sorted = levels.slice(0, n).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const ref = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]! : 0;
  if (!(ref > 1e-4)) return Array.from({ length: n }, () => 'rest');
  const gate = 0.3 - 0.25 * sens; // as lipSyncPoses
  const raw: Viseme[] = [];
  for (let i = 0; i < n; i++) {
    const v = levels[i]!;
    const x = Number.isFinite(v) ? Math.min(1, v / ref) : 0;
    if (x < gate) raw.push('rest');
    else if (x < gate * 1.6 && vowels[i] !== 'FV') raw.push('MBP'); // barely voiced: lips nearly shut
    else raw.push(vowels[i]!);
  }
  const out = raw.slice();
  let i = 0;
  while (i < out.length) {
    let j = i;
    while (j < out.length && out[j] === out[i]) j++;
    if (j - i < minHold && i > 0) for (let k = i; k < j; k++) out[k] = out[i - 1]!;
    i = j;
  }
  return out;
}

// --- Visemes -> the symbol's poses ------------------------------------------------------------

const ALIASES: Record<string, Viseme> = {
  rest: 'rest', neutral: 'rest', closed: 'rest', idle: 'rest', x: 'rest',
  m: 'MBP', mbp: 'MBP', b: 'MBP', p: 'MBP', bmp: 'MBP',
  a: 'AI', ai: 'AI', ah: 'AI', i: 'AI', aa: 'AI',
  e: 'E', ee: 'E', eh: 'E',
  o: 'O', oh: 'O',
  u: 'U', w: 'U', oo: 'U', wq: 'U', uw: 'U', 'w-oo': 'U', woo: 'U',
  f: 'FV', fv: 'FV', v: 'FV', s: 'FV', etc: 'FV', consonant: 'FV', th: 'FV',
};

/** The viseme a frame label names ("Ah", "MBP", "W-Oo" ...), or undefined. */
export function visemeForLabel(label: string | undefined): Viseme | undefined {
  if (!label) return undefined;
  const key = label.trim().toLowerCase().replace(/[\s_/]+/g, '');
  return ALIASES[key] ?? ALIASES[label.trim().toLowerCase()];
}

// When a shape has no pose, try these in turn (the last resort is the widest pose for open
// shapes and rest for closed ones).
const FALLBACK: Record<Viseme, Viseme[]> = {
  rest: ['MBP'],
  MBP: ['rest'],
  AI: ['E', 'O'],
  E: ['AI', 'FV'],
  O: ['U', 'AI'],
  U: ['O', 'MBP'],
  FV: ['E', 'MBP', 'AI'],
};

export interface VisemePoseMap {
  /** Pose index for every viseme. */
  poses: Record<Viseme, number>;
  /** The visemes the symbol has its own pose for. */
  matched: Viseme[];
  /** True when poses came from frame labels (else the default order). */
  labeled: boolean;
}

/** Map every viseme to one of the symbol's poses (indexes into lipSyncPoseTimes order). */
export function visemePoseMap(symbol: SymbolAsset, poseCount: number): VisemePoseMap {
  const layer = symbol.objects.find((o: SceneObject) => !o.parentId && o.isGroup && o.frames && o.frames.keys.length > 0);
  const keys = layer?.frames ? [...layer.frames.keys].sort((a, b) => a.time - b.time) : [];
  const own = new Map<Viseme, number>();
  keys.forEach((k, i) => {
    const v = visemeForLabel(k.label);
    if (v && !own.has(v) && i < poseCount) own.set(v, i);
  });
  const labeled = own.size >= 2;
  if (!labeled) {
    own.clear();
    VISEMES.slice(0, Math.max(1, poseCount)).forEach((v, i) => own.set(v, i));
  }
  const pick = (v: Viseme): number => {
    if (own.has(v)) return own.get(v)!;
    for (const alt of FALLBACK[v]) if (own.has(alt)) return own.get(alt)!;
    if (v === 'rest' || v === 'MBP') return 0;
    return Math.max(0, poseCount - 1);
  };
  const poses = Object.fromEntries(VISEMES.map((v) => [v, pick(v)])) as Record<Viseme, number>;
  return { poses, matched: VISEMES.filter((v) => own.has(v)), labeled };
}
