/** Machine-checkable "is this short sane?" pass — the failure modes an agent hits while authoring.
 *  Pure; returns issues rather than throwing, so an agent can render the list and self-correct. */
import { projectScenes, symbolContains } from '../engine';
import type { Project, Scene, SceneObject, Transform2D } from '../engine';

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

  return issues;
}
