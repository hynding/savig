// Framework-neutral view-model + intents for the Swatches panel (roadmap 12: color swatches and
// global colors). `swatchesViewModel` is a PURE function `EditorState -> SwatchesVM`;
// `swatchesIntents` are thin wrappers around store actions.
import { linkedSwatch, projectSwatches, swatchUsage } from '@savig/engine';
import type { Swatch, SwatchPaint, SwatchPatch } from '@savig/engine';
import { selectActiveObjects } from '@savig/editor-state';
import type { EditorState } from '@savig/editor-state';

export interface SwatchVM {
  id: string;
  name: string;
  color: string;
  global: boolean;
  /** Fills/strokes currently linked to this (global) swatch. */
  usage: number;
}

export interface SwatchesVM {
  swatches: SwatchVM[];
  /** Something selected can take a swatch (a vector shape or text). */
  canPaint: boolean;
  /** The global swatches the selected object's fill / stroke are linked to (null = none). */
  links: Record<SwatchPaint, Pick<Swatch, 'id' | 'name'> | null>;
}

export function swatchesViewModel(s: EditorState): SwatchesVM {
  const project = s.history.present;
  const swatches = projectSwatches(project).map((sw) => ({
    id: sw.id,
    name: sw.name,
    color: sw.color,
    global: !!sw.global,
    usage: sw.global ? swatchUsage(project, sw.id) : 0,
  }));
  const objects = selectActiveObjects(s);
  const assets = new Map(project.assets.map((a) => [a.id, a] as const));
  const ids = s.selectedObjectIds.length > 0 ? s.selectedObjectIds : s.selectedObjectId ? [s.selectedObjectId] : [];
  const paintable = ids.some((id) => {
    const o = objects.find((x) => x.id === id);
    const k = o?.assetId ? assets.get(o.assetId)?.kind : undefined;
    return k === 'vector' || k === 'text';
  });
  const sel = objects.find((o) => o.id === s.selectedObjectId);
  const selAsset = sel?.assetId ? assets.get(sel.assetId) : undefined;
  const link = (paint: SwatchPaint) => {
    const sw = selAsset ? linkedSwatch(project, selAsset, paint) : undefined;
    return sw ? { id: sw.id, name: sw.name } : null;
  };
  return { swatches, canPaint: paintable, links: { fill: link('fill'), stroke: link('stroke') } };
}

export interface SwatchesStore {
  getState: () => EditorState;
}

export function swatchesIntents(store: SwatchesStore) {
  const s = () => store.getState();
  return {
    addSwatch: (color?: string, opts?: { name?: string; global?: boolean }) => s().addSwatch(color, opts),
    updateSwatch: (id: string, patch: SwatchPatch) => s().updateSwatch(id, patch),
    removeSwatch: (id: string) => s().removeSwatch(id),
    moveSwatch: (id: string, index: number) => s().moveSwatch(id, index),
    applySwatch: (id: string, paint: SwatchPaint) => s().applySwatch(id, paint),
  };
}
