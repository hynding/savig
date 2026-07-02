// Framework-neutral view-model + intents for the AssetPanel (slice 4, task 4). Mirrors
// packages/ui-core/src/viewmodels/{inspector,timeline,layersPanel,sceneStrip}.ts:
// `assetPanelViewModel` is a PURE function `EditorState -> AssetPanelVM` covering every
// store-derived value `AssetPanel.tsx` used to compute inline — the library-asset (svg/audio)
// row list, the symbol row list with its instance count and containment-cycle guard — so it
// would read identically if the panel were rewritten in Svelte or Vue. `assetPanelIntents` are
// thin wrappers around store actions — no logic beyond dispatch.
//
// Deliberately NOT extracted (left in AssetPanel.tsx):
//  - File-read (`readFileText`/`readFileBytes`, the SVG/audio `<input type="file">` `onChange`
//    handlers) — reading a `File` is a browser-runtime concern, not a store derivation.
//  - Symbol-thumbnail RENDERING (`symbolThumbnailSvg`, via `<SymbolThumbnail>`) — mirrors the
//    SceneStrip precedent (`sceneThumbnailSvg` stays in `SceneStrip.tsx`): it's an app-local
//    helper `@savig/ui-core` is not allowed to import. The VM exposes the raw `SymbolAsset` +
//    project-level `assets`/`meta` each row needs to call it, exactly as `AssetPanel.tsx` did
//    before this refactor.
//  - Rename-in-progress input state (`editingId`, the rename `<input>`'s local draft/cancel
//    handling) and the symbol place-button's drag-source POINTER handler (`onDragStart`,
//    which just stashes the symbol id via `dataTransfer` for the Stage drop target — slice 5's
//    drag-to-place). These are an L2 controller concern — extracting them now would risk
//    entangling pointer/file state with this VM.
import { countSymbolInstances, symbolContains } from '@savig/engine';
import type { Asset, ProjectMeta, SymbolAsset } from '@savig/engine';
import { selectActiveAssetId } from '@savig/editor-state';
import type { EditorState, Toast } from '@savig/editor-state';

export interface AssetPanelLibraryRowVM {
  id: string;
  name: string;
  kind: 'svg' | 'audio';
}

export interface AssetPanelSymbolRowVM {
  id: string;
  name: string;
  instanceCount: number;
  /** Placing this symbol would create a containment cycle (only reachable while editing inside
   *  a symbol) — the place button is disabled and shows a "would create a containment cycle"
   *  tooltip when true. */
  cyclic: boolean;
  /** Raw asset — the component renders its thumbnail via the app-local
   *  `symbolThumbnailSvg(symbol, assets, meta)` helper (see file header). */
  symbol: SymbolAsset;
}

export interface AssetPanelVM {
  /** Reusable library imports (`svg`/`audio` assets) — a per-shape `vector` asset is 1:1 with
   *  its object (not a library item) and is never listed here; `symbol` assets have their own
   *  section below (47d). */
  libraryAssets: AssetPanelLibraryRowVM[];
  symbols: AssetPanelSymbolRowVM[];
  /** Raw project assets — passed through for the component's thumbnail rendering. */
  assets: Asset[];
  meta: ProjectMeta;
}

export function assetPanelViewModel(s: EditorState): AssetPanelVM {
  const present = s.history.present;
  const { objects, assets, scenes, meta } = present;
  const activeAssetId = selectActiveAssetId(s);

  const libraryAssets: AssetPanelLibraryRowVM[] = assets
    .filter((a): a is Asset & { kind: 'svg' | 'audio' } => a.kind === 'svg' || a.kind === 'audio')
    .map((a) => ({ id: a.id, name: a.name, kind: a.kind }));

  const symbols: AssetPanelSymbolRowVM[] = assets
    .filter((a): a is SymbolAsset => a.kind === 'symbol')
    .map((sym) => ({
      id: sym.id,
      name: sym.name,
      instanceCount: countSymbolInstances(sym.id, { objects, assets, scenes }),
      cyclic: !!activeAssetId && (sym.id === activeAssetId || symbolContains(sym.id, activeAssetId, assets)),
      symbol: sym,
    }));

  return { libraryAssets, symbols, assets, meta };
}

/** The minimal shape `assetPanelIntents` needs from the vanilla `@savig/editor-state` store —
 *  avoids importing zustand's `StoreApi` type just for this signature. `store` (the real
 *  vanilla StoreApi) satisfies this structurally. */
export interface AssetPanelStore {
  getState: () => EditorState;
}

export function assetPanelIntents(store: AssetPanelStore) {
  const s = () => store.getState();
  return {
    addAsset: (asset: Asset, bytes?: Uint8Array) => s().addAsset(asset, bytes),
    addObject: (assetId: string) => s().addObject(assetId),
    addAudioClip: (assetId: string) => s().addAudioClip(assetId),
    placeSymbolInstance: (symId: string) => s().placeSymbolInstance(symId),
    pushToast: (kind: Toast['kind'], message: string) => s().pushToast(kind, message),
    renameAsset: (assetId: string, name: string) => s().renameAsset(assetId, name),
    deleteSymbol: (symId: string) => s().deleteSymbol(symId),
    deleteAsset: (assetId: string) => s().deleteAsset(assetId),
  };
}
