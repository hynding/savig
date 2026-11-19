/** Headless button-symbol builders (spec 2026-11-19-button-symbols, slice 3) — the agent path to
 *  Flash-style buttons. Same contract as build.ts: pure, id-addressed, root-scene only (MCP wraps
 *  them in `withScene`), fail loud on bad references. */
import { BUTTON_STATES, DEFAULT_BUTTON_STATES, createSceneObject, createSymbolAsset, isButtonState, newId, operandWorldRings, pathBounds } from '@savig/engine';
import type { ButtonState, Project, SceneObject, SymbolAsset } from '@savig/engine';

function requireButton(project: Project, symbolId: string): SymbolAsset {
  const a = project.assets.find((x) => x.id === symbolId);
  if (!a || a.kind !== 'symbol') throw new Error(`savig/core: no symbol with id "${symbolId}"`);
  return a;
}

/** Canonical order, no duplicates; `undefined` for the default set (Up, Over, Down). Throws on an
 *  unknown state name. */
function normalized(states: readonly string[]): ButtonState[] | undefined {
  for (const s of states) {
    if (!isButtonState(s)) throw new Error(`savig/core: unknown button state "${s}" (use up, over, down, hit)`);
  }
  const picked = BUTTON_STATES.filter((st) => states.includes(st));
  const isDefault = picked.length === DEFAULT_BUTTON_STATES.length && DEFAULT_BUTTON_STATES.every((st) => picked.includes(st));
  return isDefault ? undefined : picked;
}

export interface CreateButtonOpts {
  /** Id for the new button symbol asset (default: generated). */
  symbolId?: string;
  /** Id for the instance placed on the stage (default: generated). */
  instanceId?: string;
  name?: string;
  /** States per member object id (the rest show in Up, Over and Down). */
  states?: Record<string, string[]>;
}

/** Move the top-level objects `objectIds` (with their group subtrees) into a new BUTTON symbol and
 *  put one instance of it where they were. The result draws exactly as before in the Up state.
 *  Members listed in `opts.states` show only in those states. */
export function createButton(project: Project, objectIds: string[], opts: CreateButtonOpts = {}): Project {
  if (objectIds.length === 0) throw new Error('savig/core: createButton needs at least one object');
  const byId = new Map(project.objects.map((o) => [o.id, o] as const));
  for (const id of objectIds) {
    const o = byId.get(id);
    if (!o) throw new Error(`savig/core: no object with id "${id}"`);
    if (o.parentId) throw new Error(`savig/core: "${id}" is inside a group; button members must be top-level`);
  }
  const members = new Set(objectIds);
  let grew = true;
  while (grew) {
    grew = false;
    for (const o of project.objects) {
      if (o.parentId && members.has(o.parentId) && !members.has(o.id)) {
        members.add(o.id);
        grew = true;
      }
    }
  }
  for (const id of Object.keys(opts.states ?? {})) {
    if (!members.has(id)) throw new Error(`savig/core: states given for "${id}", which is not a button member`);
  }
  // Bounds of the members' drawn area at t=0 (the instance pivots about its centre).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of objectIds) {
    for (const ring of operandWorldRings(project, byId.get(id)!, 0)) {
      const b = pathBounds(ring);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    }
  }
  const hasBox = minX <= maxX;
  const symbolId = opts.symbolId ?? newId();
  const instanceId = opts.instanceId ?? newId();
  if (project.assets.some((a) => a.id === symbolId)) throw new Error(`savig/core: asset id "${symbolId}" is taken`);
  if (byId.has(instanceId)) throw new Error(`savig/core: object id "${instanceId}" is taken`);
  const name = opts.name ?? 'Button';
  const inside: SceneObject[] = project.objects
    .filter((o) => members.has(o.id))
    .map((o) => {
      const st = opts.states?.[o.id];
      const n = st ? normalized(st) : undefined;
      return n ? { ...o, buttonStates: n } : o;
    });
  const symbol: SymbolAsset = {
    ...createSymbolAsset({
      id: symbolId,
      name,
      objects: inside,
      width: hasBox ? maxX - minX : 0,
      height: hasBox ? maxY - minY : 0,
    }),
    button: true,
  };
  const top = project.objects.filter((o) => objectIds.includes(o.id));
  const instance = createSceneObject(symbolId, {
    id: instanceId,
    name,
    zOrder: Math.max(...top.map((o) => o.zOrder)) + 1,
    anchorX: hasBox ? (minX + maxX) / 2 : 0,
    anchorY: hasBox ? (minY + maxY) / 2 : 0,
  });
  return {
    ...project,
    assets: [...project.assets, symbol],
    objects: [...project.objects.filter((o) => !members.has(o.id)), instance],
  };
}

/** Make symbol `symbolId` a button (instances react to hover and press) or an ordinary symbol. */
export function setSymbolButton(project: Project, symbolId: string, button: boolean): Project {
  const sym = requireButton(project, symbolId);
  const next = { ...sym };
  if (button) next.button = true;
  else delete next.button;
  return { ...project, assets: project.assets.map((a) => (a.id === symbolId ? next : a)) };
}

/** Set which states object `objectId` inside symbol `symbolId` shows in ('up', 'over', 'down',
 *  'hit'). Up+Over+Down is the default and clears the field. Hit content is never drawn; it widens
 *  the clickable area. */
export function setButtonStates(project: Project, symbolId: string, objectId: string, states: string[]): Project {
  const sym = requireButton(project, symbolId);
  if (!sym.objects.some((o) => o.id === objectId)) {
    throw new Error(`savig/core: symbol "${symbolId}" has no object "${objectId}"`);
  }
  const n = normalized(states);
  const objects = sym.objects.map((o) => {
    if (o.id !== objectId) return o;
    const copy = { ...o };
    if (n) copy.buttonStates = n;
    else delete copy.buttonStates;
    return copy;
  });
  return { ...project, assets: project.assets.map((a) => (a.id === symbolId ? { ...sym, objects } : a)) };
}
