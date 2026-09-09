// M9 interactivity/scripting: behaviors (on an object OR project-level as a global handler) +
// declared variables + the transient preview-mode toggle. Mirrors audioSlice.ts's structure:
// every mutating action reads the whole state via `get()` and commits a full next Project via
// `get().commit(...)` (undoable); conditional-spread keeps an absent field absent (parity for
// projects with zero interactivity — `interactions` itself, and its `variables`/`handlers`
// sub-fields, are omitted rather than present-as-empty-array).
//
// Behaviors on an OBJECT are located via `findObjectAnywhere`/`updateObjectAnywhere`
// (store-internals) — root `project.objects` or any `scenes[i].objects` — NOT the currently
// active scene/symbol (`selectActiveObjects`). The caller always names an explicit `objectId`
// (never "the selection"), so the object may live on a scene other than the one being edited.
import { newId } from '@savig/engine';
import type { Behavior, InteractionModel, Project } from '@savig/engine';
import type { SliceCreator } from '../store-internals';
import { findObjectAnywhere, updateObjectAnywhere, NO_KEYFRAME_SELECTION } from '../store-internals';

// Parameter-position destructuring (not a local variable) so the dropped key's eslint
// no-unused-vars is covered by the shared `argsIgnorePattern: '^_'` rule — mirrors
// store-internals.ts's `dropTrimAndDash` / audioSlice.ts's `omitAudioTracks`.
function omitInteractions({ interactions: _dropped, ...rest }: Project): Omit<Project, 'interactions'> {
  return rest;
}
function omitObjectBehaviors<T extends { behaviors?: Behavior[] }>({ behaviors: _dropped, ...rest }: T): T {
  return rest as T;
}

// The InteractionModel to write back after a variables/handlers edit: absent fields stay
// absent (an empty array collapses to "field not present"), and the model itself collapses to
// `undefined` once BOTH are gone — the caller then routes through `omitInteractions` instead.
function normalizeInteractions(model: InteractionModel): InteractionModel | undefined {
  const variables = model.variables && model.variables.length > 0 ? model.variables : undefined;
  const handlers = model.handlers && model.handlers.length > 0 ? model.handlers : undefined;
  if (!variables && !handlers) return undefined;
  return { ...(variables ? { variables } : {}), ...(handlers ? { handlers } : {}) };
}

// Commit `nextModel` (or drop `interactions` entirely when it normalizes away) onto `project`.
function commitInteractions(project: Project, nextModel: InteractionModel): Project {
  const normalized = normalizeInteractions(nextModel);
  return normalized ? { ...project, interactions: normalized } : omitInteractions(project);
}

type InteractionsKeys =
  | 'addBehavior' | 'updateBehavior' | 'removeBehavior'
  | 'addVariable' | 'updateVariable' | 'removeVariable'
  | 'enterPreview' | 'exitPreview';

export const createInteractionsSlice: SliceCreator<InteractionsKeys> = (set, get) => ({
  addBehavior(objectId, behavior) {
    const project = get().history.present;
    const next: Behavior = { ...behavior, id: newId() };
    if (objectId === null) {
      const model = project.interactions ?? {};
      get().commit(commitInteractions(project, { ...model, handlers: [...(model.handlers ?? []), next] }));
      return;
    }
    const updated = updateObjectAnywhere(project, objectId, (o) => ({ ...o, behaviors: [...(o.behaviors ?? []), next] }));
    if (updated === project) return; // objectId resolves nowhere -> silent no-op
    get().commit(updated);
  },

  updateBehavior(objectId, behaviorId, patch) {
    const project = get().history.present;
    if (objectId === null) {
      const model = project.interactions;
      if (!model?.handlers?.some((b) => b.id === behaviorId)) return;
      const handlers = model.handlers.map((b) => (b.id === behaviorId ? { ...b, ...patch } : b));
      get().commit(commitInteractions(project, { ...model, handlers }));
      return;
    }
    const obj = findObjectAnywhere(project, objectId);
    if (!obj?.behaviors?.some((b) => b.id === behaviorId)) return;
    const behaviors = obj.behaviors;
    const updated = updateObjectAnywhere(project, objectId, (o) => ({
      ...o,
      behaviors: behaviors.map((b) => (b.id === behaviorId ? { ...b, ...patch } : b)),
    }));
    get().commit(updated);
  },

  removeBehavior(objectId, behaviorId) {
    const project = get().history.present;
    if (objectId === null) {
      const model = project.interactions;
      if (!model?.handlers?.some((b) => b.id === behaviorId)) return;
      const handlers = model.handlers.filter((b) => b.id !== behaviorId);
      get().commit(commitInteractions(project, { ...model, handlers }));
      return;
    }
    const obj = findObjectAnywhere(project, objectId);
    if (!obj?.behaviors?.some((b) => b.id === behaviorId)) return;
    const behaviors = obj.behaviors.filter((b) => b.id !== behaviorId);
    const updated = updateObjectAnywhere(project, objectId, (o) =>
      behaviors.length > 0 ? { ...o, behaviors } : omitObjectBehaviors(o),
    );
    get().commit(updated);
  },

  addVariable(name, initial) {
    const project = get().history.present;
    const model = project.interactions ?? {};
    const existing = model.variables ?? [];
    const idx = existing.findIndex((v) => v.name === name);
    // A duplicate name REPLACES in place (documented upsert) — preserves its row position
    // rather than bumping it to the end, matching updateVariable's in-place behavior.
    const variables = idx >= 0
      ? existing.map((v, i) => (i === idx ? { name, initial } : v))
      : [...existing, { name, initial }];
    get().commit(commitInteractions(project, { ...model, variables }));
  },

  updateVariable(name, initial) {
    const project = get().history.present;
    const model = project.interactions;
    if (!model?.variables?.some((v) => v.name === name)) return;
    const variables = model.variables.map((v) => (v.name === name ? { ...v, initial } : v));
    get().commit(commitInteractions(project, { ...model, variables }));
  },

  removeVariable(name) {
    const project = get().history.present;
    const model = project.interactions;
    if (!model?.variables?.some((v) => v.name === name)) return;
    const variables = model.variables.filter((v) => v.name !== name);
    get().commit(commitInteractions(project, { ...model, variables }));
  },

  enterPreview() {
    set({ ...NO_KEYFRAME_SELECTION, selectedObjectId: null, selectedObjectIds: [], previewMode: true });
  },
  exitPreview() {
    set({ previewMode: false });
  },
});
