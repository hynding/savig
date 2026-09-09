import type { Behavior, BehaviorAction, GlobalEventKind, InteractionModel, PointerEventKind, Project, Scene, SceneObject } from '@savig/engine';

// Global Constraints (M9 interactivity/scripting spec §3), verbatim.
const MAX_EXPR_LEN = 500; // expression/arg STRING VALUES (BehaviorAction.if, args[*])
const MAX_ARG_ENTRIES = 8; // BehaviorAction.args
const MAX_ARG_KEY_LEN = 32; // an arg KEY's length (moot in practice: every known key is far
// shorter, so a key long enough to be truncated can never equal one after truncation either —
// it is dropped by the known-key-set check below regardless; kept for spec fidelity).
const MAX_KEY_LEN = 32; // Behavior.key (the keyboard key string, e.g. 'ArrowLeft')
const MAX_VAR_NAME_LEN = 64; // InteractionModel.variables[].name
const MAX_VARIABLES = 64; // InteractionModel.variables
const MAX_BEHAVIORS_PER_OBJECT = 64; // SceneObject.behaviors
const MAX_GLOBAL_HANDLERS = 256; // InteractionModel.handlers
const MAX_ACTIONS_PER_BEHAVIOR = 32; // Behavior.actions
void MAX_ARG_KEY_LEN; // documented, not separately enforced — see the comment above

const POINTER_EVENTS: readonly PointerEventKind[] = ['click', 'pointerdown', 'pointerup', 'hoverEnter', 'hoverLeave'];
const GLOBAL_EVENTS: readonly GlobalEventKind[] = ['keydown', 'keyup', 'sceneStart', 'sceneEnd', 'tick'];
// Placement (pointer events belong on an object, global events on `InteractionModel.handlers`)
// is validate's job (Task 7), NOT the sanitizer's — a behavior's `event` only has to be SOME
// known kind, wherever it lives. See `createSession` (engine/src/script/session.ts), which reads
// object behaviors and global handlers from the exact same two scopes this module sanitizes.
const KNOWN_EVENT_KINDS: ReadonlySet<string> = new Set<string>([...POINTER_EVENTS, ...GLOBAL_EVENTS]);

const KNOWN_ACTION_KINDS: ReadonlySet<string> = new Set<string>([
  'play', 'pause', 'stop', 'seek', 'gotoScene', 'setVar', 'show', 'hide', 'setOpacity', 'setPosition', 'setText',
]);

