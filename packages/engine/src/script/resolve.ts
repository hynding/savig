// M9 interactivity: renderId → authored-ancestor-chain resolution + override expansion. Pure
// walks over `projectScenes(project)` object arrays — these run on user gestures (a click, a
// hover-chain diff), not per-frame, so no caching is needed (unlike the script parse cache).

import { projectScenes } from '../scenes';
import type { ObjectOverride, Project, Scene } from '../types';

const REPEATER_SUFFIX = /@\d+$/;

function findContainingScene(project: Project, topLevelId: string): Scene | null {
  for (const scene of projectScenes(project)) {
    if (scene.objects.some((o) => o.id === topLevelId)) return scene;
  }
  return null;
}

/** Multi-scene DOM node ids are namespaced `"<sceneId>:<renderId>"` (runtime `frame.ts`,
 *  `computeFrameForScene`) so the runtime's node map never collides across scenes; single-scene
 *  ids carry no prefix. Strips that prefix ONLY when the text before the first `:` is an actual
 *  scene id of this project — a hostile/incidental `:` in an otherwise-unprefixed id (ids never
 *  legitimately contain `:` themselves) is defensively left alone, and the id is resolved as a
 *  literal, scene-unscoped lookup (falls through to "unknown id" if nothing matches). */
function splitScenePrefix(project: Project, renderId: string): { sceneId: string | null; rest: string } {
  const colon = renderId.indexOf(':');
  if (colon === -1) return { sceneId: null, rest: renderId };
  const candidate = renderId.slice(0, colon);
  const knownSceneIds = projectScenes(project).map((s) => s.id);
  if (!knownSceneIds.includes(candidate)) return { sceneId: null, rest: renderId };
  return { sceneId: candidate, rest: renderId.slice(colon + 1) };
}

/** renderId → authored ancestor ids, leaf-first (per `flattenInstances`' scheme, symbol.ts):
 *  strip a leading `<sceneId>:` multi-scene prefix (see `splitScenePrefix`) and a trailing `@k`
 *  repeater suffix; the FIRST `/`-segment of what remains is the targetable authored object (the
 *  outermost symbol instance for namespaced leaves — symbol internals collapse to the instance —
 *  or the leaf itself for a plain id); the chain is that object followed by its `parentId` walk
 *  within its containing scene (the scene named by the prefix, when present — scoping the walk
 *  correctly rather than relying on id uniqueness across scenes). Unknown id ⇒ `[]`. */
export function resolveAuthoredChain(project: Project, renderId: string): string[] {
  const { sceneId, rest } = splitScenePrefix(project, renderId);
  const stripped = rest.replace(REPEATER_SUFFIX, '');
  const slash = stripped.indexOf('/');
  const topLevelId = slash === -1 ? stripped : stripped.slice(0, slash);

  const scene = sceneId
    ? (projectScenes(project).find((s) => s.id === sceneId) ?? null)
    : findContainingScene(project, topLevelId);
  if (!scene) return [];

  const byId = new Map(scene.objects.map((o) => [o.id, o] as const));
  const chain: string[] = [topLevelId];
  const seen = new Set<string>([topLevelId]);
  let pid = byId.get(topLevelId)?.parentId;
  while (pid && !seen.has(pid)) {
    const parent = byId.get(pid);
    if (!parent?.isGroup) break;
    chain.push(pid);
    seen.add(pid);
    pid = parent.parentId;
  }
  return chain;
}

/** Maps authored-object overrides onto the consumer's actual leaf renderIds (`flattenInstances`
 *  output keys — for a multi-scene consumer these are the runtime's `"<sceneId>:..."`-prefixed
 *  DOM ids; `resolveAuthoredChain` strips that prefix internally). A renderId matches an authored
 *  id when its resolved chain (see `resolveAuthoredChain`) contains that id — i.e. the id IS the
 *  renderId's top-level authored object, or an ancestor group of it. Overrides are always keyed
 *  by the UNPREFIXED authored id (that's the id `resolveAuthoredChain` returns in the chain), but
 *  the returned Map's keys are exactly the caller-supplied `renderIds` — prefix and all — so a
 *  multi-scene consumer can look the result up directly by its own DOM id. When multiple chain
 *  entries carry an override, nearer ancestors win per-field (leaf-first order) so a more
 *  specific override can refine a broader one set on a containing group/instance. renderIds with
 *  no matching override are omitted entirely (left untouched by the caller's apply pass). */
export function expandOverrides(
  project: Project,
  overrides: ReadonlyMap<string, ObjectOverride>,
  renderIds: Iterable<string>,
): Map<string, ObjectOverride> {
  const result = new Map<string, ObjectOverride>();
  for (const renderId of renderIds) {
    const chain = resolveAuthoredChain(project, renderId);
    let merged: ObjectOverride | undefined;
    // Farthest ancestor first, so nearest (chain[0], the renderId's own authored object) is
    // merged LAST and wins field conflicts.
    for (let i = chain.length - 1; i >= 0; i--) {
      const ov = overrides.get(chain[i]);
      if (ov) merged = { ...(merged ?? {}), ...ov };
    }
    if (merged) result.set(renderId, merged);
  }
  return result;
}
