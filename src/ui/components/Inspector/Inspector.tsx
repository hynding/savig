import { useEffect, useRef, useState } from 'react';
import { sampleObject } from '../../../engine';
import type { AnimatableProperty } from '../../../engine';
import { useEditor } from '../../store/store';
import { selectSelectedObject } from '../../store/selectors';
import styles from './Inspector.module.css';

const TRANSFORM_FIELDS: AnimatableProperty[] = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity'];

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
  const { setProperty, setAnchor } = useEditor.getState();

  if (!obj) return <div className={styles.hint}>No object selected</div>;

  const sampled = sampleObject(obj, time);

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
    </div>
  );
}
