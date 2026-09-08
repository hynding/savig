import type { Asset, AudioAsset, AudioClip, AudioTrack, Project } from '@savig/engine';

/** Global constraints (multitrack audio spec): clamp/strip malformed mixer state so a hand-edited
 *  or foreign-tool-produced .savig / embedded-SVG payload can never push out-of-range (or
 *  wrong-typed / non-finite) values into WebAudio (gain/pan/frequency AudioParam assignment
 *  THROWS on NaN/Infinity/non-numbers, killing playback) or the editor UI. Pure; returns the
 *  ORIGINAL `project` reference when nothing needed fixing (parity guard for legacy projects with
 *  no audioTracks — sanitizeAudioModel must be a no-op byte-for-byte, not just deep-equal).
 *
 *  Only `audioTracks` is new in v6 and dropped wholesale if malformed (absent is always safe —
 *  every consumer reads it as `tracks ?? []`). `audioClips`/`assets` predate this feature; if
 *  either isn't an array this module leaves it completely untouched rather than inventing new
 *  coercion — a broken clips/assets array is beyond the audio sanitizer's charter, and the
 *  contract is "never throw", not "always produce a valid shape". */
export function sanitizeAudioModel(project: Project): Project {
  const tracks = project.audioTracks;
  const tracksIsArray = Array.isArray(tracks);
  const dropTracksField = tracks !== undefined && !tracksIsArray;
  const sanitizedTracks = tracksIsArray ? sanitizeTracks(tracks) : tracks;

  const clips = project.audioClips;
  const clipsIsArray = Array.isArray(clips);
  const sanitizedClips = clipsIsArray ? sanitizeClips(clips) : clips;

  const assets = project.assets;
  const assetsIsArray = Array.isArray(assets);
  const sanitizedAssets = assetsIsArray ? sanitizeAssets(assets) : assets;

  const tracksChanged = dropTracksField || sanitizedTracks !== tracks;
  const clipsChanged = clipsIsArray && sanitizedClips !== clips;
  const assetsChanged = assetsIsArray && sanitizedAssets !== assets;

  if (!tracksChanged && !clipsChanged && !assetsChanged) {
    return project;
  }

  const next: Project = { ...project };
  if (clipsChanged) next.audioClips = sanitizedClips as AudioClip[];
  if (assetsChanged) next.assets = sanitizedAssets as Asset[];
  if (dropTracksField) {
    delete next.audioTracks;
  } else if (tracksIsArray && sanitizedTracks !== tracks) {
    next.audioTracks = sanitizedTracks;
  }
  return next;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isMalformedTrackEntry(raw: unknown): boolean {
  return typeof raw !== 'object' || raw === null || Array.isArray(raw) || typeof (raw as { id?: unknown }).id !== 'string';
}

function sanitizeTracks(tracks: AudioTrack[]): AudioTrack[] {
  let changed = false;
  const result: AudioTrack[] = [];
  for (const raw of tracks) {
    if (isMalformedTrackEntry(raw)) {
      changed = true;
      continue;
    }
    const sanitized = sanitizeTrack(raw);
    if (sanitized !== raw) changed = true;
    result.push(sanitized);
  }
  return changed ? result : tracks;
}

function sanitizeTrack(track: AudioTrack): AudioTrack {
  let changed = false;
  const out: AudioTrack = { ...track };

  if (typeof out.name === 'string' && out.name.length > 120) {
    out.name = out.name.slice(0, 120);
    changed = true;
  }

  // Non-finite/wrong-typed gain can't be clamped (NaN/strings have no min/max) — replace with
  // the default-track gain rather than let it reach an AudioParam and throw.
  if (!isFiniteNumber(out.gain)) {
    out.gain = 1;
    changed = true;
  } else {
    const g = clamp(out.gain, 0, 1);
    if (g !== out.gain) {
      out.gain = g;
      changed = true;
    }
  }

  if (out.pan !== undefined) {
    if (!isFiniteNumber(out.pan)) {
      // Non-finite/wrong-typed pan: drop the field entirely (absent = 0/center), same reasoning
      // as gain but pan is optional so "absent" is itself a valid, meaningful default.
      delete out.pan;
      changed = true;
    } else {
      const p = clamp(out.pan, -1, 1);
      if (p !== out.pan) {
        out.pan = p;
        changed = true;
      }
    }
  }

  if (typeof out.muted !== 'boolean') {
    out.muted = false;
    changed = true;
  }
  if (typeof out.solo !== 'boolean') {
    out.solo = false;
    changed = true;
  }

  if (out.filter !== undefined) {
    const filter = out.filter as unknown;
    const kindOk =
      typeof filter === 'object' &&
      filter !== null &&
      ((filter as { kind?: unknown }).kind === 'lowpass' || (filter as { kind?: unknown }).kind === 'highpass');
    if (!kindOk) {
      delete out.filter;
      changed = true;
    } else if (!isFiniteNumber((filter as { frequency?: unknown }).frequency)) {
      // Non-finite/wrong-typed frequency can't be clamped either — strip the whole filter field,
      // same treatment as an unknown kind (a filter with no usable frequency is not a bypass).
      delete out.filter;
      changed = true;
    } else {
      const f = clamp(out.filter.frequency, 10, 24000);
      if (f !== out.filter.frequency) {
        out.filter = { ...out.filter, frequency: f };
        changed = true;
      }
    }
  }

  return changed ? out : track;
}

function sanitizeClips(clips: AudioClip[]): AudioClip[] {
  let changed = false;
  const result = clips.map((clip) => {
    const sanitized = sanitizeClip(clip);
    if (sanitized !== clip) changed = true;
    return sanitized;
  });
  return changed ? result : clips;
}

function sanitizeClip(clip: AudioClip): AudioClip {
  let changed = false;
  const out: AudioClip = { ...clip };

  if (out.trackId !== undefined && typeof out.trackId !== 'string') {
    delete out.trackId;
    changed = true;
  }

  if (out.fadeIn !== undefined && !(isFiniteNumber(out.fadeIn) && out.fadeIn >= 0)) {
    delete out.fadeIn;
    changed = true;
  }

  if (out.fadeOut !== undefined && !(isFiniteNumber(out.fadeOut) && out.fadeOut >= 0)) {
    delete out.fadeOut;
    changed = true;
  }

  return changed ? out : clip;
}

function sanitizeAssets(assets: Asset[]): Asset[] {
  let changed = false;
  const result = assets.map((asset) => {
    const sanitized = sanitizeAsset(asset);
    if (sanitized !== asset) changed = true;
    return sanitized;
  });
  return changed ? result : assets;
}

function sanitizeAsset(asset: Asset): Asset {
  if (asset.kind !== 'audio') return asset;
  const audio = asset as AudioAsset;
  if (audio.duration === undefined || (isFiniteNumber(audio.duration) && audio.duration >= 0)) {
    return asset;
  }
  const out = { ...audio };
  delete out.duration;
  return out;
}
