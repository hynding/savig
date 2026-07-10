import {
  buildTransform,
  computeCameraTransform,
  computeSceneCameraTransform,
  escapeAttr,
  flattenInstances,
  fmt,
  gradientToSvg,
  groupTransformPrefix,
  isRenderHidden,
  isStaticInstance,
  isStaticSymbol,
  pathBounds,
  projectScenes,
  renderShapeToSvg,
  resolveAnchor,
  resolveBooleanRings,
  sampleObject,
} from '@savig/engine';
import type { Asset, InstanceLeaf, Project, SceneObject, SvgAsset, SymbolAsset } from '@savig/engine';
import { MissingAssetError } from '../errors';
import { sanitizeSvgElement } from '../import/sanitizeSvg';

// SVG assets are defined once in <defs> and instanced via <use>, so multiple
// instances never duplicate (already-namespaced) internal ids. Vector shapes are
// inlined per object (their geometry animates per-frame, so a static def cannot
// capture them); the runtime updates the inner shape's attributes each frame.

/**
 * Render one scene's body and collect its def pieces, optionally scene-namespacing every
 * per-leaf id so two scenes' generated ids never collide in the shared <defs>.
 *
 * When `sceneId` is non-null, `renderId`, `clipId`, and `tintId` of every leaf are prefixed
 * with `"${sceneId}:"` — matching the runtime's `computeFrame` objectId `"<sceneId>:<renderId>"`.
 * Asset-keyed defs (`savig-asset-*`, `savig-sym-*`) derive from `assetId`, not `renderId`, and
 * stay global (unprefixed). The static-symbol `<use>` optimization is disabled for scenes
 * (full inlining instead) since per-scene namespacing makes `<use>` ids ambiguous.
 *
 * `sceneId === null` (single-scene path) keeps the optimization and produces output
 * byte-identical to the original `renderSvgDocument` body.
 */
