// Covers: addAudioTrack names sequentially; setAudioTrackProps merge + filter:null/pan:0 clear;
// removeAudioTrack strips trackId from its clips; addAudioClip uses asset.duration (the defect
// fix) and 0 when absent; setAudioClipTiming clamps in<out<=duration & startTime>=0;
// setAudioClipFades clamps to clip length and deletes on 0; setAudioClipTrack null clears;
// removeAudioClip; undo restores prior audioTracks AND audioClips for every action (they all go
// through commit()).
import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '../store';
import { createProject } from '@savig/engine';

beforeEach(() => {
  store.getState().newProject();
});

function withAudioAsset(duration?: number) {
  const project = store.getState().history.present;
  store.getState().setProject({
    ...project,
    assets: [{ id: 'a1', kind: 'audio', name: 'x.wav', mimeType: 'audio/wav', ...(duration !== undefined ? { duration } : {}) }],
  });
}

describe('addAudioTrack', () => {
  it('names sequentially', () => {
    store.getState().addAudioTrack();
    store.getState().addAudioTrack();
    const tracks = store.getState().history.present.audioTracks!;
    expect(tracks).toHaveLength(2);
    expect(tracks[0].name).toBe('Audio 1');
    expect(tracks[1].name).toBe('Audio 2');
  });

  it('seeds gain 1, unmuted, un-soloed', () => {
    store.getState().addAudioTrack();
    const track = store.getState().history.present.audioTracks![0];
    expect(track.gain).toBe(1);
    expect(track.muted).toBe(false);
    expect(track.solo).toBe(false);
  });
});

describe('renameAudioTrack', () => {
  it('renames the matching track only', () => {
    store.getState().addAudioTrack();
    store.getState().addAudioTrack();
    const [t1, t2] = store.getState().history.present.audioTracks!;
    store.getState().renameAudioTrack(t1.id, 'Music');
    const tracks = store.getState().history.present.audioTracks!;
    expect(tracks.find((t) => t.id === t1.id)!.name).toBe('Music');
    expect(tracks.find((t) => t.id === t2.id)!.name).toBe('Audio 2');
  });
});

describe('setAudioTrackProps', () => {
  it('merges provided fields, leaving others untouched', () => {
    store.getState().addAudioTrack();
    const id = store.getState().history.present.audioTracks![0].id;
    store.getState().setAudioTrackProps(id, { muted: true });
    let track = store.getState().history.present.audioTracks!.find((t) => t.id === id)!;
    expect(track.muted).toBe(true);
    expect(track.gain).toBe(1);
    store.getState().setAudioTrackProps(id, { gain: 0.5 });
    track = store.getState().history.present.audioTracks!.find((t) => t.id === id)!;
    expect(track.gain).toBe(0.5);
    expect(track.muted).toBe(true);
  });

  it('clamps gain to [0,1]', () => {
    store.getState().addAudioTrack();
    const id = store.getState().history.present.audioTracks![0].id;
    store.getState().setAudioTrackProps(id, { gain: 5 });
    expect(store.getState().history.present.audioTracks!.find((t) => t.id === id)!.gain).toBe(1);
    store.getState().setAudioTrackProps(id, { gain: -5 });
    expect(store.getState().history.present.audioTracks!.find((t) => t.id === id)!.gain).toBe(0);
  });

  it('sets and clamps pan, and pan:0 clears the field', () => {
    store.getState().addAudioTrack();
    const id = store.getState().history.present.audioTracks![0].id;
    store.getState().setAudioTrackProps(id, { pan: 0.7 });
    expect(store.getState().history.present.audioTracks!.find((t) => t.id === id)!.pan).toBe(0.7);
    store.getState().setAudioTrackProps(id, { pan: 5 });
    expect(store.getState().history.present.audioTracks!.find((t) => t.id === id)!.pan).toBe(1);
    store.getState().setAudioTrackProps(id, { pan: 0 });
    expect(store.getState().history.present.audioTracks!.find((t) => t.id === id)!.pan).toBeUndefined();
  });

  it('sets a filter and filter:null clears it', () => {
    store.getState().addAudioTrack();
    const id = store.getState().history.present.audioTracks![0].id;
    store.getState().setAudioTrackProps(id, { filter: { kind: 'lowpass', frequency: 800 } });
    expect(store.getState().history.present.audioTracks!.find((t) => t.id === id)!.filter).toEqual({ kind: 'lowpass', frequency: 800 });
    store.getState().setAudioTrackProps(id, { filter: null });
    expect(store.getState().history.present.audioTracks!.find((t) => t.id === id)!.filter).toBeUndefined();
  });
});

