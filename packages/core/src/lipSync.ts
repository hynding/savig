/** Headless audio lip sync (roadmap 12): key a mouth symbol instance (root scene) from a voice's
 *  loudness — quiet = the rest pose, louder = wider poses. The poses are the keys of the symbol's
 *  frame-by-frame layer (rest first). Give per-frame `levels`, or WAV bytes via `wavLevels`.
 *  Vowel shapes (roadmap 13): also give `vowels` (one per frame, e.g. from `wavVowels`) and each
 *  frame picks the pose whose frame label names its mouth shape (A, E, O, U, M, FV, rest). */
import { frameLoudness, frameVowels, lipSyncPoseTimes, lipSyncPoses, lipSyncTrack, lipSyncVisemes, visemePoseMap, VISEMES } from '@savig/engine';
import type { Project, Viseme, VoicedViseme } from '@savig/engine';

/** Decode a PCM WAV (8/16/24/32-bit integer or 32-bit float; channels mixed to mono). */
export function parseWav(bytes: Uint8Array): { sampleRate: number; samples: Float32Array } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('savig/core: not a WAV file (RIFF/WAVE header missing)');
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  let data: { offset: number; size: number } | null = null;
  for (let o = 12; o + 8 <= bytes.length; ) {
    const id = tag(o);
    const size = dv.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ') {
      let format = dv.getUint16(body, true);
      if (format === 0xfffe && size >= 26) format = dv.getUint16(body + 24, true); // WAVE_FORMAT_EXTENSIBLE
      fmt = { format, channels: dv.getUint16(body + 2, true), sampleRate: dv.getUint32(body + 4, true), bits: dv.getUint16(body + 14, true) };
    } else if (id === 'data') {
      data = { offset: body, size: Math.min(size, bytes.length - body) };
    }
    o = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('savig/core: WAV is missing its fmt or data chunk');
  const { format, channels, sampleRate, bits } = fmt;
  const okInt = format === 1 && [8, 16, 24, 32].includes(bits);
  const okFloat = format === 3 && bits === 32;
  if (!okInt && !okFloat) throw new Error(`savig/core: unsupported WAV encoding (format ${format}, ${bits}-bit); use PCM or 32-bit float`);
  if (!(channels > 0) || !(sampleRate > 0)) throw new Error('savig/core: WAV has no channels or sample rate');
  const bps = bits / 8;
  const frames = Math.floor(data.size / (bps * channels));
  const samples = new Float32Array(frames);
  const read = (o: number): number => {
    if (okFloat) return dv.getFloat32(o, true);
    if (bits === 8) return (dv.getUint8(o) - 128) / 128;
    if (bits === 16) return dv.getInt16(o, true) / 32768;
    if (bits === 24) {
      const v = dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getInt8(o + 2) << 16);
      return v / 8388608;
    }
    return dv.getInt32(o, true) / 2147483648;
  };
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += read(data.offset + (f * channels + c) * bps);
    samples[f] = sum / channels;
  }
  return { sampleRate, samples };
}

/** Per-frame loudness (0..1) of WAV bytes at `fps`, from `from` to `to` seconds of the file. */
export function wavLevels(bytes: Uint8Array, fps: number, from = 0, to?: number, gain = 1): number[] {
  const { sampleRate, samples } = parseWav(bytes);
  return frameLoudness(samples, sampleRate, fps, from, to, gain);
}

/** The vowel shape (viseme) of every frame of WAV bytes at `fps`, frame for frame with wavLevels. */
export function wavVowels(bytes: Uint8Array, fps: number, from = 0, to?: number): VoicedViseme[] {
  const { sampleRate, samples } = parseWav(bytes);
  return frameVowels(samples, sampleRate, fps, from, to);
}

export interface LipSyncInput {
  /** Loudness per frame (0..1) of the voice, starting at `startTime`. */
  levels: number[];
  /** Parent-timeline second where the voice starts (default 0). */
  startTime?: number;
  /** 0..1, higher opens on quieter sound (default 0.5). */
  sensitivity?: number;
  /** Shortest pose hold in frames (default 2). */
  minHold?: number;
  /** Vowel shape per frame (frame for frame with `levels`): sync mouth SHAPES, not just width. */
  vowels?: VoicedViseme[];
}

export interface LipSyncResult {
  project: Project;
  poses: number;
  /** Vowel mode: the shapes the symbol had its own pose for, and whether frame labels named them. */
  shapes?: { matched: Viseme[]; labeled: boolean };
}

/** Key instance `instanceId`'s time remap so it shows a mouth pose per frame. Returns the project
 *  and how many poses the symbol offered. */
export function lipSync(project: Project, instanceId: string, input: LipSyncInput): LipSyncResult {
  const obj = project.objects.find((o) => o.id === instanceId);
  if (!obj) throw new Error(`savig/core: no object "${instanceId}"`);
  const symbol = project.assets.find((a) => a.id === obj.assetId);
  if (symbol?.kind !== 'symbol') throw new Error(`savig/core: "${instanceId}" is not a symbol instance`);
  if (!Array.isArray(input.levels) || input.levels.length === 0) throw new Error('savig/core: lipSync needs per-frame levels');
  const poseTimes = lipSyncPoseTimes(symbol, project.meta.fps);
  if (poseTimes.length < 2) throw new Error(`savig/core: symbol "${symbol.id}" needs at least two mouth poses (a frame-by-frame layer with a key per pose)`);
  const opts = { sensitivity: input.sensitivity, minHold: input.minHold };
  let poses: number[];
  let rest = 0;
  let shapes: LipSyncResult['shapes'];
  if (input.vowels) {
    const voiced = new Set<string>(VISEMES.filter((v) => v !== 'rest'));
    if (!Array.isArray(input.vowels) || input.vowels.some((v) => !voiced.has(v))) {
      throw new Error(`savig/core: vowels must each be one of ${[...voiced].join(', ')}`);
    }
    const map = visemePoseMap(symbol, poseTimes.length);
    poses = lipSyncVisemes(input.levels, input.vowels, opts).map((v) => map.poses[v]);
    rest = map.poses.rest;
    shapes = { matched: map.matched, labeled: map.labeled };
  } else {
    poses = lipSyncPoses(input.levels, poseTimes.length, opts);
  }
  const symbolTimeTrack = lipSyncTrack(poses, poseTimes, input.startTime ?? 0, project.meta.fps, rest);
  const next = { ...obj, symbolTimeTrack };
  delete next.freezeFirstFrame;
  return { project: { ...project, objects: project.objects.map((o) => (o.id === instanceId ? next : o)) }, poses: poseTimes.length, ...(shapes ? { shapes } : {}) };
}