export function renderSceneBody(
  project: Project,
  sceneId: string | null,
): { body: string; assetDefs: Map<string, string>; localDefs: string } {
  const assetsById = new Map(project.assets.map((a) => [a.id, a] as const));

  // flattenInstances is the single scene-walker (shared with computeFrame, so export == preview):
  // it already excludes hidden objects + group containers and expands symbol instances into
  // composite-id leaves with their composed transform/opacity. Each leaf becomes one body node.
  const leaves = flattenInstances(project, 0);

  // Scene-namespace every per-leaf id so two scenes' generated ids never collide in the shared
  // <defs>, AND so exported data-savig-object / gradient def ids match the runtime's computeFrame
  // objectId ("<sceneId>:<renderId>"). Asset-keyed defs (savig-asset/savig-sym) derive from assetId,
  // not renderId, so they stay global (unprefixed). sceneId===null (single-scene) => no change.
  const scoped = sceneId === null ? leaves : leaves.map((l) => ({
    ...l,
    renderId: `${sceneId}:${l.renderId}`,
    ...(l.clipId ? { clipId: `${sceneId}:${l.clipId}` } : {}),
    ...(l.tintId ? { tintId: `${sceneId}:${l.tintId}` } : {}),
  }));

  // Only VISIBLE, actually-drawn svg-asset leaves keep their symbol def — a def referenced
  // solely by hidden objects (incl. children of a hidden group, 45c) would be orphaned in
  // <defs>. Instanced svg-asset leaves are deduped by asset id.
  const usedSvgIds = Array.from(
    new Set(scoped.map((l) => l.object.assetId).filter((id) => assetsById.get(id)?.kind === 'svg')),
  ).sort();
  // assetDefs: assetId -> <symbol> def. Built in usedSvgIds (sorted) order so the single-scene
  // join is byte-identical to today's `defs`. The multi-scene caller (8b-2b) dedups across scenes.
  const assetDefs = new Map<string, string>();
  for (const assetId of usedSvgIds) assetDefs.set(assetId, defineSymbol(assetsById.get(assetId) as SvgAsset));

  // Clip-path defs for clipping symbol instances (slice 47e). Collect unique clipIds from
  // leaves; each leaf carries all needed info (clipTransform, clipWidth, clipHeight).
  // Emit one <clipPath> per unique clipId into <defs>.
  const clipPathDefs = buildClipPathDefs(scoped);

  const gradientDefs: string[] = [];
  const tintFilterDefs: string[] = [];

  // Static-symbol <use> optimization (slice 47g):
  // Pre-scan root-level objects to find static-optimizable symbol instances.
  // A root object is optimizable iff:
  //   - it references a symbol asset that is fully static (no keyframe animation anywhere in its subtree)
  //   - the instance itself carries no per-instance overrides (no symbolTime/symbolTimeTrack/tint/freezeFirstFrame)
  //   - the symbol asset has clip=false/absent (v1 deferral: clip+<use> composition deferred)
  //
  // Optimizable instances emit a <use href="#savig-sym-<assetId>"> in the body and a
  // <g id="savig-sym-<assetId>"> def once in <defs>. Their flattenInstances leaves are skipped.
  // Non-optimizable instances (animated, tinted, clipped, timed) fall through to the existing
  // full-inlining path unchanged.
  // DISABLED when sceneId !== null: per-scene namespacing makes <use> ids ambiguous; use full
  // inlining instead. The empty map means staticOptimizable.get() always returns undefined.
  const staticOptimizable = sceneId === null
    ? buildStaticOptimizableMap(project, assetsById)
    : new Map<string, StaticInstanceInfo>();
  // Static symbol defs: keyed by assetId. Populated lazily as instances are encountered.
  const staticSymDefs = new Map<string, string>();
  // Track which static instances have already emitted their <use> (a symbol instance's leaves
  // are contiguous in `leaves`, but the same instance can't appear twice in project.objects).
  const emittedStaticInsts = new Set<string>();

  // Build the body, grouping clipping leaves under their <g clip-path="url(#id)"> wrapper,
  // and tinted leaves under a <g filter="url(#tintId)"> wrapper (slice 47f).
  // flattenInstances emits leaves in zOrder (depth-first per symbol), so leaves belonging
  // to the same instance are contiguous. Collect each run and wrap it.
  // INVARIANT: all leaves of one symbol instance are always contiguous in the output because
  // flattenInstances processes each symbol's subtree depth-first before continuing to the
  // next root object. A future non-depth-first walk would need to re-sort by clipId/tintId first.
  const bodyParts: string[] = [];
  const seenTintIds = new Set<string>();
  let i = 0;
  while (i < scoped.length) {
    const leaf = scoped[i];

    // Static-symbol optimization: detect leaves that belong to a static-optimizable instance.
    // A leaf from root-level instance "instId" has renderId = "instId/<leafId>" (slash-separated).
    // The top-level instance id is the first segment before the first slash.
    const slashIdx = leaf.renderId.indexOf('/');
    const topInstId = slashIdx >= 0 ? leaf.renderId.slice(0, slashIdx) : null;
    const staticInfo = topInstId !== null ? staticOptimizable.get(topInstId) : null;
    if (staticInfo !== undefined && staticInfo !== null) {
      if (!emittedStaticInsts.has(topInstId!)) {
        // First encounter: emit the <use> for this instance, then skip all its leaves.
        emittedStaticInsts.add(topInstId!);
        // Ensure the static symbol def is emitted once.
        if (!staticSymDefs.has(staticInfo.assetId)) {
          const defContent = buildStaticSymbolDef(
            assetsById.get(staticInfo.assetId) as SymbolAsset,
            assetsById,
            project,
            gradientDefs,
          );
          staticSymDefs.set(staticInfo.assetId, defContent);
        }
        bodyParts.push(
          `<use data-savig-object="${topInstId}" href="#savig-sym-${staticInfo.assetId}" ` +
          `transform="${staticInfo.transform}" opacity="${staticInfo.opacity}"/>`,
        );
      }
      // Skip all leaves of this instance (they're represented by the <use>).
      while (i < scoped.length && scoped[i].renderId.startsWith(topInstId! + '/')) i++;
      continue;
    }

    // Existing path: clip/tint run or plain leaf.
    // Determine clip and tint run boundaries. Both identifiers identify the same instance
    // run (they come from the same instance), so the loop collects by the most specific id.
    const runClipId = leaf.clipId;
    const runTintId = leaf.tintId;
    if (runClipId || runTintId) {
      // Collect all consecutive leaves sharing both ids.
      const run: InstanceLeaf[] = [];
      while (
        i < scoped.length &&
        scoped[i].clipId === runClipId &&
        scoped[i].tintId === runTintId
      ) {
        run.push(scoped[i]);
        i++;
      }
      // Build leaf HTML
      const leafHtml = run.map((l) => renderLeaf(l, assetsById, project, gradientDefs)).join('');
      // Wrap in clip if clipping
      let html = leafHtml;
      if (runClipId) {
        html = `<g clip-path="url(#${runClipId})">${html}</g>`;
      }
      // Wrap in tint filter if tinted
      if (runTintId) {
        if (!seenTintIds.has(runTintId)) {
          seenTintIds.add(runTintId);
          // Emit the filter def (feFlood + feComposite alpha-mask + feBlend multiply)
          const color = run[0].tintColor!;
          const amount = run[0].tintAmount!;
          tintFilterDefs.push(
            `<filter id="${runTintId}" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">` +
            `<feFlood flood-color="${color}" flood-opacity="${amount}" result="flood"/>` +
            `<feComposite in="flood" in2="SourceGraphic" operator="in" result="tintLayer"/>` +
            `<feBlend in="SourceGraphic" in2="tintLayer" mode="multiply"/>` +
            `</filter>`,
          );
        }
        html = `<g filter="url(#${runTintId})">${html}</g>`;
      }
      bodyParts.push(html);
    } else {
      bodyParts.push(renderLeaf(leaf, assetsById, project, gradientDefs));
      i++;
    }
  }

  // Merge static sym defs into the overall defs block. Sort by assetId for determinism.
  const staticDefsHtml = Array.from(staticSymDefs.keys())
    .sort()
    .map((id) => staticSymDefs.get(id)!)
    .join('');

  const localDefs = `${staticDefsHtml}${clipPathDefs}${tintFilterDefs.join('')}${gradientDefs.join('')}`;
  return { body: bodyParts.join(''), assetDefs, localDefs };
}

