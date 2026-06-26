import { useMemo } from 'react';
import type { Asset, ProjectMeta, SymbolAsset } from '../../../engine';
import { symbolThumbnailSvg } from './thumbnailSvg';
import styles from './AssetPanel.module.css';

export function SymbolThumbnail({ symbol, assets, meta }: { symbol: SymbolAsset; assets: Asset[]; meta: ProjectMeta }) {
  const svg = useMemo(() => symbolThumbnailSvg(symbol, assets, meta), [symbol, assets, meta]);
  // A <span> (not <div>) keeps the markup valid inside the row's <button>.
  if (!svg) return <span className={styles.thumbEmpty} data-testid="symbol-thumb-empty" aria-hidden />;
  return <span className={styles.thumb} data-testid="symbol-thumb" aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />;
}
