/** Machine-checkable "is this short sane?" pass — the failure modes an agent hits while authoring.
 *  Pure; returns issues rather than throwing, so an agent can render the list and self-correct. */
import { projectScenes, symbolContains } from '@savig/engine';
import type { Project, Scene, SceneObject, Transform2D } from '@savig/engine';

export interface ValidationIssue {
  severity: 'error' | 'warn';
  code: string;
  message: string;
  objectId?: string;
}

const KF_EPS = 1e-6;

interface SceneCtx { assetIds: Set<string>; width: number; height: number; duration: number; }

function validateSceneObjects(objects: SceneObject[], ctx: SceneCtx, issues: ValidationIssue[]): void {
  const { assetIds, width, height, duration } = ctx;
  const objectIds = new Set(objects.map((o) => o.id));
  for (const o of objects) {
    if (!o.isGroup && o.assetId && !assetIds.has(o.assetId)) {
      issues.push({ severity: 'error', code: 'dangling-asset', message: `object "${o.id}" references missing asset "${o.assetId}"`, objectId: o.id });
    }
    if (o.parentId && !objectIds.has(o.parentId)) {
      issues.push({ severity: 'error', code: 'dangling-parent', message: `object "${o.id}" references missing parent "${o.parentId}"`, objectId: o.id });
    }
    for (const [k, v] of Object.entries(o.base) as [keyof Transform2D, number][]) {
      if (!Number.isFinite(v)) {
        issues.push({ severity: 'error', code: 'non-finite-transform', message: `object "${o.id}" base.${k} is not finite`, objectId: o.id });
      }
    }
    if (o.base.x <= -width || o.base.x >= width * 2 || o.base.y <= -height || o.base.y >= height * 2) {
      issues.push({ severity: 'warn', code: 'off-artboard', message: `object "${o.id}" base position (${o.base.x}, ${o.base.y}) is well outside the ${width}×${height} artboard`, objectId: o.id });
    }
    if (o.repeat) {
      const { count, dx, dy, rotate, scale, stagger } = o.repeat;
      if (!Number.isInteger(count) || count < 2 || count > 64) {
        issues.push({ severity: 'error', code: 'repeat-count-out-of-range', message: `object "${o.id}" repeat.count ${count} is not an integer in [2, 64]`, objectId: o.id });
      }
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(rotate)) {
        issues.push({ severity: 'error', code: 'repeat-non-finite', message: `object "${o.id}" repeat has a non-finite dx/dy/rotate`, objectId: o.id });
      }
      if (!Number.isFinite(scale) || scale < 0.01 || scale > 100) {
        issues.push({ severity: 'error', code: 'repeat-scale-out-of-range', message: `object "${o.id}" repeat.scale ${scale} is not in [0.01, 100]`, objectId: o.id });
      }
      if (!Number.isFinite(stagger) || stagger < 0) {
        issues.push({ severity: 'error', code: 'repeat-stagger-invalid', message: `object "${o.id}" repeat.stagger ${stagger} must be finite and >= 0`, objectId: o.id });
      }
    }
    for (const [prop, track] of Object.entries(o.tracks)) {
      if (!track || track.length === 0) continue;
      if (track.length === 1) {
        issues.push({ severity: 'warn', code: 'single-keyframe', message: `object "${o.id}" track "${prop}" has a single keyframe (no animation — use the base transform instead)`, objectId: o.id });
      }
      for (const kf of track) {
        if (!Number.isFinite(kf.value)) {
          issues.push({ severity: 'error', code: 'non-finite-keyframe', message: `object "${o.id}" track "${prop}" has a non-finite keyframe value`, objectId: o.id });
        }
        if (kf.time > duration + KF_EPS) {
          issues.push({ severity: 'warn', code: 'keyframe-past-duration', message: `object "${o.id}" track "${prop}" has a keyframe at ${kf.time}s, past the duration ${duration}s`, objectId: o.id });
        }
        if (kf.time < -KF_EPS) {
          issues.push({ severity: 'error', code: 'negative-keyframe-time', message: `object "${o.id}" track "${prop}" has a keyframe at negative time ${kf.time}s`, objectId: o.id });
        }
      }
    }
  }
}

function validateScenes(scenes: Scene[], issues: ValidationIssue[]): void {
  if (scenes.length === 0) {
    issues.push({ severity: 'error', code: 'empty-scenes', message: 'project.scenes is present but empty' });
    return;
  }
  const seen = new Set<string>();
  scenes.forEach((s, i) => {
    if (s.duration <= 0) {
      issues.push({ severity: 'error', code: 'scene-nonpositive-duration', message: `scene "${s.id}" has non-positive duration ${s.duration}` });
    }
    if (seen.has(s.id)) {
      issues.push({ severity: 'error', code: 'duplicate-scene-id', message: `duplicate scene id "${s.id}"` });
    }
    seen.add(s.id);
    if (s.transitionIn && i === 0) {
      issues.push({ severity: 'warn', code: 'transition-on-first-scene', message: `scene "${s.id}" has a transitionIn but is first (ignored)` });
    }
    if (s.transitionIn && s.transitionIn.kind !== 'cut' && i > 0) {
      const d = s.transitionIn.duration;
      if (d > s.duration + KF_EPS || d > scenes[i - 1].duration + KF_EPS) {
        issues.push({ severity: 'warn', code: 'transition-too-long', message: `scene "${s.id}" transition (${d}s) exceeds an adjacent scene's duration` });
      }
    }
  });
}

