// Framework-neutral view-model + intents for the PrimitiveOptions bar (slice 4, task 4).
// Mirrors packages/ui-core/src/viewmodels/{inspector,timeline,layersPanel,sceneStrip}.ts:
// `primitiveOptionsViewModel` is a PURE function `EditorState -> PrimitiveOptionsVM` covering
// every store-derived value `PrimitiveOptions.tsx` used to compute inline — which control
// group is visible for the active tool, and the current param values it edits — so it would
// read identically if the bar were rewritten in Svelte or Vue. `primitiveOptionsIntents` are
// thin wrappers around store actions — no logic beyond dispatch.
//
// These are CREATION-TIME defaults for the primitive tools (fed to the Stage drag generator
// for the next stamped shape — not stored on any asset), distinct from `setPrimitiveParam`
// (which edits an ALREADY-drawn primitive's own asset; see inspector.ts's InspectorSymbolVM
// sibling `primitive` field / `inspectorIntents.setPrimitiveParam`).
import type { EditorState, ToolMode } from '@savig/editor-state';

export type PrimitiveOptionsKind = 'none' | 'polygon' | 'star' | 'brush';

export interface PrimitiveOptionsVM {
  kind: PrimitiveOptionsKind;
  polygonSides: number;
  starPoints: number;
  starInnerRatio: number;
  primitiveCornerRadius: number;
  brushSize: number;
  brushSmoothing: number;
  /** Tapered-brush profile: fraction [0, 0.5] of stroke length ramped at each end (0 = no
   *  taper), plus whether captured pointer pressure scales the width. */
  brushTaperIn: number;
  brushTaperOut: number;
  brushUsePressure: boolean;
}

function primitiveOptionsKind(tool: ToolMode): PrimitiveOptionsKind {
  if (tool === 'polygon' || tool === 'star' || tool === 'brush') return tool;
  return 'none';
}

export function primitiveOptionsViewModel(s: EditorState): PrimitiveOptionsVM {
  return {
    kind: primitiveOptionsKind(s.activeTool),
    polygonSides: s.polygonSides,
    starPoints: s.starPoints,
    starInnerRatio: s.starInnerRatio,
    primitiveCornerRadius: s.primitiveCornerRadius,
    brushSize: s.brushSize,
    brushSmoothing: s.brushSmoothing,
    brushTaperIn: s.brushTaperIn,
    brushTaperOut: s.brushTaperOut,
    brushUsePressure: s.brushUsePressure,
  };
}

/** The minimal shape `primitiveOptionsIntents` needs from the vanilla `@savig/editor-state`
 *  store — avoids importing zustand's `StoreApi` type just for this signature. `store` (the
 *  real vanilla StoreApi) satisfies this structurally. */
export interface PrimitiveOptionsStore {
  getState: () => EditorState;
}

export function primitiveOptionsIntents(store: PrimitiveOptionsStore) {
  const s = () => store.getState();
  return {
    setPolygonSides: (n: number) => s().setPolygonSides(n),
    setStarPoints: (n: number) => s().setStarPoints(n),
    setStarInnerRatio: (r: number) => s().setStarInnerRatio(r),
    setPrimitiveCornerRadius: (n: number) => s().setPrimitiveCornerRadius(n),
    setBrushSize: (n: number) => s().setBrushSize(n),
    setBrushSmoothing: (r: number) => s().setBrushSmoothing(r),
    setBrushTaperIn: (n: number) => s().setBrushTaperIn(n),
    setBrushTaperOut: (n: number) => s().setBrushTaperOut(n),
    setBrushUsePressure: (b: boolean) => s().setBrushUsePressure(b),
  };
}
