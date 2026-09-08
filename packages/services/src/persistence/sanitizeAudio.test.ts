import { describe, expect, it } from 'vitest';
import { createProject } from '@savig/engine';
import type { AudioAsset, AudioClip, AudioTrack, Project } from '@savig/engine';
import { sanitizeAudioModel } from './sanitizeAudio';

function project(overrides: Partial<Project> = {}): Project {
  return { ...createProject({ name: 'Sanitize' }), ...overrides };
}

function validTrack(overrides: Partial<AudioTrack> = {}): AudioTrack {
  return { id: 't1', name: 'Track 1', gain: 0.8, muted: false, solo: false, ...overrides };
}

function validClip(overrides: Partial<AudioClip> = {}): AudioClip {
  return {
    id: 'c1',
    assetId: 'a1',
    startTime: 0,
    inPoint: 0,
    outPoint: 1,
    volume: 1,
    ...overrides,
  };
}

function audioAsset(overrides: Partial<AudioAsset> = {}): AudioAsset {
  return { id: 'a1', kind: 'audio', name: 'a.mp3', mimeType: 'audio/mpeg', ...overrides };
}

describe('sanitizeAudioModel', () => {
  it('accepts a valid track verbatim (same reference)', () => {
    const track = validTrack();
    const p = project({ audioTracks: [track] });
    const out = sanitizeAudioModel(p);
    expect(out.audioTracks?.[0]).toBe(track);
  });

  it('clamps gain 2 -> 1', () => {
    const p = project({ audioTracks: [validTrack({ gain: 2 })] });
    const out = sanitizeAudioModel(p);
    expect(out.audioTracks?.[0].gain).toBe(1);
  });

  it('clamps pan -3 -> -1', () => {
    const p = project({ audioTracks: [validTrack({ pan: -3 })] });
    const out = sanitizeAudioModel(p);
    expect(out.audioTracks?.[0].pan).toBe(-1);
  });

  it('clamps frequency 1 -> 10', () => {
    const p = project({
      audioTracks: [validTrack({ filter: { kind: 'lowpass', frequency: 1 } })],
    });
    const out = sanitizeAudioModel(p);
    expect(out.audioTracks?.[0].filter).toEqual({ kind: 'lowpass', frequency: 10 });
  });

  it('clamps frequency 1e6 -> 24000', () => {
    const p = project({
      audioTracks: [validTrack({ filter: { kind: 'highpass', frequency: 1e6 } })],
    });
    const out = sanitizeAudioModel(p);
    expect(out.audioTracks?.[0].filter).toEqual({ kind: 'highpass', frequency: 24000 });
  });

  it('truncates a 500-char name to 120', () => {
    const longName = 'x'.repeat(500);
    const p = project({ audioTracks: [validTrack({ name: longName })] });
    const out = sanitizeAudioModel(p);
    expect(out.audioTracks?.[0].name).toBe('x'.repeat(120));
  });

  it('drops a track entry that is not an object', () => {
    const p = project({ audioTracks: [42 as unknown as AudioTrack] });
    const out = sanitizeAudioModel(p);
    expect(out.audioTracks).toEqual([]);
  });

  it('drops a track entry with a non-string id', () => {
    const p = project({ audioTracks: [validTrack({ id: 42 as unknown as string })] });
    const out = sanitizeAudioModel(p);
    expect(out.audioTracks).toEqual([]);
  });

  it("strips a filter with kind 'notch'", () => {
    const p = project({
      audioTracks: [
        validTrack({ filter: { kind: 'notch' as unknown as 'lowpass', frequency: 500 } }),
      ],
    });
    const out = sanitizeAudioModel(p);
    expect(out.audioTracks?.[0].filter).toBeUndefined();
    expect('filter' in (out.audioTracks?.[0] ?? {})).toBe(false);
  });

  it('drops fadeIn: -1 (field removed, clip kept)', () => {
    const clip = validClip({ fadeIn: -1 });
    const p = project({ audioClips: [clip] });
    const out = sanitizeAudioModel(p);
    expect(out.audioClips).toHaveLength(1);
    expect(out.audioClips[0].fadeIn).toBeUndefined();
    expect('fadeIn' in out.audioClips[0]).toBe(false);
    expect(out.audioClips[0].id).toBe('c1');
  });

  it('drops fadeIn: NaN (field removed, clip kept)', () => {
    const clip = validClip({ fadeIn: NaN });
    const p = project({ audioClips: [clip] });
    const out = sanitizeAudioModel(p);
    expect(out.audioClips).toHaveLength(1);
    expect(out.audioClips[0].fadeIn).toBeUndefined();
    expect('fadeIn' in out.audioClips[0]).toBe(false);
  });

  it('drops fadeOut: -1 (field removed, clip kept)', () => {
    const clip = validClip({ fadeOut: -1 });
    const p = project({ audioClips: [clip] });
    const out = sanitizeAudioModel(p);
    expect(out.audioClips).toHaveLength(1);
    expect('fadeOut' in out.audioClips[0]).toBe(false);
  });

  it('drops trackId: 42 (field removed, clip kept)', () => {
    const clip = validClip({ trackId: 42 as unknown as string });
    const p = project({ audioClips: [clip] });
    const out = sanitizeAudioModel(p);
    expect(out.audioClips).toHaveLength(1);
    expect('trackId' in out.audioClips[0]).toBe(false);
    expect(out.audioClips[0].id).toBe('c1');
  });

  it('drops AudioAsset.duration: Infinity (field removed)', () => {
    const asset = audioAsset({ duration: Infinity });
    const p = project({ assets: [asset] });
    const out = sanitizeAudioModel(p);
    expect(out.assets).toHaveLength(1);
    expect('duration' in out.assets[0]).toBe(false);
  });

  it('leaves a project with NO audioTracks byte-identical (=== same reference)', () => {
    const p = project({ audioClips: [validClip()], assets: [audioAsset()] });
    const out = sanitizeAudioModel(p);
    expect(out).toBe(p);
  });
});

