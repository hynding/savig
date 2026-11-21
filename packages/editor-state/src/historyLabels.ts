// History panel labels (roadmap 13): every undo step carries a short human name ("Move",
// "Fill color", "Spray"), shown by the History panel.
//
// Labels are derived instead of threaded through every commit() call. Each store action is
// wrapped so it pushes its name while it runs; commit() reads the OUTERMOST name, so an
// action that calls other actions is labeled by what the user actually did. A command run
// from the menu, palette or a shortcut wraps itself in its title (withHistoryLabel), which
// wins over the action name because it is outermost.

const stack: string[] = [];

/** The fallback label for a commit with no named action around it. */
export const DEFAULT_HISTORY_LABEL = 'Edit';

/** Run `fn` with `label` as the history label of any commit it makes (outermost label wins). */
export function withHistoryLabel<T>(label: string, fn: () => T): T {
  stack.push(label);
  try {
    return fn();
  } finally {
    stack.pop();
  }
}

/** The label the next commit gets: the outermost running action or command. */
export function currentHistoryLabel(): string {
  return stack[0] ?? DEFAULT_HISTORY_LABEL;
}

/** Name a transform edit by the fields it touches: only x/y is a Move, only rotation a Rotate... */
export function transformLabel(keys: readonly string[]): string {
  const kinds = new Set(
    keys.map((k) =>
      k === 'x' || k === 'y' ? 'Move'
      : k === 'rotation' ? 'Rotate'
      : k === 'scaleX' || k === 'scaleY' ? 'Scale'
      : k === 'skewX' || k === 'skewY' ? 'Skew'
      : k === 'opacity' ? 'Opacity'
      : 'Transform',
    ),
  );
  return kinds.size === 1 ? [...kinds][0]! : 'Transform';
}

const keysOf = (v: unknown): string[] => (v && typeof v === 'object' ? Object.keys(v).filter((k) => k !== 'id') : []);
const colorLabel = (p: unknown) => (p === 'stroke' ? 'Stroke color' : 'Fill color');

// Hand-picked names where the humanized action name reads badly, keyed by store action name.
// A function gets the action's arguments, for labels that depend on what was edited.
const ACTION_LABELS: Record<string, string | ((...args: unknown[]) => string)> = {
  commit: DEFAULT_HISTORY_LABEL,
  commitActiveScene: DEFAULT_HISTORY_LABEL,
  addAsset: 'Import',
  addObject: 'Add object',
  setProperty: (prop) => transformLabel([String(prop)]),
  setProperties: (updates) => transformLabel(keysOf(updates)),
  setGroupTransform: (_id, partial) => transformLabel(keysOf(partial)),
  setObjectsTransforms: (updates) =>
    transformLabel(Array.isArray(updates) ? updates.flatMap((u) => keysOf(u)) : []),
  nudgeSelected: 'Nudge',
  setVectorColor: (prop) => colorLabel(prop),
  setVectorStyle: 'Style',
  setVectorGradient: 'Gradient',
  setPathData: 'Edit path',
  setRingPathData: 'Edit path',
  setTextAssetFields: 'Edit text',
  deleteSelectedObject: 'Delete',
  duplicateSelected: 'Duplicate',
  groupSelected: 'Group',
  ungroupSelected: 'Ungroup',
  booleanOp: (op) => (typeof op === 'string' ? humanizeWords(op) : 'Combine shapes'),
  paintBucketAt: 'Paint bucket',
  eraseAlong: 'Erase',
  lassoSelect: 'Lasso',
  sprayStroke: 'Spray',
  applyLipSync: 'Lip sync',
  addVectorShape: (type) => (typeof type === 'string' ? `Draw ${type}` : 'Draw shape'),
  addVectorPath: 'Draw path',
  addVectorOutline: 'Draw brush stroke',
  addTextObject: 'Add text',
  placeSymbolInstance: 'Place symbol',
  placeSymbolInstanceAt: 'Place symbol',
  moveObjectToTarget: 'Reorder layers',
  reorderSelected: 'Arrange',
  copyStyle: 'Copy style',
  pasteStyle: 'Paste style',
  applyStyleFrom: 'Eyedropper',
  insertScalarKeyframe: 'Insert keyframe',
  moveScalarKeyframe: 'Move keyframe',
  setScalarSegmentEasing: 'Easing',
  poseBoneTip: 'Pose bones',
  setCameraPose: 'Camera',
  importImageSequence: 'Import image sequence',
  setSymbolTimeRemap: 'Time remap',
  toggleSymbolTimeRemap: 'Time remap',
  setSymbolScale9: '9-slice scaling',
};

function humanizeWords(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/\s+/)
    // "Delete selected keyframe" reads better as "Delete keyframe"; the History panel is
    // always about the selection anyway.
    .filter((w) => w && w !== 'selected')
    .join(' ');
  return words ? words[0]!.toUpperCase() + words.slice(1) : DEFAULT_HISTORY_LABEL;
}

/** The history label for store action `name` called with `args`: "duplicateSelected" -> "Duplicate". */
export function humanizeAction(name: string, args: readonly unknown[] = []): string {
  const fixed = ACTION_LABELS[name];
  if (typeof fixed === 'string') return fixed;
  if (fixed) {
    try {
      return fixed(...args);
    } catch {
      return humanizeWords(name);
    }
  }
  return humanizeWords(name);
}

/** Wrap every function property of a freshly built store state so commits know their action. */
export function labelActions<S extends object>(state: S): S {
  const out = { ...state } as Record<string, unknown>;
  for (const [key, value] of Object.entries(out)) {
    if (typeof value !== 'function') continue;
    const fn = value as (...args: unknown[]) => unknown;
    out[key] = function labeled(this: unknown, ...args: unknown[]) {
      // Only the outermost action names the step, so skip the work for nested calls.
      if (stack.length > 0) return fn.apply(this, args);
      return withHistoryLabel(humanizeAction(key, args), () => fn.apply(this, args));
    };
  }
  return out as S;
}