describe('removeAudioTrack', () => {
  it('removes the track and strips trackId from its clips (default lane)', () => {
    withAudioAsset(3);
    store.getState().addAudioTrack();
    const trackId = store.getState().history.present.audioTracks![0].id;
    store.getState().addAudioClip('a1');
    const clipId = store.getState().history.present.audioClips[0].id;
    store.getState().setAudioClipTrack(clipId, trackId);
    expect(store.getState().history.present.audioClips[0].trackId).toBe(trackId);

    store.getState().removeAudioTrack(trackId);
    expect(store.getState().history.present.audioTracks).toBeUndefined();
    expect(store.getState().history.present.audioClips[0].trackId).toBeUndefined();
  });

  it('leaves remaining tracks present when others still exist', () => {
    store.getState().addAudioTrack();
    store.getState().addAudioTrack();
    const [t1, t2] = store.getState().history.present.audioTracks!;
    store.getState().removeAudioTrack(t1.id);
    const tracks = store.getState().history.present.audioTracks!;
    expect(tracks).toHaveLength(1);
    expect(tracks[0].id).toBe(t2.id);
  });
});

describe('addAudioClip', () => {
  it('uses the asset duration (defect fix)', () => {
    withAudioAsset(3.5);
    store.getState().addAudioClip('a1');
    const clip = store.getState().history.present.audioClips[0];
    expect(clip.outPoint).toBe(3.5);
    expect(clip.inPoint).toBe(0);
  });

  it('falls back to 0 when the asset has no duration', () => {
    withAudioAsset(undefined);
    store.getState().addAudioClip('a1');
    const clip = store.getState().history.present.audioClips[0];
    expect(clip.outPoint).toBe(0);
    expect(clip.inPoint).toBe(0);
  });

  it('places the clip at the current playhead', () => {
    withAudioAsset(3.5);
    store.getState().seek(2);
    store.getState().addAudioClip('a1');
    expect(store.getState().history.present.audioClips[0].startTime).toBe(2);
  });
});

