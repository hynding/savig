// Framework-neutral view-model + intents for the LayersPanel (slice 4, task 3). Mirrors
// packages/ui-core/src/viewmodels/{inspector,timeline}.ts: `layersPanelViewModel` is a PURE
// function `EditorState -> LayersPanelVM` covering every store-derived value `LayersPanel.tsx`
// used to compute inline — the front-first depth-first row tree, per-row name/visibility/lock
// (own vs. cascade, mirroring Timeline's `ownLocked`/`locked`), and selection — so it would read
// identically if the panel were rewritten in Svelte or Vue. `layersPanelIntents` are thin
// wrappers around store actions — no logic beyond dispatch.
//
// Deliberately NOT extracted (left in LayersPanel.tsx):
//  - Collapse/expand state (`collapsed`, a `Set<string>` of collapsed group ids) is ephemeral
//    component-local UI state, not derivable from `EditorState`. The VM returns the FULL tree
//    (every row, uncollapsed); the component filters out a collapsed group's descendants at
//    render time using each row's `depth`.
//  - Rename-in-progress input state (`editingId`/`draft`) and the drag-reorder/reparent POINTER
//    handlers (`onDragStart`/`onDragOver`/`onDrop`, `dragIdRef`/`dropTargetId`). These are an L2
//    controller concern (slice 5) — extracting them now would risk entangling pointer state with
//    this VM.
import { isLockedInTree } from '@savig/engine';
import type { SceneObject } from '@savig/engine';
import { selectActiveObjects } from '@savig/editor-state';
import type { EditorState } from '@savig/editor-state';

export interface LayersPanelRowVM {
  id: string;
  name: string;
  /** Nesting depth in the front-first tree (0 = top-level). */
  depth: number;
  parentId: string | null;
  isGroup: boolean;
  hidden: boolean;
  /** The object's OWN lock — mirrors the lock button's pressed state. */
  ownLocked: boolean;
  /** Own lock OR an ancestor group's lock (cascade) — gates selection/drag/reorder. */
  locked: boolean;
  selected: boolean;
}

export interface LayersPanelVM {
  rows: LayersPanelRowVM[];
}

export function layersPanelViewModel(s: EditorState): LayersPanelVM {
  const objects = selectActiveObjects(s);
  const lockById = new Map(objects.map((o) => [o.id, o]));
  const selectedIds = s.selectedObjectIds;

  // Front-first tree (Figma/Photoshop convention): top-level rows by zOrder desc, with each
  // group's children nested beneath it — recursively for NESTED groups. Collapse is NOT applied
  // here (ephemeral component state) — this is the full tree; the component filters at render.
  const byZ = (a: SceneObject, b: SceneObject) => b.zOrder - a.zOrder;
  const rows: LayersPanelRowVM[] = [];
  const seen = new Set<string>();
  const pushSubtree = (o: SceneObject, depth: number) => {
    if (seen.has(o.id)) return; // cycle guard
    seen.add(o.id);
    rows.push({
      id: o.id,
      name: o.name,
      depth,
      parentId: o.parentId ?? null,
      isGroup: !!o.isGroup,
      hidden: !!o.hidden,
      ownLocked: !!o.locked,
      locked: isLockedInTree(o, lockById),
      selected: selectedIds.includes(o.id),
    });
    if (o.isGroup) {
      for (const c of objects.filter((x) => x.parentId === o.id).sort(byZ)) pushSubtree(c, depth + 1);
    }
  };
  for (const o of objects.filter((x) => !x.parentId).sort(byZ)) pushSubtree(o, 0);

  return { rows };
}

/** The minimal shape `layersPanelIntents` needs from the vanilla `@savig/editor-state` store —
 *  avoids importing zustand's `StoreApi` type just for this signature. `store` (the real
 *  vanilla StoreApi) satisfies this structurally. */
export interface LayersPanelStore {
  getState: () => EditorState;
}

export function layersPanelIntents(store: LayersPanelStore) {
  const s = () => store.getState();
  return {
    selectObjectOrGroup: (id: string) => s().selectObjectOrGroup(id),
    toggleObjectOrGroup: (id: string) => s().toggleObjectOrGroup(id),
    toggleObjectVisibility: (id: string) => s().toggleObjectVisibility(id),
    toggleObjectLock: (id: string) => s().toggleObjectLock(id),
    renameObject: (id: string, name: string) => s().renameObject(id, name),
    moveObjectToTarget: (draggedId: string, targetId: string) => s().moveObjectToTarget(draggedId, targetId),
    reparentObject: (id: string, newParentId: string | null) => s().reparentObject(id, newParentId),
  };
}
