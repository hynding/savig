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
import { countSymbolInstances, naturalCompare, symbolContains } from '@savig/engine';
import type { Asset, ImageAsset, ProjectMeta, SymbolAsset } from '@savig/engine';
import { selectActiveAssetId } from '@savig/editor-state';
import type { EditorState, Toast } from '@savig/editor-state';

export interface AssetPanelLibraryRowVM {
  id: string;
  name: string;
  kind: 'svg' | 'audio' | 'image';
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

/** A library folder (roadmap 11) with what it holds, already sorted for display: sub-folders by
 *  name, then items in project order. */
export interface AssetPanelFolderVM {
  id: string;
  name: string;
  folders: AssetPanelFolderVM[];
  assets: AssetPanelLibraryRowVM[];
  symbols: AssetPanelSymbolRowVM[];
  /** Items at any depth inside (shown next to the name). */
  itemCount: number;
}

export interface AssetPanelVM {
  /** Reusable library imports (`svg`/`audio`/`image` assets) at the library ROOT (not in a folder)
   *  — a per-shape `vector` asset is 1:1 with its object (not a library item) and is never listed
   *  here; `symbol` assets have their own section below (47d). */
  libraryAssets: AssetPanelLibraryRowVM[];
  /** Symbols at the library root. */
  symbols: AssetPanelSymbolRowVM[];
  /** Root-level library folders (roadmap 11), each holding its own items and sub-folders. */
  folders: AssetPanelFolderVM[];
  /** Raw project assets — passed through for the component's thumbnail rendering. */
  assets: Asset[];
  meta: ProjectMeta;
}

export function assetPanelViewModel(s: EditorState): AssetPanelVM {
  const present = s.history.present;
  const { objects, assets, scenes, meta } = present;
  const activeAssetId = selectActiveAssetId(s);

  const folderList = present.libraryFolders ?? [];
  const folderIds = new Set(folderList.map((f) => f.id));
  // An item whose folder is missing shows at the root (load-time sanitize normally prevents it).
  const placeOf = (folderId: string | undefined) => (folderId !== undefined && folderIds.has(folderId) ? folderId : '');

  const assetRows = assets
    .filter((a): a is Asset & { kind: 'svg' | 'audio' | 'image' } => a.kind === 'svg' || a.kind === 'audio' || a.kind === 'image')
    .map((a) => ({ row: { id: a.id, name: a.name, kind: a.kind } as AssetPanelLibraryRowVM, place: placeOf(a.folderId) }));

  const symbolRows = assets
    .filter((a): a is SymbolAsset => a.kind === 'symbol')
    .map((sym) => ({
      row: {
        id: sym.id,
        name: sym.name,
        instanceCount: countSymbolInstances(sym.id, { objects, assets, scenes }),
        cyclic: !!activeAssetId && (sym.id === activeAssetId || symbolContains(sym.id, activeAssetId, assets)),
        symbol: sym,
      } as AssetPanelSymbolRowVM,
      place: placeOf(sym.folderId),
    }));

  const build = (parent: string, seen: Set<string>): AssetPanelFolderVM[] =>
    folderList
      .filter((f) => (f.parentId !== undefined && folderIds.has(f.parentId) ? f.parentId : '') === parent && !seen.has(f.id))
      .sort((a, b) => naturalCompare(a.name, b.name))
      .map((f) => {
        const inner = build(f.id, new Set([...seen, f.id]));
        const own = {
          assets: assetRows.filter((r) => r.place === f.id).map((r) => r.row),
          symbols: symbolRows.filter((r) => r.place === f.id).map((r) => r.row),
        };
        const itemCount = own.assets.length + own.symbols.length + inner.reduce((n, c) => n + c.itemCount, 0);
        return { id: f.id, name: f.name, folders: inner, ...own, itemCount };
      });

  const libraryAssets = assetRows.filter((r) => r.place === '').map((r) => r.row);
  const symbols = symbolRows.filter((r) => r.place === '').map((r) => r.row);
  return { libraryAssets, symbols, folders: build('', new Set()), assets, meta };
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
    importImageSequence: (images: ImageAsset[], opts?: { hold?: number; name?: string }) => s().importImageSequence(images, opts),
    createLibraryFolder: (name?: string, parentId?: string | null) => s().createLibraryFolder(name, parentId),
    renameLibraryFolder: (folderId: string, name: string) => s().renameLibraryFolder(folderId, name),
    deleteLibraryFolder: (folderId: string) => s().deleteLibraryFolder(folderId),
    moveToLibraryFolder: (ids: string[], folderId: string | null) => s().moveToLibraryFolder(ids, folderId),
  };
}