/** Project-level (master-timeline) audio checks — audio is NOT scene-scoped (`Project.audioClips`/
 *  `audioTracks` are a single global mixer regardless of `scenes`), so this runs once against the
 *  whole project rather than per-scene. Builders are pure (no clamping), so this is the ONLY place
 *  an out-of-range gain/pan/frequency or a bad clip window surfaces to an agent. */
function validateAudio(project: Project, issues: ValidationIssue[]): void {
  const assets = new Map(project.assets.map((a) => [a.id, a]));
  const tracks = project.audioTracks ?? [];
  const trackIds = new Set(tracks.map((t) => t.id));

  for (const c of project.audioClips) {
    const asset = assets.get(c.assetId);
    if (!asset || asset.kind !== 'audio') {
      issues.push({ severity: 'error', code: 'dangling-audio-asset', message: `audio clip "${c.id}" references a missing or non-audio asset "${c.assetId}"`, objectId: c.id });
    }
    if (c.trackId && !trackIds.has(c.trackId)) {
      issues.push({ severity: 'warn', code: 'dangling-audio-track', message: `audio clip "${c.id}" references missing track "${c.trackId}" — plays on the default lane`, objectId: c.id });
    }
    const maxOut = asset?.kind === 'audio' ? asset.duration : undefined;
    if (c.inPoint < 0 || c.outPoint < 0 || c.inPoint >= c.outPoint || (maxOut !== undefined && c.outPoint > maxOut)) {
      issues.push({ severity: 'error', code: 'audio-clip-window', message: `audio clip "${c.id}" has an invalid in/out window (in=${c.inPoint}, out=${c.outPoint}${maxOut !== undefined ? `, asset duration=${maxOut}` : ''})`, objectId: c.id });
    }
    const len = c.outPoint - c.inPoint;
    for (const key of ['fadeIn', 'fadeOut'] as const) {
      const v = c[key];
      if (v !== undefined && len > 0 && v > len) {
        issues.push({ severity: 'warn', code: 'audio-fade-too-long', message: `audio clip "${c.id}" ${key} ${v}s exceeds its clip length ${len}s (clamps at runtime)`, objectId: c.id });
      }
    }
    if (c.volume < 0 || c.volume > 1) {
      issues.push({ severity: 'error', code: 'audio-volume-range', message: `audio clip "${c.id}" volume ${c.volume} is not in [0, 1]`, objectId: c.id });
    }
  }

  for (const t of tracks) {
    if (t.gain < 0 || t.gain > 1) {
      issues.push({ severity: 'error', code: 'audio-gain-range', message: `audio track "${t.id}" gain ${t.gain} is not in [0, 1]`, objectId: t.id });
    }
    if (t.pan !== undefined && (t.pan < -1 || t.pan > 1)) {
      issues.push({ severity: 'error', code: 'audio-pan-range', message: `audio track "${t.id}" pan ${t.pan} is not in [-1, 1]`, objectId: t.id });
    }
    if (t.filter && (t.filter.frequency < 10 || t.filter.frequency > 24000)) {
      issues.push({ severity: 'error', code: 'audio-filter-frequency-range', message: `audio track "${t.id}" filter frequency ${t.filter.frequency}Hz is not in [10, 24000]`, objectId: t.id });
    }
  }
}

export function validateProject(project: Project): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const assetIds = new Set(project.assets.map((a) => a.id));
  const { width, height } = project.meta;

  // Source-of-truth invariant (§3): scenes present ⇒ root objects must be empty.
  if (project.scenes && project.objects.length > 0) {
    issues.push({ severity: 'error', code: 'scenes-objects-conflict', message: 'project.scenes is present but project.objects is non-empty (source-of-truth violation)' });
  }

  for (const scene of projectScenes(project)) {
    const ctx: SceneCtx = { assetIds, width, height, duration: scene.duration };
    validateSceneObjects(scene.objects, ctx, issues);
  }

  // Symbol cycles (project-global, unchanged).
  for (const a of project.assets) {
    if (a.kind === 'symbol' && symbolContains(a.id, a.id, project.assets)) {
      issues.push({ severity: 'error', code: 'symbol-cycle', message: `symbol "${a.id}" (${a.name}) transitively contains itself` });
    }
  }

  // Scene-level checks (only when truly multi-scene).
  if (project.scenes) validateScenes(project.scenes, issues);

  // Audio is project-level (the master timeline), not scene-scoped — validate it once regardless
  // of scenes.
  validateAudio(project, issues);

  return issues;
}
