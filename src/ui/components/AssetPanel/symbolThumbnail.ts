import type { Asset, Project, ProjectMeta, SymbolAsset } from '../../../engine';
import { renderSvgDocument } from '../../../services';
import { sceneContentAABB } from '../Stage/snapping';

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
  return renderSvgDocument(project, { viewBox: `${box.minX} ${box.minY} ${w} ${h}` });
}
