import { useEffect, useRef, useState } from 'react';
import {
  sampleObject,
  snapToFrame,
  interpolate,
  suggestCorrespondence,
  shiftCorrespondence,
  reverseCorrespondence,
  identityCorrespondence,
  defaultGradient,
  angleToLinearCoords,
  linearCoordsToAngle,
} from '../../../engine';
import type { Easing, GradientStop, MorphMode, PathData, RotationMode, VectorAsset } from '../../../engine';
import { useEditor } from '../../store/store';
import { selectSelectedObject, selectEditablePath, selectEditedShapeKeyframe } from '../../store/selectors';
import { EasingEditor } from '../EasingEditor/EasingEditor';
import styles from './Inspector.module.css';

const KF_EPS = 1e-6;

const TRANSFORM_FIELDS = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity'] as const;
const RECT_GEOMETRY = ['width', 'height', 'cornerRadius'] as const;
const ELLIPSE_GEOMETRY = ['radiusX', 'radiusY'] as const;

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// Describe the stored map relative to existing helpers (no new engine analyzer):
// 'auto' (absent) / 'suggested' (equals the suggestion) / 'custom' (anything else).
function correspondenceSummary(map: number[] | undefined, from: PathData, to: PathData): string {
  const n = from.nodes.length; // the map has one entry per FROM node
  if (!map) return `auto · ${n} nodes`;
  const suggested = suggestCorrespondence(from, to);
  const eq = map.length === suggested.length && map.every((v, i) => v === suggested[i]);
  return `${eq ? 'suggested' : 'custom'} · ${n} nodes`;
}

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
  const obj = useEditor(selectSelectedObject);
  const time = useEditor((s) => s.time);
  const fps = useEditor((s) => s.history.present.meta.fps);
  const autoKey = useEditor((s) => s.autoKey);
  const assets = useEditor((s) => s.history.present.assets);
  const activeTool = useEditor((s) => s.activeTool);
  const selectedNodeIndex = useEditor((s) => s.selectedNodeIndex);
  const selectedShapeKeyframe = useEditor((s) => s.selectedShapeKeyframe);
  const selectedColorKeyframe = useEditor((s) => s.selectedColorKeyframe);
  const selectedProgressKeyframe = useEditor((s) => s.selectedProgressKeyframe);
  const selectedKeyframe = useEditor((s) => s.selectedKeyframe);
  const {
    setProperty,
    setAnchor,
    setVectorStyle,
    setVectorColor,
    setVectorGradient,
    toggleSelectedNodeSmooth,
    joinSelectedNode,
    breakSelectedNode,
    deleteSelectedNode,
    removeSelectedColorKeyframe,
    addShapeKeyframe,
    removeShapeKeyframe,
    setSelectedKeyframeEasing,
    setSelectedKeyframeRotationMode,
    setSelectedShapeKeyframeMorph,
    setSelectedShapeKeyframeCorrespondence,
    setSelectedNodeEasing,
    removeMotionPath,
    setMotionPathOrient,
    setMotionProgress,
    setActiveTool,
  } = useEditor.getState();

  if (!obj) return <div className={styles.hint}>No object selected</div>;

  const sampled = sampleObject(obj, time);
  const asset = assets.find((a) => a.id === obj.assetId);
  const vector = asset && asset.kind === 'vector' ? asset : null;

  // Resolve the selected keyframe (scalar or shape) on THIS object for the easing editor.
  let kfEasing: Easing | null = null;
  let kfHeader = '';
  let kfIsRotation = false;
  let kfRotationMode: RotationMode = 'shortest';
  let kfInert = false;
  let kfMorph: MorphMode | null = null;
  let kfCorr: { from: PathData; to: PathData; map: number[] | undefined } | null = null;
  if (selectedProgressKeyframe && selectedProgressKeyframe.objectId === obj.id && obj.motionPath) {
    const track = obj.motionPath.progress;
    const idx = track.findIndex((k) => Math.abs(k.time - selectedProgressKeyframe.time) < KF_EPS);
    if (idx >= 0) {
      kfEasing = track[idx].easing;
      kfHeader = `progress @ ${round(track[idx].time)}s`;
      kfInert = idx === track.length - 1;
    }
  } else if (selectedColorKeyframe && selectedColorKeyframe.objectId === obj.id) {
    const track = obj.colorTracks?.[selectedColorKeyframe.property];
    const idx = track ? track.findIndex((k) => Math.abs(k.time - selectedColorKeyframe.time) < KF_EPS) : -1;
    if (track && idx >= 0) {
      kfEasing = track[idx].easing;
      kfHeader = `${selectedColorKeyframe.property} @ ${round(track[idx].time)}s`;
      kfInert = idx === track.length - 1;
    }
  } else if (selectedShapeKeyframe && selectedShapeKeyframe.objectId === obj.id && obj.shapeTrack) {
    const track = obj.shapeTrack;
    const idx = track.findIndex((k) => Math.abs(k.time - selectedShapeKeyframe.time) < KF_EPS);
    if (idx >= 0) {
      kfEasing = track[idx].easing;
      kfHeader = `shape @ ${round(track[idx].time)}s`;
      kfInert = idx === track.length - 1;
      kfMorph = track[idx].morph ?? 'corresponded';
      // Correspondence applies only to a corresponded transition INTO a next keyframe.
      if (idx < track.length - 1 && (track[idx].morph ?? 'corresponded') === 'corresponded') {
        kfCorr = { from: track[idx].path, to: track[idx + 1].path, map: track[idx].correspondence };
      }
    }
  } else if (selectedKeyframe && selectedKeyframe.objectId === obj.id) {
    const track = obj.tracks[selectedKeyframe.property];
    const idx = track ? track.findIndex((k) => Math.abs(k.time - selectedKeyframe.time) < KF_EPS) : -1;
    if (track && idx >= 0) {
      kfEasing = track[idx].easing;
      kfHeader = `${selectedKeyframe.property} @ ${round(track[idx].time)}s`;
      kfIsRotation = selectedKeyframe.property === 'rotation';
      kfRotationMode = track[idx].rotationMode ?? 'shortest';
      kfInert = idx === track.length - 1;
    }
  }

  // Per-node easing for the node selected on the keyframe at the playhead (corresponded
  // only). Reactive: this component subscribes to time, selectedNodeIndex, and the project.
  let nodeEasingCtx: { index: number; value: Easing; inert: boolean } | null = null;
  {
    const edited = selectEditedShapeKeyframe(useEditor.getState());
    if (
      selectedNodeIndex != null &&
      edited &&
      selectedNodeIndex < edited.kf.path.nodes.length &&
      (edited.kf.morph ?? 'corresponded') === 'corresponded'
    ) {
      nodeEasingCtx = {
        index: selectedNodeIndex,
        value: edited.kf.nodeEasings?.[selectedNodeIndex] ?? edited.kf.easing,
        inert: !!obj.shapeTrack && edited.index === obj.shapeTrack.length - 1,
      };
    }
  }

  // For a path: the shape actually shown/edited at the playhead (the sampled morph
  // shape when a shapeTrack exists, else the static base) — used for the node count.
  const editablePath = vector?.shapeType === 'path' ? selectEditablePath(useEditor.getState()) : null;
  // "Remove shape keyframe" is only meaningful when removeShapeKeyframe() would act:
  // a keyframe sits at the snapped playhead, or one is selected for this object.
  const snapped = snapToFrame(time, fps);
  const canRemoveShapeKeyframe =
    (obj.shapeTrack?.length ?? 0) > 0 &&
    ((obj.shapeTrack?.some((k) => Math.abs(k.time - snapped) < KF_EPS) ?? false) ||
      selectedShapeKeyframe?.objectId === obj.id);

  // --- Fill/stroke paint: solid color (optionally animated) XOR a gradient. ---
  const gradientOf = (prop: 'fill' | 'stroke', v: VectorAsset) =>
    prop === 'fill' ? v.style.fillGradient : v.style.strokeGradient;

  const paintType = (prop: 'fill' | 'stroke', v: VectorAsset): 'solid' | 'linear' | 'radial' =>
    gradientOf(prop, v)?.type ?? 'solid';

  const onPaintTypeChange = (
    prop: 'fill' | 'stroke',
    next: 'solid' | 'linear' | 'radial',
    v: VectorAsset,
  ) => {
    if (next === 'solid') {
      setVectorGradient(prop, undefined);
      return;
    }
    const solid = prop === 'fill' ? v.style.fill : v.style.stroke;
    setVectorGradient(prop, defaultGradient(next, solid === 'none' ? '#cccccc' : solid));
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
              onChange={(e) => setVectorStyle({ [prop]: e.target.checked ? fallback : 'none' })}
            />
            <input
              id={`insp-${prop}`}
              aria-label={prop}
              type="color"
              disabled={solid === 'none'}
              value={sampledSolid === 'none' ? fallback : sampledSolid}
              onChange={(e) => setVectorColor(prop, e.target.value)}
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
      setVectorGradient(prop, { ...g, stops: sorted });
    };
    return (
      <div data-testid={`${prop}-gradient-editor`}>
        {g.type === 'linear' && (
          <div className={styles.row}>
            <label>angle</label>
            <NumberField
              label={`${prop} gradient angle`}
              value={Math.round(linearCoordsToAngle(g))}
              onCommit={(deg) => setVectorGradient(prop, { ...g, ...angleToLinearCoords(deg) })}
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
      <div className={styles.group}>Transform</div>
      {TRANSFORM_FIELDS.map((prop) => (
        <div key={prop} className={styles.row}>
          <label htmlFor={`insp-${prop}`}>{prop}</label>
          <NumberField
            label={prop}
            value={round(sampled[prop])}
            step={prop === 'opacity' ? 0.1 : 1}
            disabled={!autoKey}
            onCommit={(n) => setProperty(prop, n)}
          />
        </div>
      ))}
      <div className={styles.group}>Anchor</div>
      <div className={styles.row}>
        <label htmlFor="insp-anchorX">anchorX</label>
        <NumberField label="anchorX" value={round(obj.anchorX)} onCommit={(n) => setAnchor(n, obj.anchorY)} />
      </div>
      <div className={styles.row}>
        <label htmlFor="insp-anchorY">anchorY</label>
        <NumberField label="anchorY" value={round(obj.anchorY)} onCommit={(n) => setAnchor(obj.anchorX, n)} />
      </div>
      {vector && vector.shapeType !== 'path' && (
        <>
          <div className={styles.group}>Geometry</div>
          {(vector.shapeType === 'rect' ? RECT_GEOMETRY : ELLIPSE_GEOMETRY).map((prop) => (
            <div key={prop} className={styles.row}>
              <label htmlFor={`insp-${prop}`}>{prop}</label>
              <NumberField
                label={prop}
                value={round(sampled.geometry?.[prop] ?? 0)}
                disabled={!autoKey}
                onCommit={(n) => setProperty(prop, n)}
              />
            </div>
          ))}
        </>
      )}
      {vector && vector.shapeType === 'path' && (
        <>
          <div className={styles.group}>Path</div>
          <div className={styles.row}>nodes: {editablePath?.nodes.length ?? vector.path?.nodes.length ?? 0}</div>
          <div className={styles.row}>
            <button onClick={() => addShapeKeyframe()}>Add shape keyframe</button>
            <button onClick={() => removeShapeKeyframe()} disabled={!canRemoveShapeKeyframe}>
              Remove shape keyframe
            </button>
          </div>
          {obj.shapeTrack && obj.shapeTrack.length > 0 && (
            <div className={styles.row}>morph: {obj.shapeTrack.length} keyframe(s)</div>
          )}
          {activeTool === 'node' && selectedNodeIndex != null && (
            <div className={styles.row}>
              <button onClick={() => toggleSelectedNodeSmooth()}>Corner/Smooth</button>
              <button onClick={() => joinSelectedNode()}>Join</button>
              <button onClick={() => breakSelectedNode()}>Break</button>
              <button onClick={() => deleteSelectedNode()}>Delete node</button>
            </div>
          )}
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
            <NumberField label="strokeWidth" value={round(vector.style.strokeWidth)} onCommit={(n) => setVectorStyle({ strokeWidth: n })} />
          </div>
          <div className={styles.row}>
            <label htmlFor="insp-linecap">strokeLinecap</label>
            <select
              id="insp-linecap"
              aria-label="strokeLinecap"
              value={vector.style.strokeLinecap ?? 'butt'}
              onChange={(e) => setVectorStyle({ strokeLinecap: e.target.value as 'butt' | 'round' | 'square' })}
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
              onChange={(e) => setVectorStyle({ strokeLinejoin: e.target.value as 'miter' | 'round' | 'bevel' })}
            >
              <option value="miter">miter</option>
              <option value="round">round</option>
              <option value="bevel">bevel</option>
            </select>
          </div>
        </>
      )}
      <div className={styles.group}>Motion Path</div>
      {obj.motionPath ? (
        <>
          <div className={styles.row}>
            <label htmlFor="insp-orient">orient to path</label>
            <input
              id="insp-orient"
              aria-label="orient to path"
              type="checkbox"
              checked={obj.motionPath.orient}
              onChange={(e) => setMotionPathOrient(obj.id, e.target.checked)}
            />
          </div>
          <div className={styles.row}>
            progress: {round(obj.motionPath.progress.length ? interpolate(obj.motionPath.progress, time) : 0)}
          </div>
          <div className={styles.row}>
            <NumberField
              label="progress"
              value={round(obj.motionPath.progress.length ? interpolate(obj.motionPath.progress, snapToFrame(time, fps)) : 0)}
              step={0.05}
              disabled={!autoKey}
              onCommit={(n) => setMotionProgress(n)}
            />
            <button onClick={() => removeMotionPath(obj.id)}>Remove motion path</button>
          </div>
        </>
      ) : (
        <div className={styles.row}>
          <button onClick={() => setActiveTool('motion')}>Draw motion path</button>
        </div>
      )}
      {kfEasing !== null && (
        <>
          <div className={styles.group}>Keyframe</div>
          <div className={styles.row}>{kfHeader}</div>
          <EasingEditor value={kfEasing} onChange={setSelectedKeyframeEasing} inert={kfInert} />
          {selectedColorKeyframe && (
            <div className={styles.row}>
              <button onClick={() => removeSelectedColorKeyframe()}>Delete color keyframe</button>
            </div>
          )}
          {kfIsRotation && (
            <div className={styles.row}>
              <label htmlFor="insp-rotmode">rotationMode</label>
              <select
                id="insp-rotmode"
                aria-label="rotationMode"
                value={kfRotationMode}
                onChange={(e) => setSelectedKeyframeRotationMode(e.target.value as RotationMode)}
              >
                <option value="shortest">shortest</option>
                <option value="raw">raw</option>
              </select>
            </div>
          )}
          {kfMorph !== null && (
            <div className={styles.row}>
              <label htmlFor="insp-morph">morph</label>
              <select
                id="insp-morph"
                aria-label="morph mode"
                value={kfMorph}
                onChange={(e) => setSelectedShapeKeyframeMorph(e.target.value as MorphMode)}
              >
                <option value="corresponded">Grow</option>
                <option value="resampled">Resample</option>
              </select>
            </div>
          )}
          {kfCorr &&
            (() => {
              const { from, to, map } = kfCorr;
              const cur = map ?? identityCorrespondence(from.nodes.length, to.nodes.length);
              const n = to.nodes.length;
              return (
                <div className={styles.row}>
                  <span>correspondence</span>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedShapeKeyframeCorrespondence(suggestCorrespondence(from, to))
                    }
                  >
                    Suggest correspondence
                  </button>
                  {to.closed && (
                    <>
                      <button
                        type="button"
                        aria-label="Shift correspondence backward"
                        onClick={() =>
                          setSelectedShapeKeyframeCorrespondence(shiftCorrespondence(cur, n, -1))
                        }
                      >
                        ◀
                      </button>
                      <button
                        type="button"
                        aria-label="Shift correspondence forward"
                        onClick={() =>
                          setSelectedShapeKeyframeCorrespondence(shiftCorrespondence(cur, n, 1))
                        }
                      >
                        ▶
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedShapeKeyframeCorrespondence(reverseCorrespondence(cur, n))
                    }
                  >
                    Reverse correspondence winding
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const st = useEditor.getState();
                      if (st.correspondenceEditing) {
                        st.exitCorrespondenceEdit();
                      } else {
                        // The overlay renders only in the node tool (it reuses the node-edit
                        // transform), so entering edit mode must establish that precondition.
                        st.setActiveTool('node');
                        st.enterCorrespondenceEdit();
                      }
                    }}
                  >
                    Edit links
                  </button>
                  <span>{correspondenceSummary(map, from, to)}</span>
                </div>
              );
            })()}
        </>
      )}
      {nodeEasingCtx && (
        <>
          <div className={styles.group}>Node easing</div>
          <div className={styles.row}>node {nodeEasingCtx.index} — overrides keyframe easing</div>
          <EasingEditor value={nodeEasingCtx.value} onChange={setSelectedNodeEasing} inert={nodeEasingCtx.inert} />
          <div className={styles.row}>
            <button type="button" onClick={() => setSelectedNodeEasing(undefined)}>
              reset to keyframe default
            </button>
          </div>
        </>
      )}
    </div>
  );
}