export function renderSvgDocument(project: Project, opts?: { viewBox?: string }): string {
  const { body, assetDefs, localDefs } = renderSceneBody(project, null);
  const defs = Array.from(assetDefs.values()).join('');
  const viewBox = opts?.viewBox ?? `0 0 ${fmt(project.meta.width)} ${fmt(project.meta.height)}`;
  // A camera (slice 8a) wraps the whole scene in one view-transform <g>; the runtime animates it.
  // Absent camera -> no wrapper -> byte-identical to pre-camera exports (parity).
  const cameraTransform = computeCameraTransform(project, 0);
  const wrapped = cameraTransform !== null
    ? `<g data-savig-camera transform="${cameraTransform}">${body}</g>`
    : body;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">` +
    `<defs>${defs}${localDefs}</defs>${wrapped}</svg>`
  );
}

/** Render a (possibly multi-scene) project to one self-contained SVG. Single-scene (no `scenes`)
 *  delegates to renderSvgDocument (byte-identical). Multi-scene: each scene becomes a
 *  <g data-savig-scene> (first visible, rest display:none), with scene-prefixed per-scene defs,
 *  globally-deduped asset defs, and a per-scene camera wrap. */
export function renderProjectDocument(project: Project, opts?: { viewBox?: string }): string {
  if (!project.scenes) return renderSvgDocument(project, opts);

  const assetDefsAll = new Map<string, string>(); // dedup by assetId across all scenes
  const localDefsParts: string[] = [];
  const sceneGroups: string[] = [];

  projectScenes(project).forEach((scene, i) => {
    const sceneView: Project = { ...project, objects: scene.objects, camera: scene.camera, scenes: undefined };
    const { body, assetDefs, localDefs } = renderSceneBody(sceneView, scene.id);
    for (const [id, def] of assetDefs) assetDefsAll.set(id, def);
    localDefsParts.push(localDefs);
    const cam = computeSceneCameraTransform(scene.camera, project.meta.width, project.meta.height, 0);
    const inner = cam !== null ? `<g data-savig-camera transform="${cam}">${body}</g>` : body;
    const hidden = i === 0 ? '' : ' style="display:none"';
    sceneGroups.push(`<g data-savig-scene="${scene.id}"${hidden}>${inner}</g>`);
  });

  const defs = Array.from(assetDefsAll.values()).join('') + localDefsParts.join('');
  const viewBox = opts?.viewBox ?? `0 0 ${fmt(project.meta.width)} ${fmt(project.meta.height)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><defs>${defs}</defs>${sceneGroups.join('')}</svg>`;
}

