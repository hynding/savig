// M9 interactivity/scripting authoring UI — the shared behavior list/editor. Mounted twice:
// once per-object (Inspector.tsx's single-object branch, `objectId` = the object, `eventKinds` =
// pointer kinds only) and once project-wide (InteractionsPanel, `objectId: null` = global
// handlers, `eventKinds` = global kinds only). One component so the two contexts can never drift
// on markup/data-testids — only the `eventKinds`/`objectId`/`hint` inputs differ per caller.
//
// Editing pattern: selects (event kind, action kind, sceneId, targetId) commit on change — a
// native <select> change is already a single discrete action. Free-text fields (key capture, the
// `if` guard, action args) commit on blur/Enter, mirroring Inspector.tsx's `NumberField`/
// `TextField` — typing "42" is one undo entry, not one per keystroke. Every commit sends
// `updateBehavior` the FULL patched behavior (never a bare per-field diff), per the store's
// `Partial<Omit<Behavior, 'id'>>` contract.
//
// Expression args (SavigScript source strings) live-validate on every keystroke via `parse` —
// the error updates immediately, independent of when the value is actually committed to the
// store. Only ONE `expr-error-<behaviorId>-<i>` element ever exists per action row (the required
// data-testid has no per-arg suffix): `if` and every expression arg share one slot, resolved by
// checking them in a fixed order and showing the first error found.
import { useEffect, useRef, useState } from 'react';
import { parse } from '@savig/engine';
import type { Behavior, BehaviorAction, GlobalEventKind, PointerEventKind } from '@savig/engine';
import styles from './Inspector.module.css';

export interface BehaviorOptionRef {
  id: string;
  name: string;
}

/** Object behaviors only ever fire pointer events (spec §3) — `click` first so "add behavior"
 *  defaults to it, as the task brief specifies. */
export const POINTER_EVENT_KINDS: readonly PointerEventKind[] = [
  'click',
  'pointerdown',
  'pointerup',
  'hoverEnter',
  'hoverLeave',
];

/** Project-level global handlers only (spec §3) — never valid on an object's own behaviors. */
export const GLOBAL_EVENT_KINDS: readonly GlobalEventKind[] = ['keydown', 'keyup', 'sceneStart', 'sceneEnd', 'tick'];

export interface BehaviorsIntents {
  addBehavior: (objectId: string | null, behavior: Omit<Behavior, 'id'>) => void;
  updateBehavior: (objectId: string | null, behaviorId: string, patch: Partial<Omit<Behavior, 'id'>>) => void;
  removeBehavior: (objectId: string | null, behaviorId: string) => void;
}

export interface BehaviorsSectionProps {
  /** `null` = project-level global handler (InteractionsPanel); otherwise the owning object. */
  objectId: string | null;
  behaviors: Behavior[];
  /** Pointer kinds for an object, global kinds for the project — scopes both the "add" default
   *  and the event `<select>`'s options. */
  eventKinds: readonly (PointerEventKind | GlobalEventKind)[];
  scenes: BehaviorOptionRef[];
  targets: BehaviorOptionRef[];
  intents: BehaviorsIntents;
  /** Section heading — "Behaviors" for an object, "Global handlers" for the project. */
  heading: string;
}

const ACTION_KINDS: BehaviorAction['kind'][] = [
  'play',
  'pause',
  'stop',
  'seek',
  'gotoScene',
  'setVar',
  'show',
  'hide',
  'setOpacity',
  'setPosition',
  'setText',
];

type ArgKind = 'expr' | 'text' | 'scene' | 'target';
const ACTION_ARGS: Record<BehaviorAction['kind'], { name: string; kind: ArgKind }[]> = {
  play: [],
  pause: [],
  stop: [],
  seek: [{ name: 'time', kind: 'expr' }],
  gotoScene: [{ name: 'sceneId', kind: 'scene' }],
  setVar: [
    { name: 'name', kind: 'text' },
    { name: 'value', kind: 'expr' },
  ],
  show: [{ name: 'targetId', kind: 'target' }],
  hide: [{ name: 'targetId', kind: 'target' }],
  setOpacity: [
    { name: 'targetId', kind: 'target' },
    { name: 'value', kind: 'expr' },
  ],
  setPosition: [
    { name: 'targetId', kind: 'target' },
    { name: 'dx', kind: 'expr' },
    { name: 'dy', kind: 'expr' },
  ],
  setText: [
    { name: 'targetId', kind: 'target' },
    { name: 'value', kind: 'expr' },
  ],
};

const KEY_EVENTS = new Set(['keydown', 'keyup']);
const SCENE_EVENTS = new Set(['sceneStart', 'sceneEnd']);

// `updateBehavior`'s patch type is `Partial<Omit<Behavior, 'id'>>` — spreading a full `Behavior`
// (which HAS an `id`) straight into a patch object literal fails TS's excess-property check on
// object literals, so every "patch = the full behavior plus one changed field" call site strips
// `id` first via this helper.
function withoutId({ id: _id, ...rest }: Behavior): Omit<Behavior, 'id'> {
  return rest;
}

