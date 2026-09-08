import { describe, expect, it } from 'vitest';
import { clipFadeGainAt, fadeEnvelopePoints, resolveTrackState } from './audio-mix';
import type { AudioClip, AudioTrack } from './types';

const clip = (over: Partial<AudioClip> = {}): AudioClip => ({
  id: 'c1', assetId: 'a1', startTime: 2, inPoint: 0, outPoint: 4, volume: 0.8, ...over,
});
const track = (over: Partial<AudioTrack> = {}): AudioTrack => ({
  id: 't1', name: 'T', gain: 0.5, muted: false, solo: false, ...over,
});

describe('resolveTrackState', () => {
  it('default track when tracks absent or trackId dangling/undefined', () => {
    for (const st of [
      resolveTrackState(undefined, undefined),
      resolveTrackState(undefined, 't-missing'),
      resolveTrackState([track()], 't-missing'),
      resolveTrackState([track()], undefined),
    ]) expect(st).toEqual({ audible: true, gain: 1, pan: 0 });
  });
  it('resolves gain/pan/filter from the track', () => {
    const t = track({ pan: -0.5, filter: { kind: 'lowpass', frequency: 800 } });
    expect(resolveTrackState([t], 't1')).toEqual({ audible: true, gain: 0.5, pan: -0.5, filter: { kind: 'lowpass', frequency: 800 } });
  });
  it('mute silences its own track', () => {
    expect(resolveTrackState([track({ muted: true })], 't1').audible).toBe(false);
  });
  it('any solo silences non-solo tracks (incl. the default track), solo+muted stays silent', () => {
    const tracks = [track(), track({ id: 't2', solo: true })];
    expect(resolveTrackState(tracks, 't1').audible).toBe(false);
    expect(resolveTrackState(tracks, 't2').audible).toBe(true);
    expect(resolveTrackState(tracks, undefined).audible).toBe(false); // default lane is non-solo
    expect(resolveTrackState([track({ solo: true, muted: true })], 't1').audible).toBe(false);
  });
});

describe('clipFadeGainAt', () => {
  it('is 1 inside a fade-less clip, 0 outside the window', () => {
    expect(clipFadeGainAt(clip(), 3)).toBe(1);
    expect(clipFadeGainAt(clip(), 1.99)).toBe(0);
    expect(clipFadeGainAt(clip(), 6)).toBe(0); // end (2 + 4s) is exclusive
  });
  it('linear fade-in and fade-out', () => {
    const c = clip({ fadeIn: 1, fadeOut: 2 }); // window 2..6
    expect(clipFadeGainAt(c, 2)).toBe(0);
    expect(clipFadeGainAt(c, 2.5)).toBeCloseTo(0.5);
    expect(clipFadeGainAt(c, 3)).toBe(1);
    expect(clipFadeGainAt(c, 5)).toBeCloseTo(0.5);
    expect(clipFadeGainAt(c, 6 - 1e-9)).toBeCloseTo(0);
  });
  it('overlapping fades on a short clip take the min of the two ramps, each clamped to clip length', () => {
    const c = clip({ outPoint: 1, fadeIn: 2, fadeOut: 2 }); // 1s clip, both fades clamp to 1
    expect(clipFadeGainAt(c, 2.5)).toBeCloseTo(0.5); // min(0.5 in-ramp, 0.5 out-ramp)
    expect(clipFadeGainAt(c, 2.25)).toBeCloseTo(0.25);
  });
});

describe('fadeEnvelopePoints', () => {
  it('no fades → flat 1 from fromTime to end', () => {
    expect(fadeEnvelopePoints(clip(), 0)).toEqual([{ t: 2, gain: 1 }, { t: 6, gain: 1 }]);
  });
  it('emits breakpoints at fade boundaries', () => {
    expect(fadeEnvelopePoints(clip({ fadeIn: 1, fadeOut: 2 }), 0)).toEqual([
      { t: 2, gain: 0 }, { t: 3, gain: 1 }, { t: 4, gain: 1 }, { t: 6, gain: 0 },
    ]);
  });
  it('mid-fade start seeds the instantaneous value and skips passed breakpoints', () => {
    expect(fadeEnvelopePoints(clip({ fadeIn: 1, fadeOut: 2 }), 2.5)).toEqual([
      { t: 2.5, gain: 0.5 }, { t: 3, gain: 1 }, { t: 4, gain: 1 }, { t: 6, gain: 0 },
    ]);
  });
  it('finished clip → []', () => {
    expect(fadeEnvelopePoints(clip(), 7)).toEqual([]);
  });
});
