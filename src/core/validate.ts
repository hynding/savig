/** Machine-checkable "is this short sane?" pass — the failure modes an agent hits while authoring.
 *  Pure; returns issues rather than throwing, so an agent can render the list and self-correct. */
import { computeProjectDuration, symbolContains } from '../engine';
import type { Project, Transform2D } from '../engine';

export interface ValidationIssue {
  severity: 'error' | 'warn';
  code: string;
  message: string;
  objectId?: string;
}

const KF_EPS = 1e-6;

export function validateProject(project: Project): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const duration = computeProjectDuration(project);
  const assetIds = new Set(project.assets.map((a) => a.id));
  const objectIds = new Set(project.objects.map((o) => o.id));
  const { width, height } = project.meta;

  for (const o of project.objects) {
    // Dangling references.
    if (!o.isGroup && o.assetId && !assetIds.has(o.assetId)) {
      issues.push({ severity: 'error', code: 'dangling-asset', message: `object "${o.id}" references missing asset "${o.assetId}"`, objectId: o.id });
    }
    if (o.parentId && !objectIds.has(o.parentId)) {
      issues.push({ severity: 'error', code: 'dangling-parent', message: `object "${o.id}" references missing parent "${o.parentId}"`, objectId: o.id });
    }

    // Non-finite base transform.
    for (const [k, v] of Object.entries(o.base) as [keyof Transform2D, number][]) {
      if (!Number.isFinite(v)) {
        issues.push({ severity: 'error', code: 'non-finite-transform', message: `object "${o.id}" base.${k} is not finite`, objectId: o.id });
      }
    }

    // Off-artboard (heuristic on base position; a vector's pivot is its centre so far-outside is suspect).
    if (o.base.x <= -width || o.base.x >= width * 2 || o.base.y <= -height || o.base.y >= height * 2) {
      issues.push({ severity: 'warn', code: 'off-artboard', message: `object "${o.id}" base position (${o.base.x}, ${o.base.y}) is well outside the ${width}×${height} artboard`, objectId: o.id });
    }

    // Track sanity.
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
          issues.push({ severity: 'warn', code: 'keyframe-past-duration', message: `object "${o.id}" track "${prop}" has a keyframe at ${kf.time}s, past the project duration ${duration}s`, objectId: o.id });
        }
        if (kf.time < -KF_EPS) {
          issues.push({ severity: 'error', code: 'negative-keyframe-time', message: `object "${o.id}" track "${prop}" has a keyframe at negative time ${kf.time}s`, objectId: o.id });
        }
      }
    }
  }

  // Symbol cycles (a symbol that transitively contains itself would recurse forever at render).
  for (const a of project.assets) {
    if (a.kind === 'symbol' && symbolContains(a.id, a.id, project.assets)) {
      issues.push({ severity: 'error', code: 'symbol-cycle', message: `symbol "${a.id}" (${a.name}) transitively contains itself` });
    }
  }

  return issues;
}
