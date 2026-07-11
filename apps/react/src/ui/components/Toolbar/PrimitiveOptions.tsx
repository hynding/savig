import { useMemo } from 'react';
import { store } from '@savig/editor-state';
import { primitiveOptionsViewModel, primitiveOptionsIntents } from '@savig/ui-core';
import { useEditorVM } from '../../store/store';
import styles from './ToolPalette.module.css';

// Creation-time options for the primitive tools. Rendered only while a primitive
// tool is active; the values feed the Stage drag generator (they are not stored on
// the asset — a stamped primitive is an ordinary editable path).
export function PrimitiveOptions() {
  const vm = useEditorVM(primitiveOptionsViewModel);
  const intents = useMemo(() => primitiveOptionsIntents(store), []);

  const cornerRadiusField = (
    <label>
      Corner radius
      <input
        type="number"
        min={0}
        step={1}
        value={vm.primitiveCornerRadius}
        onChange={(e) => intents.setPrimitiveCornerRadius(Number(e.target.value))}
      />
    </label>
  );

  if (vm.kind === 'polygon') {
    return (
      <div className={styles.bar} role="group" aria-label="Polygon options">
        <label>
          Sides
          <input
            type="number"
            min={3}
            value={vm.polygonSides}
            onChange={(e) => intents.setPolygonSides(Number(e.target.value))}
          />
        </label>
        {cornerRadiusField}
      </div>
    );
  }
  if (vm.kind === 'star') {
    return (
      <div className={styles.bar} role="group" aria-label="Star options">
        <label>
          Points
          <input
            type="number"
            min={2}
            value={vm.starPoints}
            onChange={(e) => intents.setStarPoints(Number(e.target.value))}
          />
        </label>
        <label>
          Inner ratio
          <input
            type="number"
            min={0.01}
            max={0.99}
            step={0.05}
            value={vm.starInnerRatio}
            onChange={(e) => intents.setStarInnerRatio(Number(e.target.value))}
          />
        </label>
        {cornerRadiusField}
      </div>
    );
  }
  if (vm.kind === 'brush') {
    return (
      <div className={styles.bar} role="group" aria-label="Brush options">
        <label>
          Size
          <input
            type="number"
            min={1}
            value={vm.brushSize}
            onChange={(e) => intents.setBrushSize(Number(e.target.value))}
          />
        </label>
        <label>
          Smoothing
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={vm.brushSmoothing}
            onChange={(e) => intents.setBrushSmoothing(Number(e.target.value))}
          />
        </label>
        <label>
          Taper in
          <input
            type="range"
            min={0}
            max={50}
            step={5}
            value={Math.round(vm.brushTaperIn * 100)}
            onChange={(e) => intents.setBrushTaperIn(Number(e.target.value) / 100)}
          />
        </label>
        <label>
          Taper out
          <input
            type="range"
            min={0}
            max={50}
            step={5}
            value={Math.round(vm.brushTaperOut * 100)}
            onChange={(e) => intents.setBrushTaperOut(Number(e.target.value) / 100)}
          />
        </label>
        <label>
          Pressure
          <input
            type="checkbox"
            checked={vm.brushUsePressure}
            onChange={(e) => intents.setBrushUsePressure(e.target.checked)}
          />
        </label>
      </div>
    );
  }
  return null;
}
