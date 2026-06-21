import { useEditor } from '../../store/store';
import styles from './ToolPalette.module.css';

// Creation-time options for the primitive tools. Rendered only while a primitive
// tool is active; the values feed the Stage drag generator (they are not stored on
// the asset — a stamped primitive is an ordinary editable path).
export function PrimitiveOptions() {
  const tool = useEditor((s) => s.activeTool);
  const polygonSides = useEditor((s) => s.polygonSides);
  const starPoints = useEditor((s) => s.starPoints);
  const starInnerRatio = useEditor((s) => s.starInnerRatio);
  const setPolygonSides = useEditor((s) => s.setPolygonSides);
  const setStarPoints = useEditor((s) => s.setStarPoints);
  const setStarInnerRatio = useEditor((s) => s.setStarInnerRatio);

  if (tool === 'polygon') {
    return (
      <div className={styles.bar} role="group" aria-label="Polygon options">
        <label>
          Sides
          <input
            type="number"
            min={3}
            value={polygonSides}
            onChange={(e) => setPolygonSides(Number(e.target.value))}
          />
        </label>
      </div>
    );
  }
  if (tool === 'star') {
    return (
      <div className={styles.bar} role="group" aria-label="Star options">
        <label>
          Points
          <input
            type="number"
            min={2}
            value={starPoints}
            onChange={(e) => setStarPoints(Number(e.target.value))}
          />
        </label>
        <label>
          Inner ratio
          <input
            type="number"
            min={0.01}
            max={0.99}
            step={0.05}
            value={starInnerRatio}
            onChange={(e) => setStarInnerRatio(Number(e.target.value))}
          />
        </label>
      </div>
    );
  }
  return null;
}
