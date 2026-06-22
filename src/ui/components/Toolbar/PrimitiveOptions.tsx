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
  const primitiveCornerRadius = useEditor((s) => s.primitiveCornerRadius);
  const brushSize = useEditor((s) => s.brushSize);
  const brushSmoothing = useEditor((s) => s.brushSmoothing);
  const setPolygonSides = useEditor((s) => s.setPolygonSides);
  const setStarPoints = useEditor((s) => s.setStarPoints);
  const setStarInnerRatio = useEditor((s) => s.setStarInnerRatio);
  const setPrimitiveCornerRadius = useEditor((s) => s.setPrimitiveCornerRadius);
  const setBrushSize = useEditor((s) => s.setBrushSize);
  const setBrushSmoothing = useEditor((s) => s.setBrushSmoothing);

  const cornerRadiusField = (
    <label>
      Corner radius
      <input
        type="number"
        min={0}
        step={1}
        value={primitiveCornerRadius}
        onChange={(e) => setPrimitiveCornerRadius(Number(e.target.value))}
      />
    </label>
  );

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
        {cornerRadiusField}
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
        {cornerRadiusField}
      </div>
    );
  }
  if (tool === 'brush') {
    return (
      <div className={styles.bar} role="group" aria-label="Brush options">
        <label>
          Size
          <input
            type="number"
            min={1}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
          />
        </label>
        <label>
          Smoothing
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={brushSmoothing}
            onChange={(e) => setBrushSmoothing(Number(e.target.value))}
          />
        </label>
      </div>
    );
  }
  return null;
}