function exprError(source: string): { message: string; pos: number } | null {
  if (source.trim() === '') return null;
  const r = parse(source);
  return r.ok ? null : { message: r.message, pos: r.pos };
}

/** Commit-on-blur/Enter text input — same rationale as Inspector.tsx's TextField (a single undo
 *  entry per edit session, tracks the external value while unfocused). Local to this file since
 *  Inspector.tsx's TextField isn't exported and this needs a couple of extra hooks (onDraftChange
 *  for live expr validation) that would just be dead weight on every other TextField call site. */
function CommitField({
  value,
  ariaLabel,
  testId,
  placeholder,
  onCommit,
  onDraftChange,
  onFocusChange,
}: {
  value: string;
  ariaLabel: string;
  testId?: string;
  placeholder?: string;
  onCommit: (v: string) => void;
  /** Fires on every keystroke (not just commit) — used for live expression validation. */
  onDraftChange?: (v: string) => void;
  /** Fires on focus (true) and blur (false) — lets a parent (ActionRow) track which of ITS OWN
   *  fields are mid-edit, so an external change (e.g. undo) doesn't resync a field's row-level
   *  error state out from under the user while they're actively typing in it. */
  onFocusChange?: (focused: boolean) => void;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  const commit = () => {
    if (draft !== value) onCommit(draft);
  };

  return (
    <input
      aria-label={ariaLabel}
      data-testid={testId}
      type="text"
      placeholder={placeholder}
      value={draft}
      onFocus={() => {
        focused.current = true;
        onFocusChange?.(true);
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        onDraftChange?.(e.target.value);
      }}
      onBlur={() => {
        focused.current = false;
        onFocusChange?.(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function ActionRow({
  behaviorId,
  index,
  action,
  objectId,
  scenes,
  targets,
  onChange,
  onRemove,
}: {
  behaviorId: string;
  index: number;
  action: BehaviorAction;
  objectId: string | null;
  scenes: BehaviorOptionRef[];
  targets: BehaviorOptionRef[];
  onChange: (next: BehaviorAction) => void;
  onRemove: () => void;
}) {
  // Live drafts for every expression-kind arg + the `if` guard, keyed by arg name (`__if__` for
  // the guard) — feeds both the visible text (via CommitField) and the aggregated row error
  // below. Resynced from the committed `action` only while a field isn't focused.
  const argSpecs = ACTION_ARGS[action.kind];
  const [exprDrafts, setExprDrafts] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = { __if__: action.if ?? '' };
    for (const spec of argSpecs) if (spec.kind === 'expr') initial[spec.name] = action.args?.[spec.name] ?? '';
    return initial;
  });
  const focusedFields = useRef<Set<string>>(new Set());

  useEffect(() => {
    setExprDrafts((prev) => {
      const next: Record<string, string> = { ...prev };
      if (!focusedFields.current.has('__if__')) next.__if__ = action.if ?? '';
      for (const spec of argSpecs) {
        if (spec.kind === 'expr' && !focusedFields.current.has(spec.name)) {
          next[spec.name] = action.args?.[spec.name] ?? '';
        }
      }
      return next;
    });
  }, [action, argSpecs]);

  const setArg = (name: string, raw: string | undefined) => {
    const args = { ...(action.args ?? {}) };
    if (raw === undefined || raw === '') delete args[name];
    else args[name] = raw;
    onChange({ ...action, args: Object.keys(args).length > 0 ? args : undefined });
  };

  // The single `expr-error-<behaviorId>-<i>` slot: check the `if` guard then every expr arg (in
  // ACTION_ARGS order) against its LIVE draft, first error wins.
  let rowError: { message: string; pos: number } | null = exprError(exprDrafts.__if__ ?? '');
  if (!rowError) {
    for (const spec of argSpecs) {
      if (spec.kind !== 'expr') continue;
      rowError = exprError(exprDrafts[spec.name] ?? '');
      if (rowError) break;
    }
  }

  return (
    <div className={styles.row} data-testid={`action-row-${behaviorId}-${index}`}>
      <select
        aria-label={`action ${index} kind`}
        data-testid={`action-kind-${behaviorId}-${index}`}
        value={action.kind}
        onChange={(e) => onChange({ kind: e.target.value as BehaviorAction['kind'], if: action.if })}
      >
        {ACTION_KINDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>

      {argSpecs.map((spec) => {
        const testId = `action-arg-${behaviorId}-${index}-${spec.name}`;
        if (spec.kind === 'scene') {
          return (
            <select
              key={spec.name}
              aria-label={`action ${index} ${spec.name}`}
              data-testid={testId}
              value={action.args?.[spec.name] ?? ''}
              onChange={(e) => setArg(spec.name, e.target.value || undefined)}
            >
              <option value="">— select scene —</option>
              {scenes.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  {sc.name}
                </option>
              ))}
            </select>
          );
        }
        if (spec.kind === 'target') {
          return (
            <select
              key={spec.name}
              aria-label={`action ${index} ${spec.name}`}
              data-testid={testId}
              value={action.args?.[spec.name] ?? ''}
              onChange={(e) => setArg(spec.name, e.target.value || undefined)}
            >
              <option value="">{objectId === null ? '— target (required) —' : '(own object)'}</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          );
        }
        if (spec.kind === 'text') {
          return (
            <CommitField
              key={spec.name}
              ariaLabel={`action ${index} ${spec.name}`}
              testId={testId}
              placeholder={spec.name}
              value={action.args?.[spec.name] ?? ''}
              onCommit={(v) => setArg(spec.name, v || undefined)}
            />
          );
        }
        // expr
        return (
          <CommitField
            key={spec.name}
            ariaLabel={`action ${index} ${spec.name}`}
            testId={testId}
            placeholder={spec.name}
            value={action.args?.[spec.name] ?? ''}
            onCommit={(v) => setArg(spec.name, v || undefined)}
            onDraftChange={(v) => setExprDrafts((d) => ({ ...d, [spec.name]: v }))}
            onFocusChange={(f) => {
              if (f) focusedFields.current.add(spec.name);
              else focusedFields.current.delete(spec.name);
            }}
          />
        );
      })}

      <CommitField
        ariaLabel={`action ${index} if`}
        testId={`action-if-${behaviorId}-${index}`}
        placeholder="if (optional guard)"
        value={action.if ?? ''}
        onCommit={(v) => onChange({ ...action, if: v || undefined })}
        onDraftChange={(v) => setExprDrafts((d) => ({ ...d, __if__: v }))}
        onFocusChange={(f) => {
          if (f) focusedFields.current.add('__if__');
          else focusedFields.current.delete('__if__');
        }}
      />

      {rowError && (
        <span data-testid={`expr-error-${behaviorId}-${index}`} className={styles.group}>
          {rowError.message}@{rowError.pos}
        </span>
      )}

      <button type="button" aria-label={`remove action ${index}`} onClick={onRemove}>
        ×
      </button>
    </div>
  );
}

export function BehaviorsSection({
  objectId,
  behaviors,
  eventKinds,
  scenes,
  targets,
  intents,
  heading,
}: BehaviorsSectionProps) {
  return (
    <>
      <div className={styles.group}>{heading}</div>
      {behaviors.map((b) => (
        <div key={b.id} className={styles.row} data-testid={`behavior-row-${b.id}`}>
          <select
            aria-label={`behavior ${b.id} event`}
            data-testid={`behavior-event-${b.id}`}
            value={b.event}
            onChange={(e) =>
              intents.updateBehavior(objectId, b.id, { ...withoutId(b), event: e.target.value as Behavior['event'] })
            }
          >
            {eventKinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>

          {KEY_EVENTS.has(b.event) && (
            <CommitField
              ariaLabel={`behavior ${b.id} key`}
              testId={`behavior-key-${b.id}`}
              placeholder="key (e.g. ArrowLeft)"
              value={b.key ?? ''}
              onCommit={(v) => intents.updateBehavior(objectId, b.id, { ...withoutId(b), key: v || undefined })}
            />
          )}

          {SCENE_EVENTS.has(b.event) && (
            <select
              aria-label={`behavior ${b.id} scene`}
              data-testid={`behavior-scene-${b.id}`}
              value={b.sceneId ?? ''}
              onChange={(e) =>
                intents.updateBehavior(objectId, b.id, { ...withoutId(b), sceneId: e.target.value || undefined })
              }
            >
              <option value="">every scene</option>
              {scenes.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  {sc.name}
                </option>
              ))}
            </select>
          )}

          <button type="button" data-testid={`remove-behavior-${b.id}`} onClick={() => intents.removeBehavior(objectId, b.id)}>
            Remove behavior
          </button>

          {b.actions.map((action, i) => (
            <ActionRow
              key={i}
              behaviorId={b.id}
              index={i}
              action={action}
              objectId={objectId}
              scenes={scenes}
              targets={targets}
              onChange={(next) => {
                const actions = b.actions.map((a, j) => (j === i ? next : a));
                intents.updateBehavior(objectId, b.id, { ...withoutId(b), actions });
              }}
              onRemove={() => {
                const actions = b.actions.filter((_, j) => j !== i);
                intents.updateBehavior(objectId, b.id, { ...withoutId(b), actions });
              }}
            />
          ))}

          <button
            type="button"
            data-testid={`add-action-${b.id}`}
            onClick={() =>
              intents.updateBehavior(objectId, b.id, { ...withoutId(b), actions: [...b.actions, { kind: 'play' }] })
            }
          >
            + action
          </button>
        </div>
      ))}

      <div className={styles.row}>
        <button
          type="button"
          data-testid="add-behavior"
          onClick={() => intents.addBehavior(objectId, { event: eventKinds[0], actions: [] })}
        >
          + behavior
        </button>
      </div>
    </>
  );
}
