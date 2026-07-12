import { useMemo } from 'react';
import type { Asset, ProjectMeta, SymbolAsset } from '@savig/engine';
import { symbolThumbnailSvg, svgDataUri } from './thumbnailSvg';
import styles from './AssetPanel.module.css';

export function SymbolThumbnail({ symbol, assets, meta }: { symbol: SymbolAsset; assets: Asset[]; meta: ProjectMeta }) {
  const svg = useMemo(() => symbolThumbnailSvg(symbol, assets, meta), [symbol, assets, meta]);
  // A <span> (not <div>) keeps the markup valid inside the row's <button>.
  if (!svg) return <span className={styles.thumbEmpty} data-testid="symbol-thumb-empty" aria-hidden />;
  // <img> (not dangerouslySetInnerHTML): the SVG's ids (gradient defs, etc.) never enter the live
  // document, so they can't collide with the Stage's own ids, and injected markup can't execute.
  return <img className={styles.thumb} src={svgDataUri(svg)} alt="" data-testid="symbol-thumb" aria-hidden />;
}
