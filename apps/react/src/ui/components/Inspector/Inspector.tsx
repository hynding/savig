import { useEffect, useMemo, useRef, useState } from 'react';
import {
  identityCorrespondence,
  defaultGradient,
  angleToLinearCoords,
  linearCoordsToAngle,
} from '@savig/engine';
import type { ModifierTarget, TextAnimator, BlendMode, EasingName, LoopMode, GradientStop, MorphMode, RotationMode, VectorAsset, WidthPreset } from '@savig/engine';
import { store } from '@savig/editor-state';
import { useEditorVM } from '../../store/store';
import { inspectorViewModel, inspectorIntents, STAGE_PRESETS, FILTER_KIND_OPTIONS, BLEND_MODE_OPTIONS, defaultWiggle } from '@savig/ui-core';
import type { InspectorBoneVM, InspectorCameraVM, InspectorFilterVM, InspectorMaskVM, InspectorModifiersVM, InspectorShapeTweenVM, InspectorTextAnimationVM } from '@savig/ui-core';
import { EasingEditor } from '../EasingEditor/EasingEditor';
import { BehaviorsSection, POINTER_EVENT_KINDS } from './BehaviorsSection';
import { InteractionsPanel } from './InteractionsPanel';
import styles from './Inspector.module.css';

const TRANSFORM_FIELDS = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'skewX', 'skewY', 'opacity'] as const;
const RECT_GEOMETRY = ['width', 'height', 'cornerRadius'] as const;
const ELLIPSE_GEOMETRY = ['radiusX', 'radiusY'] as const;

