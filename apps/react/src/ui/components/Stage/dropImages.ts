import { importImage } from '@savig/services';
import { useEditor } from '../../store/store';
import { readFileBytes } from '../AssetPanel/readFile';

/** Bitmap import (spec 2026-11-15-bitmap-import): import each dropped image file and place it
 *  centred on `at` (later files step down-right so a multi-file drop doesn't stack exactly).
 *  Non-image files are reported with a toast and skipped. */
export async function dropImageFiles(files: File[], at: { x: number; y: number } | null): Promise<void> {
  let step = 0;
  for (const file of files) {
    const s = useEditor.getState();
    try {
      const asset = importImage(file.name, await readFileBytes(file));
      s.addAsset(asset);
      const point = at ? { x: at.x + step * 20, y: at.y + step * 20 } : undefined;
      useEditor.getState().addObject(asset.id, point);
      step += 1;
    } catch (err) {
      s.pushToast('error', (err as Error).message);
    }
  }
}