describe('setAudioClipTiming', () => {
  it('clamps inPoint/outPoint to [0, asset.duration]', () => {
    withAudioAsset(3);
    store.getState().addAudioClip('a1');
    const clipId = store.getState().history.present.audioClips[0].id;
    store.getState().setAudioClipTiming(clipId, { inPoint: -1, outPoint: 10 });
    const clip = store.getState().history.present.audioClips[0];
    expect(clip.inPoint).toBe(0);
    expect(clip.outPoint).toBe(3);
  });

  it('keeps inPoint strictly less than outPoint', () => {
    withAudioAsset(3);
    store.getState().addAudioClip('a1');
    const clipId = store.getState().history.present.audioClips[0].id;
    store.getState().setAudioClipTiming(clipId, { inPoint: 2, outPoint: 2 });
    const clip = store.getState().history.present.audioClips[0];
    expect(clip.outPoint).toBeGreaterThan(clip.inPoint);
  });

  it('clamps startTime to >= 0', () => {
    withAudioAsset(3);
    store.getState().addAudioClip('a1');
    const clipId = store.getState().history.present.audioClips[0].id;
    store.getState().setAudioClipTiming(clipId, { startTime: -5 });
    expect(store.getState().history.present.audioClips[0].startTime).toBe(0);
  });

  // Regression (review finding): outPoint must clamp to asset.duration FIRST, so a wildly
  // overshooting inPoint request can never push outPoint past the asset's real length — the
  // old clamp order (inPoint first) let outPoint land at max + epsilon once inPoint hit the
  // ceiling, violating 0 <= inPoint < outPoint <= asset.duration.
  it('driving inPoint past asset.duration clamps outPoint to duration, not duration + epsilon', () => {
    withAudioAsset(3);
    store.getState().addAudioClip('a1'); // outPoint=3, inPoint=0
    store.getState().setAudioClipTiming(store.getState().history.present.audioClips[0].id, { inPoint: 10 });
    const clip = store.getState().history.present.audioClips[0];
    expect(clip.outPoint).toBe(3); // stays exactly at asset.duration, never 3.001
    expect(clip.outPoint).toBeLessThanOrEqual(3);
    expect(clip.inPoint).toBeCloseTo(3 - 1e-3, 6); // pinned to outPoint - epsilon
    expect(clip.inPoint).toBeLessThan(clip.outPoint);
  });

  // Regression (2nd-round review finding): the round-1 fix ("clamp outPoint to [0,max] then
  // inPoint to [0, outPoint - eps]") broke the LOW end — a right-edge trim dragging outPoint to
  // 0 (or negative) forced inPoint to 0 too, making inPoint === outPoint === 0. outPoint must
  // instead floor at epsilon (for a non-degenerate asset) so the strict inequality always holds.
  it('driving outPoint to 0 or negative on a normal (non-zero-duration) asset floors it at epsilon', () => {
    withAudioAsset(3);
    store.getState().addAudioClip('a1'); // outPoint=3, inPoint=0
    store.getState().setAudioClipTiming(store.getState().history.present.audioClips[0].id, { outPoint: -5 });
    const clip = store.getState().history.present.audioClips[0];
    expect(clip.outPoint).toBeCloseTo(1e-3, 6); // floored at epsilon, not driven to 0
    expect(clip.inPoint).toBe(0);
    expect(clip.inPoint).toBeLessThan(clip.outPoint); // strict inequality holds
  });

  it('driving BOTH inPoint and outPoint past both bounds in one call still holds the invariant', () => {
    withAudioAsset(3);
    store.getState().addAudioClip('a1');
    const clipId = store.getState().history.present.audioClips[0].id;
    store.getState().setAudioClipTiming(clipId, { inPoint: 999, outPoint: -999 });
    const clip = store.getState().history.present.audioClips[0];
    expect(clip.outPoint).toBeGreaterThanOrEqual(0);
    expect(clip.outPoint).toBeLessThanOrEqual(3);
    expect(clip.inPoint).toBeGreaterThanOrEqual(0);
    expect(clip.inPoint).toBeLessThan(clip.outPoint);
  });

  it('has no cap when the asset has no duration', () => {
    withAudioAsset(undefined);
    store.getState().addAudioClip('a1');
    const clipId = store.getState().history.present.audioClips[0].id;
    store.getState().setAudioClipTiming(clipId, { outPoint: 999 });
    expect(store.getState().history.present.audioClips[0].outPoint).toBe(999);
  });
});

describe('setAudioClipTrack', () => {
  it('assigns and null clears back to the default lane', () => {
    withAudioAsset(3);
    store.getState().addAudioTrack();
    const trackId = store.getState().history.present.audioTracks![0].id;
    store.getState().addAudioClip('a1');
    const clipId = store.getState().history.present.audioClips[0].id;
    store.getState().setAudioClipTrack(clipId, trackId);
    expect(store.getState().history.present.audioClips[0].trackId).toBe(trackId);
    store.getState().setAudioClipTrack(clipId, null);
    expect(store.getState().history.present.audioClips[0].trackId).toBeUndefined();
  });
});

describe('setAudioClipFades', () => {
  it('clamps fadeIn/fadeOut to the clip length', () => {
    withAudioAsset(10);
    store.getState().addAudioClip('a1'); // outPoint 10, inPoint 0 -> length 10
    const clipId = store.getState().history.present.audioClips[0].id;
    store.getState().setAudioClipTiming(clipId, { outPoint: 4 }); // length 4
    store.getState().setAudioClipFades(clipId, { fadeIn: 999 });
    expect(store.getState().history.present.audioClips[0].fadeIn).toBe(4);
  });

  it('deletes the field when set to 0', () => {
    withAudioAsset(10);
    store.getState().addAudioClip('a1');
    const clipId = store.getState().history.present.audioClips[0].id;
    store.getState().setAudioClipFades(clipId, { fadeIn: 2, fadeOut: 3 });
    expect(store.getState().history.present.audioClips[0].fadeIn).toBe(2);
    expect(store.getState().history.present.audioClips[0].fadeOut).toBe(3);
    store.getState().setAudioClipFades(clipId, { fadeIn: 0 });
    const clip = store.getState().history.present.audioClips[0];
    expect(clip.fadeIn).toBeUndefined();
    expect(clip.fadeOut).toBe(3);
  });
});

