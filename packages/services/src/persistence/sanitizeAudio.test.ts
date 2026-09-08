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
