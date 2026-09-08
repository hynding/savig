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
  | 'removeAudioClip' | 'selectAudioTrack';

export const createAudioSlice: SliceCreator<AudioKeys> = (set, get) => ({
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
          // Clamp frequency at the data layer (not just the Inspector's input `max`/`min`) so
          // every caller — DSL/MCP, direct action calls, future UI — gets the same guarantee.
          else next.filter = { ...filter, frequency: Math.max(10, Math.min(24000, filter.frequency)) } as AudioFilter;
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
    // Clear a dangling selection pointing at the just-removed track (transient, not part of
    // the commit above).
    if (get().selectedAudioTrackId === trackId) set({ selectedAudioTrackId: null });
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
        // outPoint clamps to [0, maxOut] FIRST — the invariant outPoint <= asset.duration wins
        // over an unclamped inPoint/outPoint push from either edge of a trim drag. It also
        // FLOORS at epsilon (not 0) so inPoint < outPoint keeps holding even when a right-edge
        // trim drags outPoint all the way down to (or past) 0 — the earlier "clamp outPoint to
        // [0, max] then inPoint to [0, outPoint - eps]" order broke down exactly there (outPoint
        // -> 0 forced inPoint -> 0 too, violating the strict inequality). The floor collapses to
        // 0 only for a zero-duration asset (min(eps, maxOut) = 0), matching addAudioClip's
        // existing in=0/out=0 behavior for that degenerate case — not something to "fix" here.
        const maxOut = asset?.kind === 'audio' && asset.duration !== undefined ? asset.duration : Infinity;
        const EPS = 1e-3;
        const startTime = Math.max(0, timing.startTime ?? c.startTime);
        const outCandidate = timing.outPoint ?? c.outPoint;
        const inCandidate = timing.inPoint ?? c.inPoint;
        const outPoint = Math.min(Math.max(outCandidate, Math.min(EPS, maxOut)), maxOut);
        const inPoint = Math.min(Math.max(0, inCandidate), Math.max(0, outPoint - EPS));
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
  selectAudioTrack(trackId) {
    set({ selectedAudioTrackId: trackId });
  },
});