// ── Static-symbol optimization helpers (slice 47g) ──────────────────────────

/** Info needed to emit a `<use>` element for a static-optimizable instance. */
interface StaticInstanceInfo {
  assetId: string;
  /** The instance's composed world transform string (basePrefix + buildTransform(state)). */
  transform: string;
  /** The instance's effective opacity string. */
  opacity: string;
}

/** Scan root-level project.objects for static-optimizable symbol instances.
 *  Returns a Map<instanceId, StaticInstanceInfo> for every instance that:
 *  - references a SymbolAsset that is content-static (no animation anywhere in its subtree)
 *  - carries no per-instance overrides that would change its rendering (no symbolTime/tint/etc.)
 *  - is NOT clipped (asset.clip falsy) — v1 deferral
 *  Non-optimizable instances are omitted from the map.
 *
 *  NOTE: Only top-level (root-scene) objects are considered. Symbol instances nested inside
 *  another symbol's objects are handled by the outer symbol's def rendering (they get inlined
 *  into the outer def's content at t=0). */
function buildStaticOptimizableMap(
  project: Project,
  assetsById: Map<string, Asset>,
): Map<string, StaticInstanceInfo> {
  const result = new Map<string, StaticInstanceInfo>();
  const objectsById = new Map(project.objects.map((o) => [o.id, o] as const));
  for (const obj of project.objects) {
    if (obj.isGroup || obj.hidden) continue;
    const asset = assetsById.get(obj.assetId);
    if (!asset || asset.kind !== 'symbol') continue;
    // Skip clipped symbols (v1 deferral: clip + <use> composition not yet supported)
    if (asset.clip) continue;
    // Skip if the symbol's content has any animation
    if (!isStaticSymbol(asset, assetsById)) continue;
    // Skip if the instance carries any per-instance overrides
    if (!isStaticInstance(obj)) continue;
    // Skip if the object is hidden via ancestor group cascade
    if (isRenderHidden(obj, objectsById)) continue;
    // Compute the instance's world transform (same as instTransform in flattenInstances)
    const groupPrefix = groupTransformPrefix(project.objects, obj, 0);
    const st = sampleObject(obj, 0);
    const instTransform = [groupPrefix, buildTransform(st, obj.anchorX, obj.anchorY)]
      .filter(Boolean)
      .join(' ');
    const opacity = fmt(st.opacity);
    result.set(obj.id, { assetId: asset.id, transform: instTransform, opacity });
  }
  return result;
}