// Per-kind known arg keys (BehaviorAction's doc comment, spec §3). An arg key outside its kind's
// set is dropped — including a literal hostile "__proto__" key, which is never a member of any
// set here regardless of the CreateDataProperty-safe rebuild in `sanitizeArgs` below.
const KNOWN_ARG_KEYS: Readonly<Record<string, ReadonlySet<string>>> = {
  seek: new Set(['time']),
  gotoScene: new Set(['sceneId']),
  setVar: new Set(['name', 'value']),
  setOpacity: new Set(['targetId', 'value']),
  setPosition: new Set(['targetId', 'dx', 'dy']),
  setText: new Set(['targetId', 'value']),
  show: new Set(['targetId']),
  hide: new Set(['targetId']),
  play: new Set(),
  pause: new Set(),
  stop: new Set(),
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is number | string | boolean {
  return typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean';
}

function omitInteractions({ interactions: _dropped, ...rest }: Project): Project {
  return rest;
}

// Parameter-position destructuring (not a local variable) so the dropped key's eslint
// no-unused-vars is covered by the shared `argsIgnorePattern: '^_'` rule — mirrors
// store-internals.ts's `dropTrimAndDash`.
function omitBehaviors({ behaviors: _dropped, ...rest }: SceneObject): SceneObject {
  return rest;
}

/** Global Constraints sanitizer for M9 interactivity/scripting: clamps/strips malformed
 *  `Project.interactions` and per-object `SceneObject.behaviors` so a hand-edited or
 *  foreign-tool-produced `.savig` / embedded-SVG payload can never smuggle an oversized,
 *  wrong-typed, or unknown-kind behavior into the interactive session (`createSession`,
 *  engine/src/script/session.ts evaluates `args` as SavigScript source and dereferences
 *  `targetId`s — an unbounded string or unknown action kind is a footgun there, not just here).
 *  Pure; returns the ORIGINAL `project` reference when nothing needed fixing (parity guard —
 *  legacy / already-valid projects must be byte-for-byte identical, not just deep-equal).
 *
 *  Object behaviors are sanitized WHEREVER the object lives: root `objects[]` and every
 *  `scenes[i].objects[]` — the exact same two scopes `createSession` builds its behavior index
 *  from. Symbol-internal objects are out of scope (behaviors there are never fired — parity with
 *  the editor-state interactions slice's `findObjectAnywhere`).
 *
 *  Field-vs-entry discipline mirrors sanitizeAudioModel: a field of the WRONG SHAPE (not an
 *  array where one is expected: `behaviors` / `handlers` / `variables`) is dropped entirely; a
 *  field that IS an array but filters down to zero surviving entries is kept as `[]` — its shape
 *  was valid, only some of its content wasn't. Placement violations (a pointer event as a global
 *  handler, or vice versa) are left alone — that is `validate`'s job (Task 7), not this module's. */
export function sanitizeInteractionsModel(project: Project): Project {
  let changed = false;
  let next: Project = project;

  const interactions = project.interactions;
  if (interactions !== undefined) {
    if (!isPlainObject(interactions)) {
      next = omitInteractions(next);
      changed = true;
    } else {
      const sanitized = sanitizeInteractionModel(interactions);
      if (sanitized !== interactions) {
        next = { ...next, interactions: sanitized };
        changed = true;
      }
    }
  }

  const objects = project.objects;
  if (Array.isArray(objects)) {
    const sanitizedObjects = sanitizeObjectsBehaviors(objects);
    if (sanitizedObjects !== objects) {
      next = { ...next, objects: sanitizedObjects };
      changed = true;
    }
  }

  const scenes = project.scenes;
  if (Array.isArray(scenes)) {
    let scenesChanged = false;
    const sanitizedScenes = scenes.map((sc) => {
      if (!isPlainObject(sc) || !Array.isArray((sc as Scene).objects)) return sc; // malformed scene shape: not this module's job
      const scene = sc as Scene;
      const sanitizedObjects = sanitizeObjectsBehaviors(scene.objects);
      if (sanitizedObjects === scene.objects) return sc;
      scenesChanged = true;
      return { ...scene, objects: sanitizedObjects };
    });
    if (scenesChanged) {
      next = { ...next, scenes: sanitizedScenes };
      changed = true;
    }
  }

  return changed ? next : project;
}

function sanitizeInteractionModel(model: InteractionModel): InteractionModel {
  let changed = false;
  const out: InteractionModel = { ...model };

  if (out.variables !== undefined) {
    if (!Array.isArray(out.variables)) {
      delete out.variables;
      changed = true;
    } else {
      const sanitized = sanitizeVariables(out.variables);
      if (sanitized !== out.variables) {
        out.variables = sanitized;
        changed = true;
      }
    }
  }

  if (out.handlers !== undefined) {
    if (!Array.isArray(out.handlers)) {
      delete out.handlers;
      changed = true;
    } else {
      const sanitized = sanitizeBehaviors(out.handlers, MAX_GLOBAL_HANDLERS);
      if (sanitized !== out.handlers) {
        out.handlers = sanitized;
        changed = true;
      }
    }
  }

  return changed ? out : model;
}

function sanitizeVariables(vars: unknown[]): NonNullable<InteractionModel['variables']> {
  let changed = false;
  const result: NonNullable<InteractionModel['variables']> = [];
  for (const raw of vars) {
    // Malformed entry (not an object, non-string name, or a non-scalar initial — an object/array/
    // null/undefined initial can't be given well-defined reset semantics) -> drop the whole entry.
    if (!isPlainObject(raw) || typeof raw.name !== 'string' || !isScalar(raw.initial)) {
      changed = true;
      continue;
    }
    if (raw.name.length > MAX_VAR_NAME_LEN) {
      result.push({ name: raw.name.slice(0, MAX_VAR_NAME_LEN), initial: raw.initial });
      changed = true;
    } else {
      result.push(raw as { name: string; initial: number | string | boolean });
    }
  }
  if (result.length > MAX_VARIABLES) {
    result.length = MAX_VARIABLES; // stable order: keep the first N
    changed = true;
  }
  return changed ? result : (vars as NonNullable<InteractionModel['variables']>);
}

function isMalformedBehavior(raw: unknown): boolean {
  if (!isPlainObject(raw)) return true;
  if (typeof raw.id !== 'string') return true;
  if (typeof raw.event !== 'string' || !KNOWN_EVENT_KINDS.has(raw.event)) return true;
  if (!Array.isArray(raw.actions)) return true;
  return false;
}

function sanitizeBehaviors(list: unknown[], maxCount: number): Behavior[] {
  let changed = false;
  const result: Behavior[] = [];
  for (const raw of list) {
    if (isMalformedBehavior(raw)) {
      changed = true;
      continue;
    }
    const sanitized = sanitizeBehavior(raw as Behavior);
    if (sanitized !== raw) changed = true;
    result.push(sanitized);
  }
  if (result.length > maxCount) {
    result.length = maxCount; // stable order: keep the first N
    changed = true;
  }
  return changed ? result : (list as Behavior[]);
}

function sanitizeBehavior(b: Behavior): Behavior {
  let changed = false;
  const out: Behavior = { ...b };

  if (out.key !== undefined) {
    if (typeof out.key !== 'string') {
      delete out.key;
      changed = true;
    } else if (out.key.length > MAX_KEY_LEN) {
      out.key = out.key.slice(0, MAX_KEY_LEN); // survives, length-capped (not dropped)
      changed = true;
    }
  }

  if (out.sceneId !== undefined && typeof out.sceneId !== 'string') {
    delete out.sceneId;
    changed = true;
  }

  const sanitizedActions = sanitizeActions(out.actions);
  if (sanitizedActions !== out.actions) {
    out.actions = sanitizedActions;
    changed = true;
  }

  return changed ? out : b;
}

function sanitizeActions(actions: unknown[]): BehaviorAction[] {
  let changed = false;
  const result: BehaviorAction[] = [];
  for (const raw of actions) {
    if (!isPlainObject(raw) || typeof raw.kind !== 'string' || !KNOWN_ACTION_KINDS.has(raw.kind)) {
      changed = true;
      continue;
    }
    const rawAction = raw as unknown as BehaviorAction;
    const sanitized = sanitizeAction(rawAction);
    if (sanitized !== rawAction) changed = true;
    result.push(sanitized);
  }
  if (result.length > MAX_ACTIONS_PER_BEHAVIOR) {
    result.length = MAX_ACTIONS_PER_BEHAVIOR; // stable order: keep the first N
    changed = true;
  }
  return changed ? result : (actions as BehaviorAction[]);
}

function sanitizeAction(a: BehaviorAction): BehaviorAction {
  let changed = false;
  const out: BehaviorAction = { ...a };

  if (out.if !== undefined) {
    if (typeof out.if !== 'string') {
      delete out.if;
      changed = true;
    } else if (out.if.length > MAX_EXPR_LEN) {
      out.if = out.if.slice(0, MAX_EXPR_LEN);
      changed = true;
    }
  }

  if (out.args !== undefined) {
    if (!isPlainObject(out.args)) {
      delete out.args;
      changed = true;
    } else {
      const sanitized = sanitizeArgs(out.args, out.kind);
      if (sanitized !== out.args) {
        out.args = sanitized;
        changed = true;
      }
    }
  }

  return changed ? out : a;
}

// args ≤ 8 entries (stable order: keep the first 8 raw keys, THEN drop unknown-for-this-kind
// keys among those) — so a legitimately-known key past position 8 is truncated away by the
// entry cap, not spared by its own validity. Values are strings (BehaviorAction.args'
// contract): a wrong-typed value drops that one entry; an oversized one is length-capped, not
// dropped (survives, per the "expression/arg values" cap). Rebuilt via `Object.fromEntries`
// (CreateDataProperty-safe) rather than per-key bracket assignment — a literal hostile
// "__proto__" key is filtered out by the known-key-set check below anyway, but even if it
// weren't, this construction can never touch `Object.prototype`.
function sanitizeArgs(args: Record<string, unknown>, kind: string): Record<string, string> {
  const known = KNOWN_ARG_KEYS[kind] ?? new Set<string>();
  const rawKeys = Object.keys(args);
  let changed = rawKeys.length > MAX_ARG_ENTRIES;
  const capped = rawKeys.slice(0, MAX_ARG_ENTRIES);
  const entries: [string, string][] = [];
  for (const key of capped) {
    if (!known.has(key)) {
      changed = true;
      continue;
    }
    const value = args[key];
    if (typeof value !== 'string') {
      changed = true;
      continue;
    }
    if (value.length > MAX_EXPR_LEN) {
      entries.push([key, value.slice(0, MAX_EXPR_LEN)]);
      changed = true;
    } else {
      entries.push([key, value]);
    }
  }
  return changed ? Object.fromEntries(entries) : (args as Record<string, string>);
}

function sanitizeObjectsBehaviors(objects: SceneObject[]): SceneObject[] {
  let changed = false;
  const result = objects.map((o) => {
    const sanitized = sanitizeObjectBehaviors(o);
    if (sanitized !== o) changed = true;
    return sanitized;
  });
  return changed ? result : objects;
}

function sanitizeObjectBehaviors(o: SceneObject): SceneObject {
  const behaviors = o.behaviors as unknown;
  if (behaviors === undefined) return o;
  if (!Array.isArray(behaviors)) {
    return omitBehaviors(o);
  }
  const sanitized = sanitizeBehaviors(behaviors, MAX_BEHAVIORS_PER_OBJECT);
  if (sanitized === behaviors) return o;
  return { ...o, behaviors: sanitized };
}
