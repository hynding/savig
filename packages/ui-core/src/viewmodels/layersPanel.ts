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
import { exposedFrameKeyId, isLockedInTree } from '@savig/engine';
import type { SceneObject } from '@savig/engine';
import { selectActiveObjects } from '@savig/editor-state';
import type { EditorState } from '@savig/editor-state';
import { buildLockIndex } from './lockIndex';

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
  /** Frame-by-frame layer rows only: which frame's drawing is listed beneath it, e.g.
   *  "Frame 4", "Frame 4 · walk", or "No frame" before the first key / past the end. */
  frameCaption?: string;
  /** Mask layers (spec 2026-11-13): 'mask' on an `isMask` row; 'masked' on a row whose
   *  `maskedBy` names a mask in this scene (absent otherwise). */
  maskRole?: 'mask' | 'masked';
  /** On a 'masked' row: the mask's display name (for the badge tooltip). */
  maskName?: string;
  /** Bones (spec 2026-11-13-bone-tool): present (true) on a bone row. */
  bone?: true;
  /** Bone skinning: present (true) on a skinned drawing's row. */
  skin?: true;
}

export interface LayersPanelVM {
  rows: LayersPanelRowVM[];
}

export function layersPanelViewModel(s: EditorState): LayersPanelVM {
  const objects = selectActiveObjects(s);
  const lockById = buildLockIndex(objects);
  const selectedIds = s.selectedObjectIds;
  const fps = s.history.present.meta.fps;
  const objectsById = new Map(objects.map((o) => [o.id, o] as const));

  // Front-first tree (Figma/Photoshop convention): top-level rows by zOrder desc, with each
  // group's children nested beneath it — recursively for NESTED groups. Collapse is NOT applied
  // here (ephemeral component state) — this is the full tree; the component filters at render.
  const byZ = (a: SceneObject, b: SceneObject) => b.zOrder - a.zOrder;
  const rows: LayersPanelRowVM[] = [];
  const seen = new Set<string>();
  const pushSubtree = (o: SceneObject, depth: number) => {
    if (seen.has(o.id)) return; // cycle guard
    seen.add(o.id);
    // A frame-by-frame layer lists only the drawing exposed at the playhead (spec §Layers panel).
    const exposedKey = o.isGroup && o.frames ? exposedFrameKeyId(o.frames, s.time) : undefined;
    const key = exposedKey ? o.frames!.keys.find((k) => k.id === exposedKey) : undefined;
    const frameCaption = o.isGroup && o.frames
      ? key
        ? `Frame ${Math.round(key.time * fps) + 1}${key.label ? ` · ${key.label}` : ''}`
        : 'No frame'
      : undefined;
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
      ...(frameCaption !== undefined ? { frameCaption } : {}),
      ...maskFields(o, objectsById),
      ...(o.isGroup && o.bone ? { bone: true as const } : {}),
      ...(o.skin ? { skin: true as const } : {}),
    });
    if (o.isGroup) {
      // Under a frame layer, a child filed under another key is skipped; an untagged or
      // dangling-tagged child is always shown (it always renders — graceful degradation).
      const keyIds = o.frames ? new Set(o.frames.keys.map((k) => k.id)) : null;
      const shown = (c: SceneObject) => !keyIds || !c.frameKeyId || !keyIds.has(c.frameKeyId) || c.frameKeyId === exposedKey;
      for (const c of objects.filter((x) => x.parentId === o.id && shown(x)).sort(byZ)) pushSubtree(c, depth + 1);
    }
  };
  for (const o of objects.filter((x) => !x.parentId).sort(byZ)) pushSubtree(o, 0);

  return { rows };
}

function maskFields(o: SceneObject, byId: Map<string, SceneObject>): Pick<LayersPanelRowVM, 'maskRole' | 'maskName'> {
  if (o.isMask) return { maskRole: 'mask' };
  const m = o.maskedBy ? byId.get(o.maskedBy) : undefined;
  return m?.isMask ? { maskRole: 'masked', maskName: m.name } : {};
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