describe('sanitizeAudioModel — non-finite/wrong-typed field replacement (not clampable)', () => {
  it('replaces gain: NaN with the default-track gain (1)', () => {
    const p = project({ audioTracks: [validTrack({ gain: NaN })] });
    const out = sanitizeAudioModel(p);
    expect(out.audioTracks?.[0].gain).toBe(1);
  });

  it('replaces gain: Infinity with the default-track gain (1)', () => {
    const p = project({ audioTracks: [validTrack({ gain: Infinity })] });
    const out = sanitizeAudioModel(p);
    expect(out.audioTracks?.[0].gain).toBe(1);
  });

  it('replaces gain: "0.5" (string) with the default-track gain (1)', () => {
    const p = project({ audioTracks: [validTrack({ gain: '0.5' as unknown as number })] });
    const out = sanitizeAudioModel(p);
    expect(out.audioTracks?.[0].gain).toBe(1);
  });

  it('drops pan: NaN entirely (absent = center)', () => {
    const p = project({ audioTracks: [validTrack({ pan: NaN })] });
    const out = sanitizeAudioModel(p);
    expect('pan' in (out.audioTracks?.[0] ?? {})).toBe(false);
  });

  it('drops pan: "left" (string) entirely', () => {
    const p = project({ audioTracks: [validTrack({ pan: 'left' as unknown as number })] });
    const out = sanitizeAudioModel(p);
    expect('pan' in (out.audioTracks?.[0] ?? {})).toBe(false);
  });

  it('strips the whole filter when frequency: NaN', () => {
    const p = project({
      audioTracks: [validTrack({ filter: { kind: 'lowpass', frequency: NaN } })],
    });
    const out = sanitizeAudioModel(p);
    expect('filter' in (out.audioTracks?.[0] ?? {})).toBe(false);
  });

  it('strips the whole filter when frequency is a string', () => {
    const p = project({
      audioTracks: [
        validTrack({ filter: { kind: 'highpass', frequency: '500' as unknown as number } }),
      ],
    });
    const out = sanitizeAudioModel(p);
    expect('filter' in (out.audioTracks?.[0] ?? {})).toBe(false);
  });

  it('sets muted: false when muted is not a boolean', () => {
    const p = project({ audioTracks: [validTrack({ muted: 'yes' as unknown as boolean })] });
    const out = sanitizeAudioModel(p);
    expect(out.audioTracks?.[0].muted).toBe(false);
  });

  it('sets solo: false when solo is not a boolean', () => {
    const p = project({ audioTracks: [validTrack({ solo: 1 as unknown as boolean })] });
    const out = sanitizeAudioModel(p);
    expect(out.audioTracks?.[0].solo).toBe(false);
  });

  it('sets solo: false when solo is missing entirely', () => {
    const track = validTrack();
    delete (track as Partial<AudioTrack>).solo;
    const p = project({ audioTracks: [track] });
    const out = sanitizeAudioModel(p);
    expect(out.audioTracks?.[0].solo).toBe(false);
  });
});

describe('sanitizeAudioModel — non-array shapes never throw', () => {
  it('drops audioTracks entirely when it is not an array ({}), and does not throw', () => {
    const p = project({ audioTracks: {} as unknown as AudioTrack[] });
    expect(() => sanitizeAudioModel(p)).not.toThrow();
    const out = sanitizeAudioModel(p);
    expect(out.audioTracks).toBeUndefined();
    expect('audioTracks' in out).toBe(false);
  });

  it('leaves audioClips untouched when it is not an array, and does not throw', () => {
    const malformedClips = {} as unknown as AudioClip[];
    const p = project({ audioClips: malformedClips });
    expect(() => sanitizeAudioModel(p)).not.toThrow();
    const out = sanitizeAudioModel(p);
    expect(out.audioClips).toBe(malformedClips);
  });

  it('leaves assets untouched when it is not an array, and does not throw', () => {
    const malformedAssets = {} as unknown as Project['assets'];
    const p = project({ assets: malformedAssets });
    expect(() => sanitizeAudioModel(p)).not.toThrow();
    const out = sanitizeAudioModel(p);
    expect(out.assets).toBe(malformedAssets);
  });
});
