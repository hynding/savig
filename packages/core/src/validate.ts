/** Machine-checkable "is this short sane?" pass — the failure modes an agent hits while authoring.
 *  Pure; returns issues rather than throwing, so an agent can render the list and self-correct. */
import { parse, projectScenes, symbolContains } from '@savig/engine';
import type { Behavior, BehaviorAction, Expr, Project, Scene, SceneObject, Transform2D } from '@savig/engine';

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

// --- M9 interactivity/scripting validation (spec §8) --------------------------------------------

const POINTER_EVENTS = new Set(['click', 'pointerdown', 'pointerup', 'hoverEnter', 'hoverLeave']);
const GLOBAL_EVENTS = new Set(['keydown', 'keyup', 'sceneStart', 'sceneEnd', 'tick']);
/** Object actions require a target (the behavior's own object when on an object, an explicit
 *  `args.targetId` when on a project handler) — see the `Behavior`/`BehaviorAction` model doc. */
const OBJECT_ACTION_KINDS = new Set(['show', 'hide', 'setOpacity', 'setPosition', 'setText']);
/** Which of an action kind's `args` entries are SavigScript source (vs. a literal id/name) —
 *  mirrors the `BehaviorAction.args` doc comment exactly. */
const EXPR_ARG_KEYS: Partial<Record<BehaviorAction['kind'], string[]>> = {
  seek: ['time'],
  setVar: ['value'],
  setOpacity: ['value'],
  setPosition: ['dx', 'dy'],
  setText: ['value'],
};
/** Read-only built-ins (spec §4) — plain identifiers, not flagged as undeclared. */
const BUILTIN_NAMES = new Set(['time', 'sceneIndex', 'sceneTime']);

function collectVarNames(expr: Expr, out: Set<string>): void {
  switch (expr.kind) {
    case 'var':
      out.add(expr.name);
      break;
    case 'unary':
      collectVarNames(expr.expr, out);
      break;
    case 'binary':
      collectVarNames(expr.left, out);
      collectVarNames(expr.right, out);
      break;
    case 'ternary':
      collectVarNames(expr.cond, out);
      collectVarNames(expr.then, out);
      collectVarNames(expr.else, out);
      break;
    default:
      break; // 'lit' / 'call' have no variable references
  }
}

/** Collect the object ids referenced by xOf('id')/yOf('id') calls. */
function collectObjectRefs(expr: Expr, out: Set<string>): void {
  switch (expr.kind) {
    case 'call':
      if (expr.arg !== undefined) out.add(expr.arg);
      break;
    case 'unary':
      collectObjectRefs(expr.expr, out);
      break;
    case 'binary':
      collectObjectRefs(expr.left, out);
      collectObjectRefs(expr.right, out);
      break;
    case 'ternary':
      collectObjectRefs(expr.cond, out);
      collectObjectRefs(expr.then, out);
      collectObjectRefs(expr.else, out);
      break;
    default:
      break;
  }
}

/** Parse `src` (a guard or an expression arg): a parse failure is a `script-parse-error` (message
 *  embeds the parser's `pos`); on success, any referenced identifier that is neither a built-in
 *  nor a declared variable is an `undeclared-variable` warning. */
function checkExpr(src: string, label: string, declared: Set<string>, knownObjects: ReadonlyMap<string, unknown>, issues: ValidationIssue[], objectId?: string): void {
  const result = parse(src);
  if (!result.ok) {
    issues.push({ severity: 'error', code: 'script-parse-error', message: `${label}: ${result.message} at position ${result.pos}`, ...(objectId ? { objectId } : {}) });
    return;
  }
  const names = new Set<string>();
  collectVarNames(result.ast, names);
  for (const name of names) {
    if (!BUILTIN_NAMES.has(name) && !declared.has(name)) {
      issues.push({ severity: 'warn', code: 'undeclared-variable', message: `${label}: undeclared variable "${name}"`, ...(objectId ? { objectId } : {}) });
    }
  }
  const refs = new Set<string>();
  collectObjectRefs(result.ast, refs);
  for (const ref of refs) {
    if (!knownObjects.has(ref)) {
      issues.push({ severity: 'warn', code: 'script-object-ref', message: `${label}: xOf/yOf references missing object "${ref}"`, ...(objectId ? { objectId } : {}) });
    }
  }
}

function isTextObject(project: Project, obj: SceneObject): boolean {
  if (obj.isGroup) return false;
  const asset = project.assets.find((a) => a.id === obj.assetId);
  return asset?.kind === 'text';
}

/** Validate one `Behavior` — either on an object (`context: 'object'`, `objectId` = its owner,
 *  always a valid implicit action target) or a project-level global handler (`context: 'global'`,
 *  `objectId` undefined, so an object action MUST name an explicit `args.targetId`). */
