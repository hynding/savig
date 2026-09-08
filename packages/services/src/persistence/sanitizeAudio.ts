import type { Asset, AudioAsset, AudioClip, AudioTrack, Project } from '@savig/engine';

/** Global constraints (multitrack audio spec): clamp/strip malformed mixer state so a hand-edited
 *  or foreign-tool-produced .savig / embedded-SVG payload can never push out-of-range values into
 *  WebAudio (gain/pan/frequency nodes throw on invalid values) or the editor UI. Pure; returns the
 *  ORIGINAL `project` reference when nothing needed fixing (parity guard for legacy projects with
 *  no audioTracks — sanitizeAudioModel must be a no-op byte-for-byte, not just deep-equal). */
export function sanitizeAudioModel(project: Project): Project {
  const tracks = project.audioTracks;
  const sanitizedTracks = tracks !== undefined ? sanitizeTracks(tracks) : tracks;
  const sanitizedClips = sanitizeClips(project.audioClips);
  const sanitizedAssets = sanitizeAssets(project.assets);

  if (
    sanitizedTracks === tracks &&
    sanitizedClips === project.audioClips &&
    sanitizedAssets === project.assets
  ) {
    return project;
  }

  const next: Project = { ...project, audioClips: sanitizedClips, assets: sanitizedAssets };
  if (tracks !== undefined) next.audioTracks = sanitizedTracks;
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

  if (isFiniteNumber(out.gain)) {
    const g = clamp(out.gain, 0, 1);
    if (g !== out.gain) {
      out.gain = g;
      changed = true;
    }
  }

  if (out.pan !== undefined && isFiniteNumber(out.pan)) {
    const p = clamp(out.pan, -1, 1);
    if (p !== out.pan) {
      out.pan = p;
      changed = true;
    }
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
    } else if (isFiniteNumber(out.filter.frequency)) {
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