/** Render the content of a static symbol asset into a `<g id="savig-sym-<assetId>">` def string.
 *  Walks the symbol's own objects at t=0 with no external prefix, collecting gradient defs as
 *  a side effect. Nested symbol instances inside the def are inlined recursively (since the whole
 *  subtree is static, this produces a stable, fully-resolved snapshot).
 *
 *  The coordinate space of the `<g>` is the symbol's local space (origin at symbol's (0,0)).
 *  Each instance's `<use>` element carries the instance world transform, placing this content
 *  correctly in the scene. */
function buildStaticSymbolDef(
  asset: SymbolAsset,
  assetsById: Map<string, Asset>,
  project: Project,
  gradientDefs: string[],
): string {
  const parts: string[] = [];
  // IMPORTANT: Pass a localProject scoped to the symbol's own objects so that
  // resolveBooleanRings (called from renderLeaf for boolean nodes) finds operand ids
  // in the symbol-local scene rather than the root project.objects. Without this,
  // boolean objects inside a static symbol would render as empty paths.
  const localProject: Project = { ...project, objects: asset.objects };
  renderSymbolObjects(asset.objects, assetsById, localProject, gradientDefs, '', '', 1, new Set([asset.id]), parts);
  return `<g id="savig-sym-${asset.id}">${parts.join('')}</g>`;
}

/** Walk a symbol's objects at t=0, rendering each drawable leaf.
 *  Mirrors the core logic of flattenInstances' `walk` closure but:
 *  - Uses object ids directly (no instance-prefix composition — the def's renderId is local)
 *  - Operates at t=0 (static snapshot)
 *  - Recursively inlines nested symbol instances (their content appears in the def)
 *  - Does NOT handle clip/tint (static symbols must not be clipped/tinted to be optimizable)
 *
 *  `basePrefix` is the composed ancestor transform prefix within this def's local space.
 *  `idPrefix` is the composed ancestor id prefix (for the renderId of leaves within the def).
 *  `opacity` is the composed ancestor opacity factor.
 *  `visitedSymbols` is a cycle guard (same semantics as flattenInstances' visited Set).
 *  `localProject` must have `objects` set to the current symbol's own objects[] so that
 *  resolveBooleanRings resolves operand ids correctly within the symbol-local scene. */
function renderSymbolObjects(
  objects: SceneObject[],
  assetsById: Map<string, Asset>,
  localProject: Project,
  gradientDefs: string[],
  basePrefix: string,
  idPrefix: string,
  opacity: number,
  visitedSymbols: Set<string>,
  out: string[],
): void {
  const objectsById = new Map(objects.map((o) => [o.id, o] as const));
  const ordered = objects
    .map((o, idx) => ({ o, idx }))
    .sort((a, b) => a.o.zOrder - b.o.zOrder || a.idx - b.idx);
  for (const { o } of ordered) {
    if (o.isGroup) continue; // group transforms compose via groupTransformPrefix
    if (isRenderHidden(o, objectsById)) continue;
    const gPrefix = groupTransformPrefix(objects, o, 0);
    const fullPrefix = [basePrefix, gPrefix].filter(Boolean).join(' ');
    const renderId = idPrefix ? `${idPrefix}/${o.id}` : o.id;
    const asset = assetsById.get(o.assetId);
    if (asset && asset.kind === 'symbol') {
      // Nested symbol instance inside the def: inline its content (cycle-guarded).
      if (visitedSymbols.has(asset.id)) continue;
      const st = sampleObject(o, 0);
      const instTransform = [fullPrefix, buildTransform(st, o.anchorX, o.anchorY)]
        .filter(Boolean)
        .join(' ');
      const nextVisited = new Set(visitedSymbols);
      nextVisited.add(asset.id);
      // Scope the localProject to the nested symbol's objects so that boolean resolution
      // within the nested symbol's scene finds operands in the correct local list.
      const nestedProject: Project = { ...localProject, objects: asset.objects };
      renderSymbolObjects(
        asset.objects,
        assetsById,
        nestedProject,
        gradientDefs,
        instTransform,
        renderId,
        opacity * st.opacity,
        nextVisited,
        out,
      );
    } else {
      // Drawable leaf: render using the same logic as renderLeaf but with a synthetic leaf.
      // localProject.objects is the current symbol's own objects[], ensuring resolveBooleanRings
      // finds operand ids in the symbol-local scene (not the root scene).
      const syntheticLeaf: InstanceLeaf = {
        renderId,
        object: o,
        transformPrefix: fullPrefix,
        opacityFactor: opacity,
        localTime: 0,
      };
      out.push(renderLeaf(syntheticLeaf, assetsById, localProject, gradientDefs));
    }
  }
}