describe('removeAudioClip', () => {
  it('removes the clip', () => {
    withAudioAsset(3);
    store.getState().addAudioClip('a1');
    const clipId = store.getState().history.present.audioClips[0].id;
    store.getState().removeAudioClip(clipId);
    expect(store.getState().history.present.audioClips).toHaveLength(0);
  });
});

describe('undo restores prior audioTracks and audioClips', () => {
  it('undoes addAudioTrack', () => {
    store.getState().addAudioTrack();
    store.getState().undo();
    expect(store.getState().history.present.audioTracks).toBeUndefined();
  });

  it('undoes renameAudioTrack', () => {
    store.getState().addAudioTrack();
    const id = store.getState().history.present.audioTracks![0].id;
    store.getState().renameAudioTrack(id, 'Music');
    store.getState().undo();
    expect(store.getState().history.present.audioTracks![0].name).toBe('Audio 1');
  });

  it('undoes setAudioTrackProps', () => {
    store.getState().addAudioTrack();
    const id = store.getState().history.present.audioTracks![0].id;
    store.getState().setAudioTrackProps(id, { muted: true });
    store.getState().undo();
    expect(store.getState().history.present.audioTracks![0].muted).toBe(false);
  });

  it('undoes removeAudioTrack (tracks AND the stripped clip trackId)', () => {
    withAudioAsset(3);
    store.getState().addAudioTrack();
    const trackId = store.getState().history.present.audioTracks![0].id;
    store.getState().addAudioClip('a1');
    const clipId = store.getState().history.present.audioClips[0].id;
    store.getState().setAudioClipTrack(clipId, trackId);
    store.getState().removeAudioTrack(trackId);
    store.getState().undo();
    expect(store.getState().history.present.audioTracks).toHaveLength(1);
    expect(store.getState().history.present.audioClips[0].trackId).toBe(trackId);
  });

  it('undoes addAudioClip', () => {
    withAudioAsset(3);
    store.getState().addAudioClip('a1');
    store.getState().undo();
    expect(store.getState().history.present.audioClips).toHaveLength(0);
  });

  it('undoes setAudioClipTiming', () => {
    withAudioAsset(3);
    store.getState().addAudioClip('a1');
    const clipId = store.getState().history.present.audioClips[0].id;
    store.getState().setAudioClipTiming(clipId, { outPoint: 1 });
    store.getState().undo();
    expect(store.getState().history.present.audioClips[0].outPoint).toBe(3);
  });

  it('undoes setAudioClipTrack', () => {
    withAudioAsset(3);
    store.getState().addAudioTrack();
    const trackId = store.getState().history.present.audioTracks![0].id;
    store.getState().addAudioClip('a1');
    const clipId = store.getState().history.present.audioClips[0].id;
    store.getState().setAudioClipTrack(clipId, trackId);
    store.getState().undo();
    expect(store.getState().history.present.audioClips[0].trackId).toBeUndefined();
  });

  it('undoes setAudioClipFades', () => {
    withAudioAsset(3);
    store.getState().addAudioClip('a1');
    const clipId = store.getState().history.present.audioClips[0].id;
    store.getState().setAudioClipFades(clipId, { fadeIn: 1 });
    store.getState().undo();
    expect(store.getState().history.present.audioClips[0].fadeIn).toBeUndefined();
  });

  it('undoes removeAudioClip', () => {
    withAudioAsset(3);
    store.getState().addAudioClip('a1');
    store.getState().removeAudioClip(store.getState().history.present.audioClips[0].id);
    store.getState().undo();
    expect(store.getState().history.present.audioClips).toHaveLength(1);
  });
});

// Sanity: createProject's default project has no audioTracks (parity with pre-feature projects).
it('a fresh project has no audioTracks', () => {
  expect(createProject().audioTracks).toBeUndefined();
});
