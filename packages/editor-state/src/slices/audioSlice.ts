// Multitrack audio: mixer lanes (AudioTrack) + per-clip timing/fades/lane assignment. Mirrors
// transportPrefsSlice.ts's structure. Every action reads the whole state via `get()` and commits
// a full next Project via `get().commit(...)` (undoable, like every other document mutation).
import { newId } from '@savig/engine';
import type { AudioClip, AudioFilter, Project } from '@savig/engine';
import type { SliceCreator } from '../store-internals';

// Parameter-position destructuring (not a local variable) so the dropped key's eslint
// no-unused-vars is covered by the shared `argsIgnorePattern: '^_'` rule — mirrors
// store-internals.ts's `dropTrimAndDash`.
function omitAudioTracks({ audioTracks: _dropped, ...rest }: Project): Omit<Project, 'audioTracks'> {
  return rest;
}
function omitClipTrackId({ trackId: _dropped, ...rest }: AudioClip): AudioClip {
  return rest;
}

type AudioKeys =
  | 'addAudioTrack' | 'renameAudioTrack' | 'setAudioTrackProps' | 'removeAudioTrack'
  | 'addAudioClip' | 'setAudioClipTiming' | 'setAudioClipTrack' | 'setAudioClipFades'
  | 'removeAudioClip';

export const createAudioSlice: SliceCreator<AudioKeys> = (_set, get) => ({
  addAudioTrack() {
    const project = get().history.present;
    const tracks = project.audioTracks ?? [];
    const track = { id: newId(), name: `Audio ${tracks.length + 1}`, gain: 1, muted: false, solo: false };
    get().commit({ ...project, audioTracks: [...tracks, track] });
  },
  renameAudioTrack(trackId, name) {
    const project = get().history.present;
    get().commit({
      ...project,
      audioTracks: (project.audioTracks ?? []).map((t) => (t.id === trackId ? { ...t, name } : t)),
    });
  },
  setAudioTrackProps(trackId, props) {
    const project = get().history.present;
    get().commit({
      ...project,
      audioTracks: (project.audioTracks ?? []).map((t) => {
        if (t.id !== trackId) return t;
        const { pan, filter, ...rest } = props;
        const next = { ...t, ...rest };
        if (pan !== undefined) {
          if (pan === 0) delete next.pan;
          else next.pan = Math.max(-1, Math.min(1, pan));
        }
        if (filter !== undefined) {
          if (filter === null) delete next.filter;
          else next.filter = filter as AudioFilter;
        }
        if (next.gain !== undefined) next.gain = Math.max(0, Math.min(1, next.gain));
        return next;
      }),
    });
  },
  removeAudioTrack(trackId) {
    const project = get().history.present;
    const remaining = (project.audioTracks ?? []).filter((t) => t.id !== trackId);
    get().commit({
      ...omitAudioTracks(project),
      ...(remaining.length ? { audioTracks: remaining } : {}), // absent stays absent
      audioClips: project.audioClips.map((c) => (c.trackId === trackId ? omitClipTrackId(c) : c)),
    });
  },
  addAudioClip(assetId) {
    const project = get().history.present;
    const asset = project.assets.find((a) => a.id === assetId);
    const duration = asset?.kind === 'audio' ? (asset.duration ?? 0) : 0;
    const clip = { id: newId(), assetId, startTime: get().time, inPoint: 0, outPoint: duration, volume: 1 };
    get().commit({ ...project, audioClips: [...project.audioClips, clip] });
  },
  setAudioClipTiming(clipId, timing) {
    const project = get().history.present;
    get().commit({
      ...project,
      audioClips: project.audioClips.map((c) => {
        if (c.id !== clipId) return c;
        const asset = project.assets.find((a) => a.id === c.assetId);
        const max = asset?.kind === 'audio' && asset.duration !== undefined ? asset.duration : Infinity;
        const startTime = Math.max(0, timing.startTime ?? c.startTime);
        const inPoint = Math.max(0, Math.min(timing.inPoint ?? c.inPoint, max));
        const outPoint = Math.max(inPoint + 1e-3, Math.min(timing.outPoint ?? c.outPoint, max));
        return { ...c, startTime, inPoint, outPoint };
      }),
    });
  },
  setAudioClipTrack(clipId, trackId) {
    const project = get().history.present;
    get().commit({
      ...project,
      audioClips: project.audioClips.map((c) => {
        if (c.id !== clipId) return c;
        if (trackId === null) return omitClipTrackId(c);
        return { ...c, trackId };
      }),
    });
  },
  setAudioClipFades(clipId, fades) {
    const project = get().history.present;
    get().commit({
      ...project,
      audioClips: project.audioClips.map((c) => {
        if (c.id !== clipId) return c;
        const len = c.outPoint - c.inPoint;
        const next = { ...c };
        for (const key of ['fadeIn', 'fadeOut'] as const) {
          const v = fades[key];
          if (v === undefined) continue;
          const clamped = Math.max(0, Math.min(v, len));
          if (clamped === 0) delete next[key];
          else next[key] = clamped;
        }
        return next;
      }),
    });
  },
  removeAudioClip(clipId) {
    const project = get().history.present;
    get().commit({ ...project, audioClips: project.audioClips.filter((c) => c.id !== clipId) });
  },
});
