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
            title="Bakes the stroke as a filled outline — draw-on (trim) and stroke animation won't apply."
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
            title="Bakes the stroke as a filled outline — draw-on (trim) and stroke animation won't apply."
          />
        </label>
        <label>
          Pressure
          <input
            type="checkbox"
            checked={vm.brushUsePressure}
            onChange={(e) => intents.setBrushUsePressure(e.target.checked)}
            title="Bakes the stroke as a filled outline — draw-on (trim) and stroke animation won't apply."
          />
        </label>
      </div>
    );
  }
  if (vm.kind === 'spray') {
    const sp = vm.spray;
    const symbolKnown = sp.symbolId !== null && vm.spraySymbols.some((x) => x.id === sp.symbolId);
    return (
      <div className={styles.bar} role="group" aria-label="Spray brush options">
        <label>
          Spray
          <select
            aria-label="Spray symbol"
            value={symbolKnown ? sp.symbolId! : ''}
            onChange={(e) => intents.setSprayOptions({ symbolId: e.target.value || null })}
            title="What to spray: plain dots, or copies of a symbol from the Library"
          >
            <option value="">Dots</option>
            {vm.spraySymbols.map((x) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </select>
        </label>
        {!symbolKnown && (
          <>
            <label>
              Dot
              <input type="number" aria-label="Spray dot size" min={1} max={200} value={sp.dotSize} onChange={(e) => intents.setSprayOptions({ dotSize: Number(e.target.value) })} />
            </label>
            <input type="color" aria-label="Spray color" value={sp.color} onChange={(e) => intents.setSprayOptions({ color: e.target.value })} />
          </>
        )}
        <label>
          Radius
          <input type="number" aria-label="Spray radius" min={1} max={500} value={sp.radius} onChange={(e) => intents.setSprayOptions({ radius: Number(e.target.value) })} />
        </label>
        <label>
          Density
          <input type="number" aria-label="Spray density" min={1} max={50} value={sp.density} onChange={(e) => intents.setSprayOptions({ density: Number(e.target.value) })} title="Copies per burst; one burst per radius of travel" />
        </label>
        <label>
          Scale
          <input type="number" aria-label="Spray scale min" min={1} max={1000} step={10} value={Math.round(sp.scaleMin * 100)} onChange={(e) => intents.setSprayOptions({ scaleMin: Number(e.target.value) / 100 })} />
          –
          <input type="number" aria-label="Spray scale max" min={1} max={1000} step={10} value={Math.round(sp.scaleMax * 100)} onChange={(e) => intents.setSprayOptions({ scaleMax: Number(e.target.value) / 100 })} />
          %
        </label>
        <label>
          Rotate
          <input type="number" aria-label="Spray rotation" min={0} max={360} step={15} value={sp.rotation} onChange={(e) => intents.setSprayOptions({ rotation: Number(e.target.value) })} title="Random rotation range in degrees (0 keeps copies upright)" />
        </label>
      </div>
    );
  }
  if (vm.kind === 'bucket') {
    return (
      <div className={styles.bar} role="group" aria-label="Paint bucket options">
        <label>
          Fill
          <input
            type="color"
            aria-label="Bucket color"
            value={vm.bucketColor}
            onChange={(e) => intents.setBucketColor(e.target.value)}
          />
        </label>
      </div>
    );
  }
  if (vm.kind === 'lasso') {
    return (
      <div className={styles.bar} role="group" aria-label="Lasso options">
        <button aria-label="Freehand lasso" aria-pressed={vm.lassoMode === 'freehand'} title="Drag a loop" onClick={() => intents.setLassoMode('freehand')}>
          Freehand
        </button>
        <button aria-label="Polygon lasso" aria-pressed={vm.lassoMode === 'polygon'} title="Click corners; click the first one (or double-click) to close, Esc to cancel" onClick={() => intents.setLassoMode('polygon')}>
          Polygon
        </button>
      </div>
    );
  }
  if (vm.kind === 'eraser') {
    return (
      <div className={styles.bar} role="group" aria-label="Eraser options">
        <label>
          Size
          <input
            type="number"
            min={1}
            max={500}
            aria-label="Eraser size"
            value={vm.eraserSize}
            onChange={(e) => intents.setEraserSize(Number(e.target.value))}
          />
        </label>
      </div>
    );
  }
  return null;
}
