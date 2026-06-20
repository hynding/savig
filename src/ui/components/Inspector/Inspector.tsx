import { useEffect, useRef, useState } from 'react';
import { sampleObject } from '../../../engine';
import { useEditor } from '../../store/store';
import { selectSelectedObject } from '../../store/selectors';
import styles from './Inspector.module.css';

const TRANSFORM_FIELDS = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity'] as const;
const RECT_GEOMETRY = ['width', 'height', 'cornerRadius'] as const;
const ELLIPSE_GEOMETRY = ['radiusX', 'radiusY'] as const;

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
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
  const autoKey = useEditor((s) => s.autoKey);
  const assets = useEditor((s) => s.history.present.assets);
  const { setProperty, setAnchor, setVectorStyle } = useEditor.getState();

  if (!obj) return <div className={styles.hint}>No object selected</div>;

  const sampled = sampleObject(obj, time);
  const asset = assets.find((a) => a.id === obj.assetId);
  const vector = asset && asset.kind === 'vector' ? asset : null;

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
      {vector && (
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
          <div className={styles.group}>Style</div>
          <div className={styles.row}>
            <label htmlFor="insp-fill">fill</label>
            <input
              type="checkbox"
              aria-label="fill enabled"
              checked={vector.style.fill !== 'none'}
              onChange={(e) => setVectorStyle({ fill: e.target.checked ? '#cccccc' : 'none' })}
            />
            <input
              id="insp-fill"
              aria-label="fill"
              type="color"
              disabled={vector.style.fill === 'none'}
              value={vector.style.fill === 'none' ? '#cccccc' : vector.style.fill}
              onChange={(e) => setVectorStyle({ fill: e.target.value })}
            />
          </div>
          <div className={styles.row}>
            <label htmlFor="insp-stroke">stroke</label>
            <input
              type="checkbox"
              aria-label="stroke enabled"
              checked={vector.style.stroke !== 'none'}
              onChange={(e) => setVectorStyle({ stroke: e.target.checked ? '#000000' : 'none' })}
            />
            <input
              id="insp-stroke"
              aria-label="stroke"
              type="color"
              disabled={vector.style.stroke === 'none'}
              value={vector.style.stroke === 'none' ? '#000000' : vector.style.stroke}
              onChange={(e) => setVectorStyle({ stroke: e.target.value })}
            />
          </div>
          <div className={styles.row}>
            <label htmlFor="insp-strokeWidth">strokeWidth</label>
            <NumberField label="strokeWidth" value={round(vector.style.strokeWidth)} onCommit={(n) => setVectorStyle({ strokeWidth: n })} />
          </div>
        </>
      )}
    </div>
  );
}