/** Build <clipPath> def strings for all unique clipIds found in `leaves`.
 *  Each clipPath contains a rect [0,0,W,H] with the instance's world transform,
 *  positioned in the same coordinate space as the symbol's content (userSpaceOnUse). */
function buildClipPathDefs(leaves: InstanceLeaf[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const leaf of leaves) {
    if (leaf.clipId && !seen.has(leaf.clipId)) {
      seen.add(leaf.clipId);
      const transform = leaf.clipTransform ? ` transform="${leaf.clipTransform}"` : '';
      parts.push(
        `<clipPath id="${leaf.clipId}" clipPathUnits="userSpaceOnUse">` +
        `<rect x="0" y="0" width="${fmt(leaf.clipWidth!)}" height="${fmt(leaf.clipHeight!)}"${transform}/>` +
        `</clipPath>`,
      );
    }
  }
  return parts.join('');
}

/** Render one InstanceLeaf to an SVG string, collecting gradient defs as a side effect. */
function renderLeaf(
  leaf: InstanceLeaf,
  assetsById: Map<string, Asset>,
  project: Project,
  gradientDefs: string[],
): string {
  const obj = leaf.object;
  const state = sampleObject(obj, leaf.localTime);
  const groupPrefix = leaf.transformPrefix; // composed: ancestor instances + in-scene groups
  const opacity = fmt(state.opacity * leaf.opacityFactor);
  const asset = assetsById.get(obj.assetId);
  if (!asset) {
    throw new MissingAssetError(`Missing asset "${obj.assetId}" referenced by object "${obj.id}".`);
  }
  if (asset.kind === 'vector') {
    // A gradient paint is a <defs> element referenced via fill/stroke="url(#id)".
    // Emit it into the top-level <defs> (the shape stays the <g>'s only child,
    // so the runtime's firstElementChild lookup is unaffected). An animated
    // gradient track's t=0 sample wins over the static asset gradient (export-at-0,
    // like shapeTrack/colorTracks); the runtime then animates the def. Ids are keyed
    // by renderId so two instances of one symbol never collide.
    const fillGrad = state.fillGradient ?? asset.style.fillGradient;
    const strokeGrad = state.strokeGradient ?? asset.style.strokeGradient;
    if (fillGrad) {
      gradientDefs.push(gradientToSvg(`savig-grad-${leaf.renderId}-fill`, fillGrad));
    }
    if (strokeGrad) {
      gradientDefs.push(gradientToSvg(`savig-grad-${leaf.renderId}-stroke`, strokeGrad));
    }
    // For a morphed path, the initial DOM must be frame 0 of the morph (the runtime then
    // animates `d`); a LIVE boolean is the time-0 clip of its operands; else the static base.
    const boolRings = obj.boolean ? resolveBooleanRings(project, obj, 0) : null;
    // resolveBooleanRings returns rings of >=3 nodes or [] — so boolRings[0] is a valid path
    // or undefined (degenerate); undefined -> renderShapeToSvg returns '' -> empty placeholder below.
    const framePath = obj.boolean
      ? boolRings![0]
      : asset.shapeType === 'path' ? state.path ?? asset.path : undefined;
    const pathBox = framePath ? pathBounds(framePath) : undefined;
    const { anchorX, anchorY } = resolveAnchor(obj, state, asset.shapeType, pathBox);
    const transform = (groupPrefix ? groupPrefix + ' ' : '') + buildTransform(state, anchorX, anchorY);
    let shape = renderShapeToSvg(
      asset.shapeType,
      state.geometry ?? {},
      asset.style,
      framePath,
      leaf.renderId,
      { fill: !!fillGrad, stroke: !!strokeGrad },
      state.strokeDashoffset,
      obj.boolean ? boolRings!.slice(1) : asset.shapeType === 'path' ? asset.compoundRings : undefined,
      !!obj.boolean, // forceEvenOdd: a boolean's path always carries evenodd (holes may appear mid-animation)
      state.trim,
    );
    // A boolean (or morphed) path whose initial shape is empty still needs a <path> child so
    // the runtime can animate `d` once the clip is non-empty (the runtime updates
    // firstElementChild). Static empty paths keep rendering nothing.
    if (!shape && asset.shapeType === 'path' && (obj.boolean || (obj.shapeTrack && obj.shapeTrack.length > 0))) {
      shape = obj.boolean ? '<path fill-rule="evenodd" d=""/>' : '<path d=""/>';
    }
    return `<g data-savig-object="${leaf.renderId}" transform="${transform}" opacity="${opacity}">${shape}</g>`;
  }
  if (asset.kind === 'text') {
    const { anchorX, anchorY } = resolveAnchor(obj, state, undefined);
    const transform = (groupPrefix ? groupPrefix + ' ' : '') + buildTransform(state, anchorX, anchorY);
    const strokeAttr = asset.stroke && asset.stroke !== 'none' ? ` stroke="${escapeAttr(asset.stroke)}" stroke-width="${fmt(asset.strokeWidth ?? 1)}"` : '';
    const fontFamily = asset.fontFamily ? ` font-family="${escapeAttr(asset.fontFamily)}"` : '';
    const anchorAttr = asset.textAnchor ? ` text-anchor="${asset.textAnchor}"` : '';
    // text-before-edge baseline so base.y is the TOP of the text (consistent with the editor).
    const t = `<text x="0" y="0" font-size="${fmt(asset.fontSize)}"${fontFamily} fill="${escapeAttr(asset.fill)}"${strokeAttr}${anchorAttr} dominant-baseline="text-before-edge">${escapeAttr(asset.content)}</text>`;
    return `<g data-savig-object="${leaf.renderId}" transform="${transform}" opacity="${opacity}">${t}</g>`;
  }
  if (asset.kind !== 'svg') {
    throw new MissingAssetError(`Object "${obj.id}" references non-visual asset "${obj.assetId}".`);
  }
  const { anchorX, anchorY } = resolveAnchor(obj, state, undefined);
  const transform = (groupPrefix ? groupPrefix + ' ' : '') + buildTransform(state, anchorX, anchorY);
  return `<use data-savig-object="${leaf.renderId}" href="#savig-asset-${obj.assetId}" transform="${transform}" opacity="${opacity}"/>`;
}

function defineSymbol(asset: SvgAsset): string {
  // Wrap the asset's own root svg in an identified nested <svg> so its
  // intrinsic viewBox is preserved when referenced by <use>.
  const inner = innerMarkup(asset.normalizedContent);
  return (
    `<svg id="savig-asset-${asset.id}" viewBox="${asset.viewBox}" width="${fmt(asset.width)}" height="${fmt(asset.height)}" overflow="visible">` +
    `${inner}</svg>`
  );
}

function innerMarkup(svgMarkup: string): string {
  const doc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
  // Defense-in-depth: a .savig loaded from disk could carry unsanitized
  // normalizedContent, so re-sanitize before inlining into exported HTML.
  sanitizeSvgElement(doc.documentElement);
  return Array.from(doc.documentElement.childNodes)
    .map((node) => new XMLSerializer().serializeToString(node))
    .join('');
}
