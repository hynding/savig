import { sampleObject } from '../../../engine';
import type { AnimatableProperty } from '../../../engine';
import { useEditor } from '../../store/store';
import { selectSelectedObject } from '../../store/selectors';
import styles from './Inspector.module.css';

const TRANSFORM_FIELDS: AnimatableProperty[] = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity'];

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
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
          <input
            id={`insp-${prop}`}
            aria-label={prop}
            type="number"
            step={prop === 'opacity' ? 0.1 : 1}
            disabled={!autoKey}
            value={Number.isFinite(sampled[prop]) ? round(sampled[prop]) : 0}
            onChange={(e) => setProperty(prop, Number(e.target.value))}
          />
        </div>
      ))}
      <div className={styles.group}>Anchor</div>
      {(['anchorX', 'anchorY'] as const).map((key) => (
        <div key={key} className={styles.row}>
          <label htmlFor={`insp-${key}`}>{key}</label>
          <input
            id={`insp-${key}`}
            aria-label={key}
            type="number"
            value={round(obj[key])}
            onChange={(e) => {
              const ax = key === 'anchorX' ? Number(e.target.value) : obj.anchorX;
              const ay = key === 'anchorY' ? Number(e.target.value) : obj.anchorY;
              setAnchor(ax, ay);
            }}
          />
        </div>
      ))}
    </div>
  );
}
