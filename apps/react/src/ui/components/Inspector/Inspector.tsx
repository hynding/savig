import { useEffect, useMemo, useRef, useState } from 'react';
import {
  identityCorrespondence,
  defaultGradient,
  angleToLinearCoords,
  linearCoordsToAngle,
} from '@savig/engine';
import type { GradientStop, MorphMode, RotationMode, VectorAsset } from '@savig/engine';
import { store } from '@savig/editor-state';
import { useEditor } from '../../store/store';
import { inspectorViewModel, inspectorIntents } from '@savig/ui-core';
import { EasingEditor } from '../EasingEditor/EasingEditor';
import styles from './Inspector.module.css';

const TRANSFORM_FIELDS = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity'] as const;
const RECT_GEOMETRY = ['width', 'height', 'cornerRadius'] as const;
const ELLIPSE_GEOMETRY = ['radiusX', 'radiusY'] as const;

// Commits on blur / Enter rather than per keystroke, so typing "42" is a single
// undo entry (not one per character) and the caret is not reset mid-edit. While
// the field is unfocused it tracks the sampled/store value (e.g. during playback).
function NumberField({
  label,
  value,
  step,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  step?: number;
  disabled?: boolean;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(() => String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);

  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n) && n !== value) onCommit(n);
  };

  return (
    <input
      id={`insp-${label}`}
      aria-label={label}
      type="number"
      step={step ?? 1}
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

export function Inspector() {
  const vm = useEditor(inspectorViewModel);
  const intents = useMemo(() => inspectorIntents(store), []);
  // Numeric spacing for distribute-by-gap (multi-select panel). Default 10px.
  const [spacing, setSpacing] = useState(10);
  const autoKey = useEditor((s) => s.autoKey);
  const activeTool = useEditor((s) => s.activeTool);
  const selectedNodeIndex = useEditor((s) => s.selectedNodeIndex);

  if (vm.kind === 'multi') {
    const { count, someGrouped, canAlign, canDistribute, canBool, canCreateSymbol } = vm;
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
        </div>
        <div className={styles.row}>
          <button onClick={() => intents.groupSelected()}>Group</button>
          {someGrouped && <button onClick={() => intents.ungroupSelected()}>Ungroup</button>}
          <button disabled={!canCreateSymbol} onClick={() => intents.createSymbol()}>Create Symbol</button>
          <button onClick={() => intents.duplicateSelected()}>Duplicate</button>
          <button onClick={() => intents.deleteSelectedObject()}>Delete</button>
        </div>
      </div>
    );
  }
  if (vm.kind === 'empty') return <div className={styles.hint}>No object selected</div>;

  // A group CONTAINER has no asset — show a dedicated panel (never the asset-dependent
  // editors below, which would throw on a group). Slice 45b.
  if (vm.kind === 'group') {
    return (
      <div className={styles.panel}>
        <div className={styles.row}>{vm.name} (group)</div>
        <div className={styles.row}>
          <button onClick={() => intents.ungroupSelected()}>Ungroup</button>
        </div>
      </div>
    );
  }

  const { obj, sampled, vector, isInstance, canCreateSymbol, transform, anchor, geometry, pathNodeCount,
    canRemoveShapeKeyframe, primitive, strokeWidth, dashOffset, motionPath, keyframe, nodeEasing, symbol } = vm;

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
        <label>{prop}</label>
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
            <label>angle</label>
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
          {activeTool === 'node' && selectedNodeIndex != null && (
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
          <div className={styles.row}>
            <label htmlFor="insp-dashed">dashed</label>
            <input
              id="insp-dashed"
              type="checkbox"
              aria-label="dashed"
              checked={!!vector.style.strokeDasharray && vector.style.strokeDasharray.length > 0}
              onChange={(e) => intents.setStrokeDasharray(e.target.checked ? [1, 1] : undefined)}
            />
            <button onClick={() => intents.drawOn()}>Draw on</button>
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
    </div>
  );
}