// Commits on blur / Enter rather than per keystroke, so typing "42" is a single
// undo entry (not one per character) and the caret is not reset mid-edit. While
// the field is unfocused it tracks the sampled/store value (e.g. during playback).
function NumberField({
  label,
  value,
  step,
  min,
  max,
  testId,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  /** Optional data-testid (e.g. for a field a spec needs to target directly, distinct from the
   *  aria-label lookup every other NumberField relies on). */
  testId?: string;
  disabled?: boolean;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(() => String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);

  const commit = () => {
    const raw = Number(draft);
    // Empty/whitespace coerces to 0 (Number('') === 0) — treat it like unparseable input and
    // revert to the live value rather than silently committing 0.
    if (draft.trim() === '' || !Number.isFinite(raw)) {
      setDraft(String(value));
      return;
    }
    let n = raw;
    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    if (n !== value) onCommit(n);
    // Self-heal the visible draft when a clamp changed the value, so an out-of-range entry that
    // the store no-ops (clamped result == current) doesn't leave the bad text showing.
    if (n !== raw) setDraft(String(n));
  };

  return (
    <input
      id={`insp-${label}`}
      aria-label={label}
      data-testid={testId}
      type="number"
      step={step ?? 1}
      min={min}
      max={max}
      disabled={disabled}
      value={draft}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focused.current = false;
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

// String counterpart to NumberField — same commit-on-blur/Enter rationale (a single undo entry
// per edit session, not one per keystroke; tracks the store value while unfocused so playback/
// external updates are reflected). Used by the Text panel's content/fontFamily fields (text-tool
// task 3) — there's no other plain-text-input precedent elsewhere in this file to match instead.
function TextField({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onCommit: (v: string) => void;
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
      id={`insp-${label}`}
      aria-label={label}
      type="text"
      disabled={disabled}
      value={draft}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focused.current = false;
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

/** Filters & color effects (spec 2026-11-13-filters): an "Add filter" menu and one card per
 *  filter in stack order — enable toggle, params (keyframed at the playhead when auto-key is on),
 *  color, reorder and remove. Shared by the single-object and group panels. */
function FiltersSection({ filters, intents }: { filters: InspectorFilterVM[]; intents: ReturnType<typeof inspectorIntents> }) {
  return (
    <>
      <div className={styles.group}>Filters</div>
      <div className={styles.row}>
        <select
          aria-label="add filter"
          data-testid="inspector-add-filter"
          value=""
          onChange={(e) => {
            if (e.target.value) intents.addFilter(e.target.value as InspectorFilterVM['kind']);
          }}
        >
          <option value="">Add filter…</option>
          {FILTER_KIND_OPTIONS.map((o) => (
            <option key={o.kind} value={o.kind}>{o.label}</option>
          ))}
        </select>
      </div>
      {filters.map((f, i) => (
        <div key={f.id} className={styles.filterCard} data-testid={`filter-card-${i}`} data-filter-kind={f.kind}>
          <div className={styles.filterHead}>
            <input
              type="checkbox"
              aria-label={`${f.label} enabled`}
              checked={f.enabled}
              onChange={() => intents.toggleFilter(f.id)}
            />
            <span>{f.label}</span>
            <button aria-label={`move ${f.label} up`} title="Move up" disabled={!f.canMoveUp} onClick={() => intents.moveFilter(f.id, -1)}>↑</button>
            <button aria-label={`move ${f.label} down`} title="Move down" disabled={!f.canMoveDown} onClick={() => intents.moveFilter(f.id, 1)}>↓</button>
            <button aria-label={`remove ${f.label}`} title="Remove filter" onClick={() => intents.removeFilter(f.id)}>✕</button>
          </div>
          {f.params.map((p) => (
            <div key={p.name} className={styles.row}>
              <label>{p.name}{p.animated ? (p.keyedHere ? ' ◆' : ' ◇') : ''}</label>
              <NumberField
                label={`${f.label} ${p.name}`}
                value={p.value}
                min={p.min}
                max={p.max}
                step={p.step}
                onCommit={(n) => intents.setFilterParam(f.id, p.name, n)}
              />
            </div>
          ))}
          {f.color !== null && (
            <div className={styles.row}>
              <label>color</label>
              <input
                type="color"
                aria-label={`${f.label} color`}
                value={f.color}
                onChange={(e) => intents.setFilterColor(f.id, e.target.value)}
              />
            </div>
          )}
        </div>
      ))}
    </>
  );
}

/** Property modifiers (spec 2026-11-16-property-modifiers): wiggle and loop / ping-pong per
 *  property, with no hand-placed keys. An "Add modifier" menu, then one card per property. */
function ModifiersSection({ modifiers, intents }: { modifiers: InspectorModifiersVM; intents: ReturnType<typeof inspectorIntents> }) {
  const add = (value: string) => {
    const i = value.indexOf(':');
    const kind = value.slice(0, i) as 'wiggle' | 'loop';
    const prop = value.slice(i + 1) as ModifierTarget;
    if (kind === 'wiggle') intents.setModifier(prop, { wiggle: defaultWiggle(prop) });
    else intents.setModifier(prop, { loop: 'cycle' });
  };
  const wiggleOptions = modifiers.options.filter((o) => o.canWiggle && !o.hasWiggle);
  const loopOptions = modifiers.options.filter((o) => o.canLoop && !o.hasLoop);
  return (
    <>
      <div className={styles.group}>Modifiers</div>
      <div className={styles.row}>
        <select
          aria-label="add modifier"
          data-testid="inspector-add-modifier"
          value=""
          title="Procedural motion with no keys to place: wiggle adds smooth random motion; loop repeats a property's keys"
          onChange={(e) => {
            if (e.target.value) add(e.target.value);
          }}
        >
          <option value="">Add modifier…</option>
          <optgroup label="Wiggle">
            {wiggleOptions.map((o) => (
              <option key={o.property} value={`wiggle:${o.property}`}>Wiggle {o.label}</option>
            ))}
          </optgroup>
          {loopOptions.length > 0 && (
            <optgroup label="Loop (needs two keys)">
              {loopOptions.map((o) => (
                <option key={o.property} value={`loop:${o.property}`}>Loop {o.label}</option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
      {modifiers.items.map((m) => (
        <div key={m.property} className={styles.filterCard} data-testid={`modifier-card-${m.property}`}>
          <div className={styles.filterHead}>
            <span>{m.label}</span>
            <button aria-label={`remove ${m.label} modifiers`} title="Remove modifiers" onClick={() => intents.setModifier(m.property, null)}>✕</button>
          </div>
          {m.canWiggle && <div className={styles.row}>
            <label>
              <input
                type="checkbox"
                aria-label={`${m.label} wiggle`}
                checked={!!m.wiggle}
                onChange={(e) => intents.setModifier(m.property, { wiggle: e.target.checked ? defaultWiggle(m.property) : undefined })}
              />
              Wiggle
            </label>
          </div>}
          {m.wiggle && (
            <>
              <div className={styles.row}>
                <label title="How far it wanders either side, in the property's units">amount</label>
                <NumberField label={`${m.label} wiggle amount`} value={m.wiggle.amplitude} step={m.step} onCommit={(n) => intents.setModifier(m.property, { wiggle: { ...m.wiggle!, amplitude: n } })} />
              </div>
              <div className={styles.row}>
                <label title="Changes of direction per second">speed /s</label>
                <NumberField label={`${m.label} wiggle speed`} value={m.wiggle.frequency} min={0} max={30} step={0.5} onCommit={(n) => intents.setModifier(m.property, { wiggle: { ...m.wiggle!, frequency: Math.max(0, n) } })} />
              </div>
              <div className={styles.row}>
                <label title="Picks a different random pattern">seed</label>
                <NumberField label={`${m.label} wiggle seed`} value={m.wiggle.seed ?? 0} step={1} onCommit={(n) => intents.setModifier(m.property, { wiggle: { ...m.wiggle!, seed: Math.round(n) } })} />
                <button
                  aria-label={`new ${m.label} wiggle pattern`}
                  title="New random pattern"
                  onClick={() => intents.setModifier(m.property, { wiggle: { ...m.wiggle!, seed: ((m.wiggle!.seed ?? 0) + 1) % 1000 } })}
                >
                  ↻
                </button>
              </div>
            </>
          )}
          <div className={styles.row}>
            <label title={m.canLoop ? 'Repeat this property\'s keys after the last one' : 'Add two keys to this property to loop them'}>
              loop
              <select
                aria-label={`${m.label} loop`}
                value={m.loop ?? 'none'}
                disabled={!m.canLoop && !m.loop}
                onChange={(e) => intents.setModifier(m.property, { loop: e.target.value === 'none' ? undefined : (e.target.value as LoopMode) })}
              >
                <option value="none">Off</option>
                <option value="cycle">Loop</option>
                <option value="pingpong">Ping-pong</option>
              </select>
            </label>
          </div>
        </div>
      ))}
    </>
  );
}

/** Per-character text animation (spec 2026-11-16-text-animator): pick a preset, then tune. */
function TextAnimationSection({ vm, intents }: { vm: InspectorTextAnimationVM; intents: ReturnType<typeof inspectorIntents> }) {
  const a = vm.animator;
  return (
    <>
      <div className={styles.group}>Text animation</div>
      <div className={styles.row}>
        <select
          aria-label="text animation preset"
          data-testid="text-animation-preset"
          value=""
          title="Animate the letters or words one after another"
          onChange={(e) => {
            if (e.target.value) intents.setTextAnimator(null, e.target.value);
          }}
        >
          <option value="">{a ? 'Replace with preset…' : 'Animate letters…'}</option>
          {vm.presets.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        {a && (
          <button aria-label="remove text animation" title="Remove text animation" onClick={() => intents.setTextAnimator(null)}>✕</button>
        )}
      </div>
      {a && (
        <div className={styles.filterCard} data-testid="text-animation-card">
          <div className={styles.row}>
            <label>
              by
              <select aria-label="text animation by" value={a.by} onChange={(e) => intents.setTextAnimator({ by: e.target.value as TextAnimator['by'] })}>
                <option value="char">Letter</option>
                <option value="word">Word</option>
              </select>
            </label>
            <label>
              <select aria-label="text animation direction" value={a.direction ?? 'in'} onChange={(e) => intents.setTextAnimator({ direction: e.target.value as 'in' | 'out' })}>
                <option value="in">In</option>
                <option value="out">Out</option>
              </select>
            </label>
          </div>
          <div className={styles.row}>
            <label>
              order
              <select aria-label="text animation order" value={a.order ?? 'forward'} onChange={(e) => intents.setTextAnimator({ order: e.target.value as TextAnimator['order'] })}>
                <option value="forward">First to last</option>
                <option value="reverse">Last to first</option>
                <option value="center">From the middle</option>
                <option value="random">Random</option>
              </select>
            </label>
            {a.order === 'random' && (
              <button aria-label="new random order" title="New random order" onClick={() => intents.setTextAnimator({ seed: ((a.seed ?? 0) + 1) % 1000 })}>↻</button>
            )}
          </div>
          <div className={styles.row}>
            <label title="When the first letter starts (s)">start</label>
            <NumberField label="text animation start" value={a.start} min={0} step={0.1} onCommit={(n) => intents.setTextAnimator({ start: Math.max(0, n) })} />
          </div>
          <div className={styles.row}>
            <label title="Delay between letters (s)">stagger</label>
            <NumberField label="text animation stagger" value={a.stagger} min={0} step={0.01} onCommit={(n) => intents.setTextAnimator({ stagger: Math.max(0, n) })} />
          </div>
          <div className={styles.row}>
            <label title="How long each letter takes (s); 0 snaps like a typewriter">each</label>
            <NumberField label="text animation duration" value={a.duration} min={0} step={0.05} onCommit={(n) => intents.setTextAnimator({ duration: Math.max(0, n) })} />
          </div>
          <div className={styles.row}>
            <label>
              easing
              <select aria-label="text animation easing" value={a.easing ?? 'easeOut'} onChange={(e) => intents.setTextAnimator({ easing: e.target.value as EasingName })}>
                <option value="linear">linear</option>
                <option value="easeIn">easeIn</option>
                <option value="easeOut">easeOut</option>
                <option value="easeInOut">easeInOut</option>
              </select>
            </label>
          </div>
          <div className={styles.row}><span>{a.direction === 'out' ? 'to' : 'from'}</span></div>
          {(['opacity', 'dx', 'dy', 'rotation'] as const).map((k) => (
            <div className={styles.row} key={k}>
              <label title={k === 'opacity' ? '0 = invisible, 1 = fully shown' : k === 'rotation' ? 'degrees' : 'pixels'}>{k === 'dx' ? 'offset x' : k === 'dy' ? 'offset y' : k}</label>
              <NumberField
                label={`text animation from ${k}`}
                value={a.from[k] ?? (k === 'opacity' ? 1 : 0)}
                step={k === 'opacity' ? 0.1 : 1}
                onCommit={(n) => intents.setTextAnimator({ from: { [k]: k === 'opacity' ? Math.min(1, Math.max(0, n)) : n } })}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

const WIDTH_PRESET_OPTIONS: [WidthPreset, string][] = [
  ['uniform', 'uniform'],
  ['taper-end', 'taper end'],
  ['taper-start', 'taper start'],
  ['taper-both', 'taper both'],
  ['bulge', 'bulge'],
  ['pinch', 'pinch'],
];

const CAMERA_FIELDS: { axis: 'x' | 'y' | 'zoom' | 'rotation'; label: string }[] = [
  { axis: 'x', label: 'Camera X' },
  { axis: 'y', label: 'Camera Y' },
  { axis: 'zoom', label: 'Camera zoom %' },
  { axis: 'rotation', label: 'Camera rotation' },
];

/** Default camera shake per axis: a few pixels, a few percent of zoom, a couple of degrees. */
const CAMERA_WIGGLE = {
  x: { amplitude: 8, frequency: 3, seed: 0 },
  y: { amplitude: 8, frequency: 3, seed: 1 },
  zoom: { amplitude: 0.03, frequency: 2, seed: 2 },
  rotation: { amplitude: 1.5, frequency: 2, seed: 3 },
};

/** Camera panel (spec 2026-11-18-camera-tool): the active view's camera at the playhead. Zoom is
 *  shown in percent. A diamond marks an axis keyed at the playhead; clicking it removes that key. */
function CameraPanel({ camera, intents }: { camera: InspectorCameraVM; intents: ReturnType<typeof inspectorIntents> }) {
  const shown = (axis: 'x' | 'y' | 'zoom' | 'rotation') => {
    const v = camera.pose[axis];
    return Math.round((axis === 'zoom' ? v * 100 : v) * 100) / 100;
  };
  return (
    <div className={styles.panel} data-testid="inspector-camera">
      <div className={styles.row}>Camera</div>
      {!camera.exists ? (
        <div className={styles.row}>
          <button data-testid="inspector-add-camera" onClick={() => intents.addCamera()} title="Frame the scene with a camera you can pan, zoom and turn (Camera tool, A)">
            Add camera
          </button>
        </div>
      ) : (
        <>
          {CAMERA_FIELDS.map(({ axis, label }) => (
            <div className={styles.row} key={axis}>
              <NumberField
                label={label}
                testId={`inspector-camera-${axis}`}
                value={shown(axis)}
                min={axis === 'zoom' ? 5 : undefined}
                max={axis === 'zoom' ? 2000 : undefined}
                onCommit={(n) => intents.setCameraPose({ [axis]: axis === 'zoom' ? n / 100 : n })}
              />
              {camera.axes[axis].keyed ? (
                <button
                  data-testid={`inspector-camera-key-${axis}`}
                  aria-label={`Remove ${label} keyframe`}
                  title="Keyed here: click to remove this keyframe"
                  onClick={() => intents.removeCameraKeyframe(axis)}
                >
                  ◆
                </button>
              ) : camera.axes[axis].animated ? (
                <span title="Animated (no keyframe at the playhead)">◇</span>
              ) : null}
            </div>
          ))}
          {camera.selectedKey && (
            <div className={styles.row} data-testid="inspector-camera-selected-key">
              <label>
                Ease into {CAMERA_FIELDS.find((f) => f.axis === camera.selectedKey!.axis)!.label.replace('Camera ', '')} key
                <select
                  aria-label="Camera key easing"
                  value={camera.selectedKey.easing}
                  onChange={(e) => intents.setCameraKeyEasing(e.target.value as 'linear')}
                >
                  {camera.selectedKey.easing === 'custom' && <option value="custom">Custom curve</option>}
                  <option value="linear">Linear</option>
                  <option value="easeIn">Ease in</option>
                  <option value="easeOut">Ease out</option>
                  <option value="easeInOut">Ease in-out</option>
                </select>
              </label>
            </div>
          )}
          <div className={styles.row}>Shake &amp; loop</div>
          {CAMERA_FIELDS.map(({ axis, label }) => {
            const m = camera.modifiers[axis];
            const name = label.replace('Camera ', '').replace(' %', '');
            return (
              <div className={styles.row} key={`mod-${axis}`} data-testid={`inspector-camera-mod-${axis}`}>
                <label title={`Shake the camera's ${name.toLowerCase()} (seeded, so every export matches)`}>
                  <input
                    type="checkbox"
                    aria-label={`Camera ${name} wiggle`}
                    checked={!!m.wiggle}
                    onChange={(e) => intents.setCameraModifier(axis, { wiggle: e.target.checked ? { ...CAMERA_WIGGLE[axis] } : undefined })}
                  />
                  {name} wiggle
                </label>
                {m.wiggle && (
                  <>
                    <NumberField
                      label={`Camera ${name} wiggle amount`}
                      value={m.wiggle.amplitude}
                      step={axis === 'zoom' ? 0.01 : 1}
                      onCommit={(n) => intents.setCameraModifier(axis, { wiggle: { ...m.wiggle!, amplitude: n } })}
                    />
                    <NumberField
                      label={`Camera ${name} wiggle frequency`}
                      value={m.wiggle.frequency}
                      min={0}
                      step={0.5}
                      onCommit={(n) => intents.setCameraModifier(axis, { wiggle: { ...m.wiggle!, frequency: n } })}
                    />
                  </>
                )}
                <select
                  aria-label={`Camera ${name} loop`}
                  title="After the last key: hold, repeat, or ping-pong"
                  value={m.loop ?? 'none'}
                  onChange={(e) => intents.setCameraModifier(axis, { loop: e.target.value === 'none' ? undefined : (e.target.value as 'cycle' | 'pingpong') })}
                >
                  <option value="none">No loop</option>
                  <option value="cycle">Loop</option>
                  <option value="pingpong">Ping-pong</option>
                </select>
              </div>
            );
          })}
          <div className={styles.row}>
            <button data-testid="inspector-remove-camera" onClick={() => intents.removeCamera()}>
              Remove camera
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function Inspector() {
  const vm = useEditorVM(inspectorViewModel);
  const intents = useMemo(() => inspectorIntents(store), []);
  // Mask layers (spec 2026-11-13): role + Release/Unmask for a mask or a masked object.
  // Guides (spec 2026-11-15-bitmap-import): editor-only reference content.
  const guideRow = (on: boolean) => (
    <div className={styles.row} data-testid="inspector-guide">
      <label title="Guides show in the editor but are left out of every export and the preview">
        <input type="checkbox" aria-label="Guide" checked={on} onChange={() => intents.toggleGuide()} />
        Guide (editor only)
      </label>
    </div>
  );
  // Blend modes (spec 2026-11-15-blend-modes): how the object combines with what lies beneath.
  const blendRow = (mode: 'normal' | BlendMode) => (
    <div className={styles.row} data-testid="inspector-blend">
      <label>
        Blend
        <select aria-label="Blend mode" value={mode} onChange={(e) => intents.setBlendMode(e.target.value as 'normal' | BlendMode)}>
          {BLEND_MODE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
  const maskRow = (m: InspectorMaskVM | null) =>
    m && (
      <div className={styles.row} data-testid="inspector-mask">
        {m.role === 'mask' ? (
          <>
            <span>Mask · {m.inverted ? 'hides' : 'reveals'} {m.maskedCount} object{m.maskedCount === 1 ? '' : 's'}</span>
            {/* Mask modes (spec 2026-11-14-mask-modes): by area or brightness; inverted. */}
            <select
              aria-label="Mask type"
              title="Alpha: the mask's shape reveals. Luminance: its brightness reveals (white shows, black hides)."
              value={m.maskType}
              onChange={(e) => intents.setMaskStyle({ maskType: e.target.value as 'alpha' | 'luminance' })}
            >
              <option value="alpha">Alpha</option>
              <option value="luminance">Luminance</option>
            </select>
            <label title="Hide what the mask covers and show everything else">
              <input type="checkbox" aria-label="Invert mask" checked={!!m.inverted} onChange={(e) => intents.setMaskStyle({ maskInvert: e.target.checked })} />
              Invert
            </label>
            <button data-testid="inspector-release-mask" onClick={() => intents.releaseMask()}>Release Mask</button>
          </>
        ) : (
          <>
            <span>Masked by {m.maskName}</span>
            <button data-testid="inspector-unmask" onClick={() => intents.unmaskSelected()}>Unmask</button>
          </>
        )}
      </div>
    );
  // Bone (spec 2026-11-13-bone-tool): rest geometry, joint limits, pin, pose reset.
  const boneSection = (b: InspectorBoneVM | null) =>
    b && (
      <div className={styles.filterCard} data-testid="inspector-bone">
        <div className={styles.row}>
          <span>Bone · pose {Math.round(b.rotation * 10) / 10}°{b.animated ? ' (keyed)' : ''}</span>
          <button title="Rotation 0 and no pose keys on this bone" onClick={() => intents.resetBonePose(b.id)}>Reset pose</button>
        </div>
        <div className={styles.row}>
          <NumberField label="Bone length" value={Math.round(b.length * 100) / 100} min={1} onCommit={(n) => n > 0 && intents.setBoneSpec(b.id, { length: n })} />
          <NumberField label="Bone angle" value={Math.round(b.angle * 100) / 100} onCommit={(n) => intents.setBoneSpec(b.id, { angle: n })} />
        </div>
        <div className={styles.row}>
          <label>
            <input type="checkbox" aria-label="Limit joint" checked={b.min !== null || b.max !== null} onChange={(e) => intents.setBoneSpec(b.id, e.target.checked ? { min: -45, max: 45 } : { min: undefined, max: undefined })} />
            Limit
          </label>
          {(b.min !== null || b.max !== null) && (
            <>
              <NumberField label="Joint min" value={b.min ?? -180} onCommit={(n) => intents.setBoneSpec(b.id, { min: n })} />
              <NumberField label="Joint max" value={b.max ?? 180} onCommit={(n) => intents.setBoneSpec(b.id, { max: n })} />
            </>
          )}
          <label>
            <input type="checkbox" aria-label="Pin bone" checked={b.pinned} onChange={(e) => intents.setBoneSpec(b.id, { pinned: e.target.checked })} />
            Pin
          </label>
        </div>
        <div className={styles.row} data-testid="inspector-bone-spring" title="Spring: the bone lags and overshoots its parent's motion, then settles (0 = off)">
          <NumberField
            label="Spring strength"
            value={b.springStrength}
            min={0}
            max={100}
            onCommit={(n) => intents.setBoneSpec(b.id, { spring: n > 0 ? { strength: Math.min(100, n), damping: b.springDamping } : undefined })}
          />
          {b.springStrength > 0 && (
            <NumberField
              label="Spring damping"
              value={b.springDamping}
              min={0}
              max={100}
              onCommit={(n) => intents.setBoneSpec(b.id, { spring: { strength: b.springStrength, damping: Math.max(0, Math.min(100, n)) } })}
            />
          )}
        </div>
      </div>
    );
  // Shape tween (spec 2026-11-13) for a selected frame layer: the key under the playhead.
  const shapeTweenRow = (t: InspectorShapeTweenVM | null) =>
    t && (
      <div className={styles.row} data-testid="inspector-shape-tween">
        <span>Shape tween</span>
        {t.active ? (
          <>
            <select
              aria-label="Shape tween easing"
              value={t.easing}
              onChange={(e) => intents.createShapeTween(e.target.value as EasingName)}
            >
              {t.easing === 'custom' && <option value="custom">custom</option>}
              <option value="linear">linear</option>
              <option value="easeIn">easeIn</option>
              <option value="easeOut">easeOut</option>
              <option value="easeInOut">easeInOut</option>
            </select>
            <button title="Re-derive from the current drawings" onClick={() => intents.createShapeTween()}>Update</button>
            <button onClick={() => intents.removeShapeTween()}>Remove</button>
            <span data-testid="inspector-shape-hints" title="Shape hints pin matching spots on the start and end drawings (drag the lettered markers on the Stage; right-click one to delete it)">
              Hints {t.hints}
            </span>
            <button data-testid="inspector-add-shape-hint" disabled={t.hints >= 26} title="Add shape hint (Ctrl+Shift+H)" onClick={() => intents.addShapeHint()}>
              + Hint
            </button>
            {t.hints > 0 && (
              <button data-testid="inspector-remove-shape-hints" title="Remove all shape hints" onClick={() => intents.removeShapeHints()}>
                Clear hints
              </button>
            )}
          </>
        ) : (
          <button
            disabled={!t.available}
            title={t.available ? 'Morph this drawing into the next keyframe' : 'Put the playhead on a keyframe that has a following keyframe'}
            onClick={() => intents.createShapeTween()}
          >
            Create
          </button>
        )}
      </div>
    );
  // Numeric spacing for distribute-by-gap (multi-select panel). Default 10px.
  const [spacing, setSpacing] = useState(10);
  // Blend panel local state (art-tools #9, task 3) — mirrors the distribute-spacing row's
  // uncommitted-until-click pattern (no NumberField blur-commit needed; Blend reads these
  // directly when clicked).
  const [blendSteps, setBlendSteps] = useState(3);
  const [blendEasing, setBlendEasing] = useState<EasingName>('linear');
  // Selected audio mixer lane (task 5), independent of the stage-object selection `vm` covers —
  // a lane-header click in AudioLanes sets this; the default lane is never selectable so it's
  // never seen here. Derived inline (not via inspectorViewModel) since it's orthogonal to `vm`.
  const selectedTrack = useEditorVM((s) => {
    const id = s.selectedAudioTrackId;
    if (!id) return null;
    const t = (s.history.present.audioTracks ?? []).find((x) => x.id === id);
    if (!t) return null;
    return { id: t.id, name: t.name, filterKind: t.filter?.kind ?? ('none' as const), filterFreq: t.filter?.frequency ?? 1000 };
  });

  if (selectedTrack) {
    return (
      <div className={styles.panel}>
        <div className={styles.row}>{selectedTrack.name}</div>
        <div className={styles.group}>Track</div>
        <div className={styles.row}>
          <label htmlFor="insp-track-filter-kind">filter</label>
          <select
            id="insp-track-filter-kind"
            aria-label="filter kind"
            data-testid="track-filter-kind"
            value={selectedTrack.filterKind}
            onChange={(e) => {
              const kind = e.target.value as 'none' | 'lowpass' | 'highpass';
              intents.setAudioTrackProps(selectedTrack.id, {
                filter: kind === 'none' ? null : { kind, frequency: selectedTrack.filterFreq },
              });
            }}
          >
            <option value="none">none</option>
            <option value="lowpass">lowpass</option>
            <option value="highpass">highpass</option>
          </select>
        </div>
        {selectedTrack.filterKind !== 'none' && (
          <div className={styles.row}>
            <label htmlFor="insp-filter frequency">frequency</label>
            <NumberField
              label="filter frequency"
              testId="track-filter-freq"
              value={selectedTrack.filterFreq}
              min={10}
              max={24000}
              onCommit={(n) =>
                intents.setAudioTrackProps(selectedTrack.id, {
                  filter: { kind: selectedTrack.filterKind as 'lowpass' | 'highpass', frequency: Math.min(24000, Math.max(10, n)) },
                })
              }
            />
          </div>
        )}
      </div>
    );
  }

  if (vm.kind === 'multi') {
    const { count, someGrouped, canAlign, canDistribute, canBool, canCreateSymbol, canShapeBuilder, shapeBuilderActive, canBlend, canCreateMask, canAttachToBone, canBindSkin } = vm;
    return (
      <div className={styles.panel}>
        <div className={styles.row}>{count} objects selected</div>
        <div className={styles.row}>
          <button aria-label="Align left" title="Align left" disabled={!canAlign} onClick={() => intents.alignSelected('left')}>⇤</button>
          <button aria-label="Align horizontal centers" title="Align horizontal centers" disabled={!canAlign} onClick={() => intents.alignSelected('hcenter')}>⇔</button>
          <button aria-label="Align right" title="Align right" disabled={!canAlign} onClick={() => intents.alignSelected('right')}>⇥</button>
          <button aria-label="Align top" title="Align top" disabled={!canAlign} onClick={() => intents.alignSelected('top')}>⤒</button>
          <button aria-label="Align vertical centers" title="Align vertical centers" disabled={!canAlign} onClick={() => intents.alignSelected('vcenter')}>⇕</button>
          <button aria-label="Align bottom" title="Align bottom" disabled={!canAlign} onClick={() => intents.alignSelected('bottom')}>⤓</button>
          <button aria-label="Distribute horizontally" title="Distribute horizontally" disabled={!canDistribute} onClick={() => intents.distributeSelected('h')}>↔</button>
          <button aria-label="Distribute vertically" title="Distribute vertically" disabled={!canDistribute} onClick={() => intents.distributeSelected('v')}>↕</button>
          <button aria-label="Distribute horizontal centers" title="Distribute horizontal centers" disabled={!canDistribute} onClick={() => intents.distributeCentersSelected('h')}>⇿</button>
          <button aria-label="Distribute vertical centers" title="Distribute vertical centers" disabled={!canDistribute} onClick={() => intents.distributeCentersSelected('v')}>⇳</button>
          <input
            type="number"
            min={0}
            aria-label="Distribute spacing value"
            title="Spacing (px) for distribute-by-spacing"
            value={spacing}
            onChange={(e) => setSpacing(Math.max(0, Number(e.target.value)) || 0)}
            style={{ width: '4em' }}
          />
          <button aria-label="Distribute horizontal spacing" title="Distribute horizontal spacing" disabled={!canDistribute} onClick={() => intents.distributeSpacingSelected('h', spacing)}>↦</button>
          <button aria-label="Distribute vertical spacing" title="Distribute vertical spacing" disabled={!canDistribute} onClick={() => intents.distributeSpacingSelected('v', spacing)}>↧</button>
          <button aria-label="Center on canvas" title="Center on canvas" onClick={() => intents.centerOnCanvas()}>⊡</button>
          <button aria-label="Align left to canvas" title="Align left to canvas" onClick={() => intents.alignToCanvas('left')}>⊨</button>
          <button aria-label="Align horizontal center to canvas" title="Align horizontal center to canvas" onClick={() => intents.alignToCanvas('hcenter')}>⊟</button>
          <button aria-label="Align right to canvas" title="Align right to canvas" onClick={() => intents.alignToCanvas('right')}>⊧</button>
          <button aria-label="Align top to canvas" title="Align top to canvas" onClick={() => intents.alignToCanvas('top')}>⊓</button>
          <button aria-label="Align vertical center to canvas" title="Align vertical center to canvas" onClick={() => intents.alignToCanvas('vcenter')}>⊞</button>
          <button aria-label="Align bottom to canvas" title="Align bottom to canvas" onClick={() => intents.alignToCanvas('bottom')}>⊔</button>
        </div>
        <div className={styles.row}>
          <button disabled={!canBool} title="Alt: animated (live) boolean" onClick={(e) => intents.booleanOp('union', { live: e.altKey })}>Union</button>
          <button disabled={!canBool} title="Alt: animated (live) boolean" onClick={(e) => intents.booleanOp('subtract', { live: e.altKey })}>Subtract</button>
          <button disabled={!canBool} title="Alt: animated (live) boolean" onClick={(e) => intents.booleanOp('intersect', { live: e.altKey })}>Intersect</button>
          <button disabled={!canBool} title="Alt: animated (live) boolean" onClick={(e) => intents.booleanOp('exclude', { live: e.altKey })}>Exclude</button>
          <button
            aria-label="Shape builder"
            title="Shape Builder: click a region to merge, Alt-click to punch"
            disabled={!shapeBuilderActive && !canShapeBuilder}
            onClick={() => intents.toggleShapeBuilder()}
          >
            {shapeBuilderActive ? 'Done' : 'Shape Builder'}
          </button>
        </div>
        {count === 2 && (
          <div className={styles.row}>
            <NumberField
              label="blend steps"
              value={blendSteps}
              min={1}
              onCommit={(n) => setBlendSteps(Math.min(100, Math.max(1, Math.round(n))))}
            />
            <select
              aria-label="blend easing"
              title="Blend easing"
              value={blendEasing}
              onChange={(e) => setBlendEasing(e.target.value as EasingName)}
            >
              <option value="linear">linear</option>
              <option value="easeIn">easeIn</option>
              <option value="easeOut">easeOut</option>
              <option value="easeInOut">easeInOut</option>
            </select>
            <button
              aria-label="Blend"
              title="Blend: create intermediate objects between the 2 selected paths"
              disabled={!canBlend}
              onClick={() => intents.blendSelected(blendSteps, blendEasing)}
            >
              Blend
            </button>
          </div>
        )}
        <div className={styles.row}>
          <button onClick={() => intents.groupSelected()}>Group</button>
          {someGrouped && <button onClick={() => intents.ungroupSelected()}>Ungroup</button>}
          <button disabled={!canCreateSymbol} onClick={() => intents.createSymbol()}>Create Symbol</button>
          <button disabled={!canCreateMask} title="The topmost selected object masks the rest" data-testid="inspector-create-mask" onClick={() => intents.createMask()}>Create Mask</button>
          {canBindSkin && (
            <button title="Bend the selected drawing with the selected bones (one bone = its whole armature)" data-testid="inspector-bind-skin" onClick={() => intents.bindSelectedSkin()}>Bind to Bones</button>
          )}
          {canAttachToBone && (
            <button title="File the other selected objects under the selected bone" data-testid="inspector-attach-bone" onClick={() => intents.attachSelectedToBone()}>Attach to Bone</button>
          )}
          <button onClick={() => intents.duplicateSelected()}>Duplicate</button>
          <button onClick={() => intents.deleteSelectedObject()}>Delete</button>
        </div>
      </div>
    );
  }
  if (vm.kind === 'empty') {
    const { dims, scope, variables, handlers, scenes, behaviorTargets, camera } = vm;
    const presetIndex = STAGE_PRESETS.findIndex(
      (p) => p.width === dims.width && p.height === dims.height,
    );
    return (
      <>
        <div className={styles.panel}>
          <div className={styles.row}>{scope === 'symbol' ? 'Symbol size' : 'Document'}</div>
          <div className={styles.row}>
            <NumberField
              label="Stage width"
              value={dims.width}
              min={1}
              onCommit={(n) => intents.setStageSize(n, dims.height)}
            />
            <NumberField
              label="Stage height"
              value={dims.height}
              min={1}
              onCommit={(n) => intents.setStageSize(dims.width, n)}
            />
          </div>
          <div className={styles.row}>
            <select
              aria-label="Stage size preset"
              value={presetIndex}
              onChange={(e) => {
                const p = STAGE_PRESETS[Number(e.target.value)];
                if (p) intents.setStageSize(p.width, p.height);
              }}
            >
              <option value={-1}>Custom</option>
              {STAGE_PRESETS.map((p, i) => (
                <option key={p.label} value={i}>
                  {p.label} ({p.width}×{p.height})
                </option>
              ))}
            </select>
          </div>
        </div>
        {camera && <CameraPanel camera={camera} intents={intents} />}
        <InteractionsPanel
          variables={variables}
          handlers={handlers}
          scenes={scenes}
          behaviorTargets={behaviorTargets}
          intents={intents}
        />
      </>
    );
  }

  // A group CONTAINER has no asset — show a dedicated panel (never the asset-dependent
  // editors below, which would throw on a group). Slice 45b.
  if (vm.kind === 'group') {
    return (
      <div className={styles.panel}>
        <div className={styles.row}>{vm.name} (group)</div>
        <div className={styles.row}>
          <button onClick={() => intents.ungroupSelected()}>Ungroup</button>
        </div>
        {guideRow(vm.guide)}
        {blendRow(vm.blendMode)}
        {maskRow(vm.mask)}
        {boneSection(vm.bone)}
        {shapeTweenRow(vm.shapeTween)}
        <FiltersSection filters={vm.filters} intents={intents} />
        <ModifiersSection modifiers={vm.modifiers} intents={intents} />
      </div>
    );
  }

  const { obj, sampled, vector, isInstance, canCreateSymbol, transform, anchor, geometry, pathNodeCount,
    canRemoveShapeKeyframe, canOutlineStroke, primitive, strokeWidth, dashOffset, dashed, trimStart, trimEnd, trimOffset,
    trimActive, motionPath, text, textPath, textAnimation, keyframe, nodeEasing, symbol, repeat, autoKey, showNodeEditButtons,
    behaviors, scenes, behaviorTargets, mask, filters, modifiers, warp, widthPreset } = vm;

  // --- Fill/stroke paint: solid color (optionally animated) XOR a gradient. ---
  // Prefer the playhead-sampled gradient (when an animated track exists) so the
  // paint UI + stop editor reflect what's shown; fall back to the static asset gradient.
  const gradientOf = (prop: 'fill' | 'stroke', v: VectorAsset) =>
    (prop === 'fill' ? sampled.fillGradient : sampled.strokeGradient) ??
    (prop === 'fill' ? v.style.fillGradient : v.style.strokeGradient);

  const paintType = (prop: 'fill' | 'stroke', v: VectorAsset): 'solid' | 'linear' | 'radial' =>
    gradientOf(prop, v)?.type ?? 'solid';

  const onPaintTypeChange = (
    prop: 'fill' | 'stroke',
    next: 'solid' | 'linear' | 'radial',
    v: VectorAsset,
  ) => {
    if (next === 'solid') {
      intents.setVectorGradient(prop, undefined);
      return;
    }
    const solid = prop === 'fill' ? v.style.fill : v.style.stroke;
    intents.setVectorGradient(prop, defaultGradient(next, solid === 'none' ? '#cccccc' : solid));
  };

  const renderPaintRow = (prop: 'fill' | 'stroke', v: VectorAsset) => {
    const fallback = prop === 'fill' ? '#cccccc' : '#000000';
    const solid = prop === 'fill' ? v.style.fill : v.style.stroke;
    const sampledSolid = (prop === 'fill' ? sampled.fill : sampled.stroke) ?? solid;
    return (
      <div className={styles.row}>
        <label htmlFor={`insp-${prop}-paint`}>{prop}</label>
        <select
          id={`insp-${prop}-paint`}
          aria-label={`${prop} paint`}
          value={paintType(prop, v)}
          onChange={(e) =>
            onPaintTypeChange(prop, e.target.value as 'solid' | 'linear' | 'radial', v)
          }
        >
          <option value="solid">solid</option>
          <option value="linear">linear</option>
          <option value="radial">radial</option>
        </select>
        {paintType(prop, v) === 'solid' && (
          <>
            <input
              type="checkbox"
              aria-label={`${prop} enabled`}
              checked={solid !== 'none'}
              onChange={(e) => intents.setVectorStyle({ [prop]: e.target.checked ? fallback : 'none' })}
            />
            <input
              id={`insp-${prop}`}
              aria-label={prop}
              type="color"
              disabled={solid === 'none'}
              value={sampledSolid === 'none' ? fallback : sampledSolid}
              onChange={(e) => intents.setVectorColor(prop, e.target.value)}
            />
            {typeof window !== 'undefined' && 'EyeDropper' in window && (
              <button
                aria-label={`pick ${prop} color`}
                title="Pick color from screen"
                onClick={async () => {
                  try {
                    const r = await new (
                      window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }
                    ).EyeDropper().open();
                    intents.setVectorColor(prop, r.sRGBHex);
                  } catch {
                    // AbortError (user cancelled the native picker) — deliberately swallowed
                  }
                }}
              >
                ⧉
              </button>
            )}
          </>
        )}
      </div>
    );
  };

  const renderGradientEditor = (prop: 'fill' | 'stroke', v: VectorAsset) => {
    const g = gradientOf(prop, v);
    if (!g) return null;
    const setStops = (stops: GradientStop[]) => {
      const sorted = [...stops].sort((a, b) => a.offset - b.offset);
      intents.setVectorGradient(prop, { ...g, stops: sorted });
    };
    return (
      <div data-testid={`${prop}-gradient-editor`}>
        {g.type === 'linear' && (
          <div className={styles.row}>
            <label htmlFor={`insp-${prop} gradient angle`}>angle</label>
            <NumberField
              label={`${prop} gradient angle`}
              value={Math.round(linearCoordsToAngle(g))}
              onCommit={(deg) => intents.setVectorGradient(prop, { ...g, ...angleToLinearCoords(deg) })}
            />
          </div>
        )}
        {g.stops.map((stop, i) => (
          <div className={styles.row} key={i}>
            <input
              aria-label={`${prop} stop ${i} offset`}
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={stop.offset}
              onChange={(e) =>
                setStops(
                  g.stops.map((s, j) =>
                    j === i ? { ...s, offset: Math.max(0, Math.min(1, Number(e.target.value))) } : s,
                  ),
                )
              }
            />
            <input
              aria-label={`${prop} stop ${i} color`}
              type="color"
              value={stop.color}
              onChange={(e) =>
                setStops(g.stops.map((s, j) => (j === i ? { ...s, color: e.target.value } : s)))
              }
            />
            <button
              aria-label={`remove ${prop} stop ${i}`}
              disabled={g.stops.length <= 2}
              onClick={() => setStops(g.stops.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
        ))}
        <button aria-label={`add ${prop} stop`} onClick={() => setStops([...g.stops, { offset: 0.5, color: '#888888' }])}>
          + stop
        </button>
      </div>
    );
  };

  return (
    <div className={styles.panel}>
      <div className={styles.row}>
        <button onClick={() => intents.duplicateSelected()}>Duplicate</button>
        <button onClick={() => intents.deleteSelectedObject()}>Delete</button>
        {/* Symbol-ize a single object too (slice 47a — store createSymbol takes >=1). */}
        <button disabled={!canCreateSymbol} onClick={() => intents.createSymbol()}>Create Symbol</button>
        <button aria-label="Center on canvas" title="Center on canvas" onClick={() => intents.centerOnCanvas()}>⊡</button>
        <button aria-label="Align left to canvas" title="Align left to canvas" onClick={() => intents.alignToCanvas('left')}>⊨</button>
        <button aria-label="Align horizontal center to canvas" title="Align horizontal center to canvas" onClick={() => intents.alignToCanvas('hcenter')}>⊟</button>
        <button aria-label="Align right to canvas" title="Align right to canvas" onClick={() => intents.alignToCanvas('right')}>⊧</button>
        <button aria-label="Align top to canvas" title="Align top to canvas" onClick={() => intents.alignToCanvas('top')}>⊓</button>
        <button aria-label="Align vertical center to canvas" title="Align vertical center to canvas" onClick={() => intents.alignToCanvas('vcenter')}>⊞</button>
        <button aria-label="Align bottom to canvas" title="Align bottom to canvas" onClick={() => intents.alignToCanvas('bottom')}>⊔</button>
      </div>
      {vm.asset?.kind === 'image' && (
        <div className={styles.row} data-testid="inspector-image">
          <span>Image · {vm.asset.width} × {vm.asset.height} px</span>
        </div>
      )}
      {guideRow(obj.guide === true)}
      {blendRow(obj.blendMode ?? 'normal')}
      {maskRow(mask)}
      {vm.boneOwner && (
        <div className={styles.row} data-testid="inspector-bone-owner">
          <span>Attached to {vm.boneOwner}</span>
          <button onClick={() => intents.detachSelectedFromBone()}>Detach</button>
        </div>
      )}
      {vm.skinBones && (
        <div className={styles.row} data-testid="inspector-skin">
          <span title={vm.skinBones.join(', ')}>Skin · {vm.skinBones.length} bone{vm.skinBones.length === 1 ? '' : 's'}</span>
          <button title="Re-capture the drawing at the current pose" onClick={() => intents.rebindSkin(vm.obj.id)}>Rebind</button>
          <button onClick={() => intents.unbindSkin(vm.obj.id)}>Unbind</button>
        </div>
      )}
      {isInstance && symbol && (
        <>
          <div className={styles.group}>Symbol timing</div>
          <div className={styles.row}>
            <label htmlFor="insp-symbol-timeremap" title="Keyframe the internal playhead directly (speed/freeze/reverse over the parent timeline). Supersedes the timing fields below.">time remap</label>
            <input
              id="insp-symbol-timeremap"
              data-testid="symbol-timeremap"
              type="checkbox"
              checked={symbol.remapOn}
              onChange={() => intents.toggleSymbolTimeRemap()}
            />
          </div>
          {symbol.remapOn && (
            <div className={styles.row}>
              <label htmlFor="insp-internal time" title="The internal frame shown at the playhead; editing keyframes the time-remap curve here.">internal time</label>
              <NumberField
                label="internal time"
                value={symbol.internalTime}
                step={0.1}
                onCommit={(n) => intents.setSymbolTimeRemap(n)}
              />
            </div>
          )}
          <div className={styles.row}>
            <label htmlFor="insp-symbol-start">start offset</label>
            <NumberField
              label="start offset"
              value={symbol.startOffset}
              step={0.1}
              disabled={symbol.timingDisabled}
              onCommit={(n) => intents.setSymbolTiming({ startOffset: n })}
            />
          </div>
          <div className={styles.row}>
            <label htmlFor="insp-symbol-loop">loop</label>
            <input
              id="insp-symbol-loop"
              data-testid="symbol-loop"
              type="checkbox"
              checked={symbol.loop}
              disabled={symbol.timingDisabled}
              onChange={(e) => intents.setSymbolTiming({ loop: e.target.checked })}
            />
          </div>
          <div className={styles.row}>
            <label htmlFor="insp-symbol-pingpong">ping-pong</label>
            <input
              id="insp-symbol-pingpong"
              data-testid="symbol-pingpong"
              type="checkbox"
              checked={symbol.pingPong}
              disabled={symbol.timingDisabled}
              onChange={(e) => intents.setSymbolTiming({ pingPong: e.target.checked })}
            />
          </div>
          <div className={styles.row}>
            <label htmlFor="insp-symbol-speed">speed</label>
            <NumberField
              label="speed"
              value={symbol.speed}
              step={0.1}
              disabled={symbol.timingDisabled}
              onCommit={(n) => intents.setSymbolTiming({ speed: n })}
            />
          </div>
          <div className={styles.row}>
            <label htmlFor="insp-symbol-playcount" title="Loop this many times then hold the last frame (0 = loop forever).">play count</label>
            <NumberField
              label="play count"
              value={symbol.playCount}
              step={1}
              disabled={symbol.timingDisabled}
              onCommit={(n) => intents.setSymbolTiming({ playCount: n })}
            />
          </div>
          <div className={styles.row}>
            <label htmlFor="insp-symbol-phase" title="Start this far (seconds) into the loop — desyncs clones.">phase</label>
            <NumberField
              label="phase"
              value={symbol.phase}
              step={0.1}
              disabled={symbol.timingDisabled}
              onCommit={(n) => intents.setSymbolTiming({ phase: n })}
            />
          </div>
          <div className={styles.row}>
            <label htmlFor="insp-symbol duration" title="The symbol's loop/clip length (0 = auto from keyframes). Affects every instance.">symbol duration</label>
            <NumberField
              label="symbol duration"
              value={symbol.duration}
              step={0.1}
              onCommit={(n) => intents.setSymbolDuration(obj.assetId, n)}
            />
          </div>
          <div className={styles.row}>
            <label htmlFor="insp-symbol-clip" title="Clip the symbol's content to its [0,width]×[0,height] bounding box. Affects every instance.">clip content</label>
            <input
              id="insp-symbol-clip"
              data-testid="symbol-clip"
              type="checkbox"
              checked={symbol.clip}
              onChange={(e) => intents.setSymbolClip(obj.assetId, e.target.checked)}
            />
          </div>
          {symbol.swapTargets.length > 0 && (
            <div className={styles.row}>
              <label htmlFor="insp-swap-symbol">swap symbol</label>
              <select
                id="insp-swap-symbol"
                data-testid="swap-symbol"
                value=""
                onChange={(e) => { if (e.target.value) intents.swapSymbol(obj.id, e.target.value); }}
              >
                <option value="">Swap to…</option>
                {symbol.swapTargets.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}
          {/* Per-instance visual overrides (slice 47f) */}
          <div className={styles.group}>Instance overrides</div>
          <div className={styles.row}>
            <label htmlFor="insp-instance-freeze" title="Freeze this instance at its first frame (static poster) regardless of the playhead.">freeze first frame</label>
            <input
              id="insp-instance-freeze"
              data-testid="instance-freeze"
              type="checkbox"
              checked={symbol.freezeFirstFrame}
              onChange={(e) => intents.setInstanceFreeze(e.target.checked)}
            />
          </div>
          <div className={styles.row}>
            <label htmlFor="insp-instance-tint-enable" title="Apply a color multiply tint to this instance's content.">tint</label>
            <input
              id="insp-instance-tint-enable"
              data-testid="instance-tint-enable"
              type="checkbox"
              checked={symbol.tint.enabled}
              onChange={(e) =>
                intents.setInstanceTint(
                  e.target.checked
                    ? { color: symbol.tint.color, amount: symbol.tint.amount }
                    : undefined,
                )
              }
            />
            <input
              id="insp-instance-tint-color"
              data-testid="instance-tint-color"
              type="color"
              value={symbol.tint.color}
              disabled={!symbol.tint.enabled}
              onChange={(e) =>
                symbol.tint.enabled &&
                intents.setInstanceTint({ color: e.target.value, amount: symbol.tint.amount })
              }
            />
            <NumberField
              label="tint amount"
              value={symbol.tint.amount}
              step={0.05}
              disabled={!symbol.tint.enabled}
              onCommit={(n) =>
                symbol.tint.enabled &&
                intents.setInstanceTint({ color: symbol.tint.color, amount: Math.max(0, Math.min(1, n)) })
              }
            />
          </div>
        </>
      )}
      {repeat && (
        <>
          <div className={styles.group}>Repeater</div>
          <div className={styles.row}>
            <label htmlFor="insp-repeat-enable" title="N transformed, time-staggered copies of this object.">repeat</label>
            <input
              id="insp-repeat-enable"
              data-testid="repeat-enable"
              type="checkbox"
              aria-label="repeat"
              checked={repeat.on}
              onChange={() => intents.toggleRepeat()}
            />
          </div>
          {repeat.on && (
            <>
              <div className={styles.row}>
                <label htmlFor="insp-copies">copies</label>
                <NumberField
                  label="copies"
                  value={repeat.count}
                  step={1}
                  min={2}
                  onCommit={(n) => intents.setRepeat({ count: n })}
                />
              </div>
              <div className={styles.row}>
                <label htmlFor="insp-repeat dx">repeat dx</label>
                <NumberField
                  label="repeat dx"
                  value={repeat.dx}
                  onCommit={(n) => intents.setRepeat({ dx: n })}
                />
              </div>
              <div className={styles.row}>
                <label htmlFor="insp-repeat dy">repeat dy</label>
                <NumberField
                  label="repeat dy"
                  value={repeat.dy}
                  onCommit={(n) => intents.setRepeat({ dy: n })}
                />
              </div>
              <div className={styles.row}>
                <label htmlFor="insp-repeat rotate">repeat rotate</label>
                <NumberField
                  label="repeat rotate"
                  value={repeat.rotate}
                  onCommit={(n) => intents.setRepeat({ rotate: n })}
                />
              </div>
              <div className={styles.row}>
                <label htmlFor="insp-repeat scale">repeat scale</label>
                <NumberField
                  label="repeat scale"
                  value={repeat.scale}
                  step={0.1}
                  onCommit={(n) => intents.setRepeat({ scale: n })}
                />
              </div>
              <div className={styles.row}>
                <label htmlFor="insp-stagger">stagger</label>
                <NumberField
                  label="stagger"
                  value={repeat.stagger}
                  step={0.1}
                  min={0}
                  onCommit={(n) => intents.setRepeat({ stagger: n })}
                />
              </div>
            </>
          )}
        </>
      )}
      <div className={styles.row}>
        <button onClick={() => intents.reorderSelected('back')}>To Back</button>
        <button onClick={() => intents.reorderSelected('backward')}>Backward</button>
        <button onClick={() => intents.reorderSelected('forward')}>Forward</button>
        <button onClick={() => intents.reorderSelected('front')}>To Front</button>
      </div>
      <div className={styles.group}>Transform</div>
      {TRANSFORM_FIELDS.map((prop) => (
        <div key={prop} className={styles.row}>
          <label htmlFor={`insp-${prop}`}>{prop}</label>
          <NumberField
            label={prop}
            value={transform[prop]}
            step={prop === 'opacity' ? 0.1 : 1}
            disabled={!autoKey}
            onCommit={(n) => intents.setProperty(prop, n)}
          />
        </div>
      ))}
      {warp && (
        <div className={styles.row}>
          <span>Free transform</span>
          <button
            aria-pressed={warp.mode === 'distort'}
            title="Drag the four corners anywhere (Esc to finish)"
            onClick={() => intents.setWarpMode(warp.mode === 'distort' ? null : 'distort')}
          >
            Distort
          </button>
          <button
            aria-pressed={warp.mode === 'envelope'}
            title="Bend the drawing with a 3×3 mesh (Esc to finish)"
            onClick={() => intents.setWarpMode(warp.mode === 'envelope' ? null : 'envelope')}
          >
            Envelope
          </button>
        </div>
      )}
      <div className={styles.group}>Anchor</div>
      <div className={styles.row}>
        <label htmlFor="insp-anchorX">anchorX</label>
        <NumberField label="anchorX" value={anchor.x} onCommit={(n) => intents.setAnchor(n, obj.anchorY)} />
      </div>
      <div className={styles.row}>
        <label htmlFor="insp-anchorY">anchorY</label>
        <NumberField label="anchorY" value={anchor.y} onCommit={(n) => intents.setAnchor(obj.anchorX, n)} />
      </div>
      {vector && vector.shapeType !== 'path' && (
        <>
          <div className={styles.group}>Geometry</div>
          {(vector.shapeType === 'rect' ? RECT_GEOMETRY : ELLIPSE_GEOMETRY).map((prop) => (
            <div key={prop} className={styles.row}>
              <label htmlFor={`insp-${prop}`}>{prop}</label>
              <NumberField
                label={prop}
                value={geometry[prop]}
                disabled={!autoKey}
                onCommit={(n) => intents.setProperty(prop, n)}
              />
            </div>
          ))}
        </>
      )}
      {vector && vector.shapeType === 'path' && (
        <>
          <div className={styles.group}>Path</div>
          <div className={styles.row}>nodes: {pathNodeCount}</div>
          <div className={styles.row}>
            <button onClick={() => intents.addShapeKeyframe()}>Add shape keyframe</button>
            <button onClick={() => intents.removeShapeKeyframe()} disabled={!canRemoveShapeKeyframe}>
              Remove shape keyframe
            </button>
          </div>
          {obj.shapeTrack && obj.shapeTrack.length > 0 && (
            <div className={styles.row}>morph: {obj.shapeTrack.length} keyframe(s)</div>
          )}
          {showNodeEditButtons && (
            <div className={styles.row}>
              <button onClick={() => intents.toggleSelectedNodeSmooth()}>Corner/Smooth</button>
              <button onClick={() => intents.joinSelectedNode()}>Join</button>
              <button onClick={() => intents.breakSelectedNode()}>Break</button>
              <button onClick={() => intents.deleteSelectedNode()}>Delete node</button>
            </div>
          )}
        </>
      )}
      {vector?.primitive && primitive && (
        <>
          <div className={styles.group}>Primitive</div>
          {vector.primitive.kind === 'polygon' && (
            <NumberField label="Sides" value={primitive.sides} onCommit={(n) => intents.setPrimitiveParam('sides', n)} />
          )}
          {vector.primitive.kind === 'star' && (
            <>
              <NumberField label="Points" value={primitive.points} onCommit={(n) => intents.setPrimitiveParam('points', n)} />
              <NumberField label="Inner ratio" value={primitive.innerRatio} onCommit={(n) => intents.setPrimitiveParam('innerRatio', n)} />
            </>
          )}
          <NumberField label="Corner radius" value={primitive.cornerRadius} onCommit={(n) => intents.setPrimitiveParam('cornerRadius', n)} />
          <NumberField label="Rotation" value={primitive.rotation} onCommit={(n) => intents.setPrimitiveParam('rotation', n)} />
        </>
      )}
      {vector && (
        <>
          <div className={styles.group}>Style</div>
          {renderPaintRow('fill', vector)}
          {renderGradientEditor('fill', vector)}
          {renderPaintRow('stroke', vector)}
          {renderGradientEditor('stroke', vector)}
          <div className={styles.row}>
            <label htmlFor="insp-strokeWidth">strokeWidth</label>
            <NumberField label="strokeWidth" value={strokeWidth} onCommit={(n) => intents.setVectorStyle({ strokeWidth: n })} />
          </div>
          <div className={styles.row}>
            <label htmlFor="insp-linecap">strokeLinecap</label>
            <select
              id="insp-linecap"
              aria-label="strokeLinecap"
              value={vector.style.strokeLinecap ?? 'butt'}
              onChange={(e) => intents.setVectorStyle({ strokeLinecap: e.target.value as 'butt' | 'round' | 'square' })}
            >
              <option value="butt">butt</option>
              <option value="round">round</option>
              <option value="square">square</option>
            </select>
          </div>
          <div className={styles.row}>
            <label htmlFor="insp-linejoin">strokeLinejoin</label>
            <select
              id="insp-linejoin"
              aria-label="strokeLinejoin"
              value={vector.style.strokeLinejoin ?? 'miter'}
              onChange={(e) => intents.setVectorStyle({ strokeLinejoin: e.target.value as 'miter' | 'round' | 'bevel' })}
            >
              <option value="miter">miter</option>
              <option value="round">round</option>
              <option value="bevel">bevel</option>
            </select>
          </div>
          {widthPreset && (
            <div className={styles.row}>
              <label htmlFor="insp-widthProfile">width profile</label>
              <select
                id="insp-widthProfile"
                aria-label="width profile"
                title="Swell or taper the stroke along its length (or drag on it with the Width tool, W)"
                value={widthPreset}
                onChange={(e) => {
                  if (e.target.value !== 'custom') intents.setWidthPreset(e.target.value as Exclude<typeof widthPreset, 'custom'>);
                }}
              >
                {WIDTH_PRESET_OPTIONS.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
                {widthPreset === 'custom' && <option value="custom">custom</option>}
              </select>
            </div>
          )}
          <div className={styles.row}>
            <button aria-label="Outline stroke" disabled={!canOutlineStroke} onClick={() => intents.outlineStroke()}>
              Outline stroke
            </button>
          </div>
          <div className={styles.row}>
            <label htmlFor="insp-dashed">dashed</label>
            <input
              id="insp-dashed"
              type="checkbox"
              aria-label="dashed"
              disabled={trimActive && !dashed}
              checked={!!vector.style.strokeDasharray && vector.style.strokeDasharray.length > 0}
              onChange={(e) => intents.setStrokeDasharray(e.target.checked ? [1, 1] : undefined)}
            />
            <button onClick={() => intents.drawOn()}>Draw on</button>
            {trimActive && !dashed && <p>Remove trim to use dashes</p>}
          </div>
          {vector.style.strokeDasharray && vector.style.strokeDasharray.length > 0 && (
            <div className={styles.row}>
              <label htmlFor="insp-dashoffset">dashOffset</label>
              <NumberField
                label="dashOffset"
                value={dashOffset}
                onCommit={(n) => intents.setStrokeDashoffset(n)}
              />
            </div>
          )}
          {dashed ? (
            <div className={styles.row}>
              <span>Trim</span>
              <p>Remove dash pattern to use Trim</p>
            </div>
          ) : (
            <div className={styles.row}>
              <span>Trim</span>
              <label htmlFor="insp-trim-start">start</label>
              <NumberField label="trim start" value={trimStart} onCommit={(n) => intents.setTrim('start', n)} />
              <label htmlFor="insp-trim-end">end</label>
              <NumberField label="trim end" value={trimEnd} onCommit={(n) => intents.setTrim('end', n)} />
              <label htmlFor="insp-trim-offset">offset</label>
              <NumberField label="trim offset" value={trimOffset} onCommit={(n) => intents.setTrim('offset', n)} />
              {vector.style.stroke === 'none' && <p>Add a stroke to see Trim</p>}
            </div>
          )}
        </>
      )}
      <div className={styles.group}>Motion Path</div>
      {motionPath ? (
        <>
          <div className={styles.row}>
            <label htmlFor="insp-orient">orient to path</label>
            <input
              id="insp-orient"
              aria-label="orient to path"
              type="checkbox"
              checked={motionPath.orient}
              onChange={(e) => intents.setMotionPathOrient(obj.id, e.target.checked)}
            />
          </div>
          <div className={styles.row}>
            progress: {motionPath.progressDisplay}
          </div>
          <div className={styles.row}>
            <NumberField
              label="progress"
              value={motionPath.progressAtSnapped}
              step={0.05}
              disabled={!autoKey}
              onCommit={(n) => intents.setMotionProgress(n)}
            />
            <button onClick={() => intents.removeMotionPath(obj.id)}>Remove motion path</button>
          </div>
        </>
      ) : (
        <div className={styles.row}>
          <button onClick={() => intents.setActiveTool('motion')}>Draw motion path</button>
        </div>
      )}
      {text && (
        <>
          <div className={styles.group}>Text</div>
          <div className={styles.row}>
            <label htmlFor="insp-text content">content</label>
            <TextField label="text content" value={text.content} onCommit={(v) => intents.setTextAssetFields({ content: v })} />
          </div>
          <div className={styles.row}>
            <label htmlFor="insp-font size">font size</label>
            <NumberField
              label="font size"
              value={text.fontSize}
              min={1}
              onCommit={(n) => intents.setTextAssetFields({ fontSize: n })}
            />
          </div>
          <div className={styles.row}>
            <label htmlFor="insp-text-fill">fill</label>
            <input
              id="insp-text-fill"
              aria-label="text fill"
              type="color"
              value={text.fill}
              onChange={(e) => intents.setTextAssetFields({ fill: e.target.value })}
            />
          </div>
          <div className={styles.row}>
            <label htmlFor="insp-font family">font family</label>
            <TextField label="font family" value={text.fontFamily} onCommit={(v) => intents.setTextAssetFields({ fontFamily: v })} />
          </div>
          <div className={styles.row}>
            <label htmlFor="insp-text-anchor">text anchor</label>
            <select
              id="insp-text-anchor"
              aria-label="text anchor"
              value={text.textAnchor}
              onChange={(e) => intents.setTextAssetFields({ textAnchor: e.target.value as 'start' | 'middle' | 'end' })}
            >
              <option value="start">start</option>
              <option value="middle">middle</option>
              <option value="end">end</option>
            </select>
          </div>
        </>
      )}
      {textAnimation && <TextAnimationSection vm={textAnimation} intents={intents} />}
      {textPath && (
        <>
          <div className={styles.group}>Text Path</div>
          <div className={styles.row}>
            <label htmlFor="insp-textpath-target">attach to path</label>
            <select
              id="insp-textpath-target"
              aria-label="attach to path"
              value={obj.textPath?.pathObjectId ?? ''}
              onChange={(e) => {
                if (e.target.value) intents.bindTextPath(e.target.value);
                else intents.unbindTextPath();
              }}
            >
              <option value="">None</option>
              {textPath.danglingTarget && (
                <option value={obj.textPath!.pathObjectId}>(missing target)</option>
              )}
              {textPath.pathTargets.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          {textPath.bound && (
            <>
              <div className={styles.row}>
                <label htmlFor="insp-textpath-offset">path offset</label>
                <NumberField
                  label="path offset"
                  value={textPath.offset}
                  step={0.05}
                  onCommit={(n) => intents.setTextPathOffset(n)}
                />
                <button aria-label="detach from path" onClick={() => intents.unbindTextPath()}>
                  Detach
                </button>
              </div>
              <div className={styles.row}>
                <p>Bound text ignores its own transform</p>
              </div>
            </>
          )}
        </>
      )}
      {keyframe !== null && (
        <>
          <div className={styles.group}>Keyframe</div>
          <div className={styles.row}>{keyframe.header}</div>
          <EasingEditor value={keyframe.easing} onChange={intents.setSelectedKeyframeEasing} inert={keyframe.inert} />
          {keyframe.kind === 'color' && (
            <div className={styles.row}>
              <button onClick={() => intents.removeSelectedColorKeyframe()}>Delete color keyframe</button>
            </div>
          )}
          {keyframe.kind === 'gradient' && (
            <div className={styles.row}>
              <button onClick={() => intents.removeSelectedGradientKeyframe()}>Delete gradient keyframe</button>
            </div>
          )}
          {keyframe.kind === 'dash' && (
            <div className={styles.row}>
              <button onClick={() => intents.removeSelectedDashKeyframe()}>Delete dash keyframe</button>
            </div>
          )}
          {keyframe.kind === 'trim' && (
            <div className={styles.row}>
              <button onClick={() => intents.removeSelectedTrimKeyframe()}>Delete trim keyframe</button>
            </div>
          )}
          {keyframe.kind === 'filter' && (
            <div className={styles.row}>
              <button onClick={() => intents.removeSelectedFilterKeyframe()}>Delete filter keyframe</button>
            </div>
          )}
          {keyframe.isRotation && (
            <div className={styles.row}>
              <label htmlFor="insp-rotmode">rotationMode</label>
              <select
                id="insp-rotmode"
                aria-label="rotationMode"
                value={keyframe.rotationMode}
                onChange={(e) => intents.setSelectedKeyframeRotationMode(e.target.value as RotationMode)}
              >
                <option value="shortest">shortest</option>
                <option value="raw">raw</option>
              </select>
            </div>
          )}
          {keyframe.morph !== null && (
            <div className={styles.row}>
              <label htmlFor="insp-morph">morph</label>
              <select
                id="insp-morph"
                aria-label="morph mode"
                value={keyframe.morph}
                onChange={(e) => intents.setSelectedShapeKeyframeMorph(e.target.value as MorphMode)}
              >
                <option value="corresponded">Grow</option>
                <option value="resampled">Resample</option>
              </select>
            </div>
          )}
          {keyframe.correspondence &&
            (() => {
              const { from, to, map, summary, canShift } = keyframe.correspondence;
              const cur = map ?? identityCorrespondence(from.nodes.length, to.nodes.length);
              const n = to.nodes.length;
              return (
                <div className={styles.row}>
                  <span>correspondence</span>
                  <button type="button" onClick={() => intents.suggestCorrespondence(from, to)}>
                    Suggest correspondence
                  </button>
                  {canShift && (
                    <>
                      <button
                        type="button"
                        aria-label="Shift correspondence backward"
                        onClick={() => intents.shiftCorrespondence(cur, n, -1)}
                      >
                        ◀
                      </button>
                      <button
                        type="button"
                        aria-label="Shift correspondence forward"
                        onClick={() => intents.shiftCorrespondence(cur, n, 1)}
                      >
                        ▶
                      </button>
                    </>
                  )}
                  <button type="button" onClick={() => intents.reverseCorrespondence(cur, n)}>
                    Reverse correspondence winding
                  </button>
                  <button type="button" onClick={() => intents.toggleCorrespondenceEdit()}>
                    Edit links
                  </button>
                  <span>{summary}</span>
                </div>
              );
            })()}
        </>
      )}
      {nodeEasing && (
        <>
          <div className={styles.group}>Node easing</div>
          <div className={styles.row}>node {nodeEasing.index} — overrides keyframe easing</div>
          <EasingEditor value={nodeEasing.value} onChange={intents.setSelectedNodeEasing} inert={nodeEasing.inert} />
          <div className={styles.row}>
            <button type="button" onClick={() => intents.setSelectedNodeEasing(undefined)}>
              reset to keyframe default
            </button>
          </div>
        </>
      )}
      <FiltersSection filters={filters} intents={intents} />
      <ModifiersSection modifiers={modifiers} intents={intents} />
      <BehaviorsSection
        objectId={obj.id}
        behaviors={behaviors}
        eventKinds={POINTER_EVENT_KINDS}
        scenes={scenes}
        targets={behaviorTargets}
        intents={intents}
        heading="Behaviors"
      />
    </div>
  );
}
