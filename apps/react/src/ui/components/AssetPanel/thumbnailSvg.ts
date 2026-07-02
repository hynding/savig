import type { Asset, Project, ProjectMeta, Scene, SymbolAsset } from '@savig/engine';
import { renderSvgDocument } from '@savig/services/export/renderDocument';
import { sceneContentAABB } from '@savig/interaction';

/** SVG markup for a scene's thumbnail at t=0, framed to the project artboard. The scene renders
 *  through the single-scene renderer (scene-view: objects swapped, no nested scenes).
 *  data-savig-object is stripped: thumbnails are display-only and the attribute would collide with
 *  bare [data-savig-object] selectors in tests (Stage and SceneStrip share the same DOM). */
export function sceneThumbnailSvg(scene: Scene, assets: Asset[], meta: ProjectMeta): string {
  const project: Project = { meta, assets, objects: scene.objects, audioClips: [], camera: scene.camera };
  return renderSvgDocument(project, { viewBox: `0 0 ${meta.width} ${meta.height}` })
    .replace(/ data-savig-object="[^"]*"/g, '');
}

// The SVG string for a symbol's content thumbnail, framed to its content bounds at t=0, or null when
// the symbol has no drawable content (the caller renders a placeholder). Reuses renderSvgDocument so
// the thumbnail matches preview/export; a NEW consumer that never affects the export bundle. (47d)
export function symbolThumbnailSvg(symbol: SymbolAsset, assets: Asset[], meta: ProjectMeta): string | null {
  const box = sceneContentAABB(symbol.objects, assets, 0);
  if (!box) return null;
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  if (w <= 0 || h <= 0) return null;
  const project: Project = { meta, assets, objects: symbol.objects, audioClips: [] };
  // Strip data-savig-object: prevents collision with bare [data-savig-object] selectors in tests.
  return renderSvgDocument(project, { viewBox: `${box.minX} ${box.minY} ${w} ${h}` })
    .replace(/ data-savig-object="[^"]*"/g, '');
}