function validateBehavior(
  project: Project,
  behavior: Behavior,
  context: 'object' | 'global',
  label: string,
  declaredVars: Set<string>,
  knownSceneIds: Set<string>,
  objectsById: Map<string, SceneObject>,
  issues: ValidationIssue[],
  objectId?: string,
): void {
  const isPointer = POINTER_EVENTS.has(behavior.event);
  const isGlobal = GLOBAL_EVENTS.has(behavior.event);
  if (context === 'object' && isGlobal) {
    issues.push({ severity: 'error', code: 'behavior-event-placement', message: `${label}: global event "${behavior.event}" is not valid on an object (belongs on a project handler)`, ...(objectId ? { objectId } : {}) });
  }
  if (context === 'global' && isPointer) {
    issues.push({ severity: 'error', code: 'behavior-event-placement', message: `${label}: pointer event "${behavior.event}" is not valid on a project handler (belongs on an object)`, ...(objectId ? { objectId } : {}) });
  }
  if ((behavior.event === 'keydown' || behavior.event === 'keyup') && !behavior.key) {
    issues.push({ severity: 'error', code: 'behavior-key-missing', message: `${label}: "${behavior.event}" requires a key`, ...(objectId ? { objectId } : {}) });
  }
  if (behavior.sceneId !== undefined && !knownSceneIds.has(behavior.sceneId)) {
    issues.push({ severity: 'error', code: 'dangling-behavior-scene', message: `${label}: references missing scene "${behavior.sceneId}"`, ...(objectId ? { objectId } : {}) });
  }

  behavior.actions.forEach((action, i) => {
    const actionLabel = `${label} action[${i}] (${action.kind})`;
    if (action.if !== undefined) checkExpr(action.if, `${actionLabel} if`, declaredVars, objectsById, issues, objectId);
    for (const key of EXPR_ARG_KEYS[action.kind] ?? []) {
      const src = action.args?.[key];
      if (src !== undefined) checkExpr(src, `${actionLabel} args.${key}`, declaredVars, objectsById, issues, objectId);
    }
    if (action.kind === 'gotoScene') {
      const sceneId = action.args?.sceneId;
      if (sceneId !== undefined && !knownSceneIds.has(sceneId)) {
        issues.push({ severity: 'error', code: 'dangling-behavior-scene', message: `${actionLabel}: references missing scene "${sceneId}"`, ...(objectId ? { objectId } : {}) });
      }
    }
    if (OBJECT_ACTION_KINDS.has(action.kind)) {
      const explicitTarget = action.args?.targetId;
      const effectiveTarget = explicitTarget ?? (context === 'object' ? objectId : undefined);
      if (effectiveTarget === undefined) {
        issues.push({ severity: 'error', code: 'behavior-target-missing', message: `${actionLabel}: object action on a project handler requires args.targetId` });
        return;
      }
      const target = objectsById.get(effectiveTarget);
      if (!target) {
        issues.push({ severity: 'error', code: 'dangling-behavior-target', message: `${actionLabel}: references missing object "${effectiveTarget}"`, ...(objectId ? { objectId } : {}) });
      } else if (action.kind === 'setText' && !isTextObject(project, target)) {
        issues.push({ severity: 'error', code: 'settext-target-not-text', message: `${actionLabel}: setText target "${effectiveTarget}" is not a text object`, ...(objectId ? { objectId } : {}) });
      }
    }
  });
}

/** Project-level (regardless of scenes) interactivity checks: declared-variable duplicates, then
 *  every object behavior (across root AND every scene) and every global handler. */
function validateInteractions(project: Project, issues: ValidationIssue[]): void {
  const model = project.interactions;
  const objectsById = new Map<string, SceneObject>();
  for (const scene of projectScenes(project)) {
    for (const o of scene.objects) objectsById.set(o.id, o);
  }
  const knownSceneIds = new Set(projectScenes(project).map((s) => s.id));

  const variables = model?.variables ?? [];
  const declaredVars = new Set(variables.map((v) => v.name));
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of variables) {
    if (seen.has(v.name)) dup.add(v.name);
    seen.add(v.name);
  }
  for (const name of dup) {
    issues.push({ severity: 'error', code: 'duplicate-variable', message: `variable "${name}" is declared more than once` });
  }

  for (const scene of projectScenes(project)) {
    for (const o of scene.objects) {
      for (const b of o.behaviors ?? []) {
        validateBehavior(project, b, 'object', `object "${o.id}" behavior "${b.id}"`, declaredVars, knownSceneIds, objectsById, issues, o.id);
      }
    }
  }
  for (const b of model?.handlers ?? []) {
    validateBehavior(project, b, 'global', `handler "${b.id}"`, declaredVars, knownSceneIds, objectsById, issues);
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

  // Interactions (M9) are project-wide too (object behaviors can target ANY scene) — validate
  // once regardless of scenes.
  validateInteractions(project, issues);

  return issues;
}
