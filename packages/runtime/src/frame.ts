import {
  buildTransform,
  computeCameraTransform,
  computeSceneCameraTransform,
  flattenInstances,
  fmt,
  geometryToSvgAttrs,
  gradientAttrs,
  gradientStopAttrs,
  pathBounds,
  pathToD,
  pathToDRings,
  resolveAnchor,
  resolveBooleanRings,
  sampleObject,
  sceneAtTime,
} from '@savig/engine';
import type { Camera, Gradient, Project } from '@savig/engine';

export interface FrameItem {
  objectId: string;
  transform: string;
  opacity: string;
  /** Present only for vector objects: SVG attribute name -> value for the inner shape. */
  geometry?: Record<string, string>;
  /** Present only for MORPHED path objects: the inner <path>'s `d` for this frame. */
  pathD?: string;
  /** Present only for vector objects with an animated fill/stroke color track. */
  fill?: string;
  stroke?: string;
  /** Present only for vector objects with an animated fill/stroke gradient track. */
  fillGradient?: Gradient;
  strokeGradient?: Gradient;
  /** Present only for vector objects with an animated stroke-dashoffset track. */
  strokeDashoffset?: string;
}

// Single definition of "sampled state -> SVG attributes", shared by the editor Stage and the export
// runtime (the parity test locks them to identical output). Multi-scene (8b): render the ACTIVE
// scene at master time `time` via a scene-scoped Project view, with scene-namespaced object ids.
// Single-scene (`scenes` absent): byte-identical to before — no view, no prefix.
export function computeFrame(project: Project, time: number): FrameItem[] {
  if (!project.scenes) return computeFrameForScene(project, time, null);
  const { primary, outgoing } = sceneAtTime(project, time);
  const view = (scene: { objects: Project['objects'] }): Project => ({ ...project, objects: scene.objects, scenes: undefined });
  const items = computeFrameForScene(view(primary.scene), primary.localTime, primary.scene.id);
  if (outgoing) items.push(...computeFrameForScene(view(outgoing.scene), outgoing.localTime, outgoing.scene.id));
  return items;
}

// Compute the frame for ONE scene's object list at `localTime`. `sceneProject` is a Project whose
// `.objects` is the scene's scene-graph (for single-scene this is the project itself). When `sceneId`
// is non-null (multi-scene), every objectId is namespaced `"<sceneId>:<renderId>"` so the runtime
// node-map keys never collide across scenes; null ⇒ no prefix ⇒ byte-identical single-scene output.
export function computeFrameForScene(sceneProject: Project, localTime: number, sceneId: string | null): FrameItem[] {
  const assetsById = new Map(sceneProject.assets.map((a) => [a.id, a] as const));
  // flattenInstances is the single scene-walker: it skips group containers (folding their
  // transform into `leaf.transformPrefix`), expands symbol instances (composing transform +
  // opacity, namespacing the id), and emits drawable leaves in draw order — keyed by renderId
  // (== object id for a non-instanced object, so a symbol-free project is byte-identical).
  return flattenInstances(sceneProject, localTime)
    .map((leaf): FrameItem | null => {
      const obj = leaf.object;
      const state = sampleObject(obj, leaf.localTime);
      const asset = assetsById.get(obj.assetId);
      const shapeType = asset && asset.kind === 'vector' ? asset.shapeType : undefined;
      const pathBox =
        asset && asset.kind === 'vector' && asset.shapeType === 'path'
          ? pathBounds(state.path ?? asset.path ?? { nodes: [], closed: false })
          : undefined;
      const { anchorX, anchorY } = resolveAnchor(obj, state, shapeType, pathBox);
      const item: FrameItem = {
        objectId: sceneId ? `${sceneId}:${leaf.renderId}` : leaf.renderId,
        transform:
          (leaf.transformPrefix ? leaf.transformPrefix + ' ' : '') + buildTransform(state, anchorX, anchorY),
        opacity: fmt(state.opacity * leaf.opacityFactor),
      };
      if (shapeType && shapeType !== 'path' && state.geometry) {
        item.geometry = geometryToSvgAttrs(shapeType, state.geometry);
      }
      if (obj.boolean) {
        // Live boolean: recompute the clipped result at this frame's time (animates with
        // the operands). World-space rings rendered as a compound evenodd `d`.
        const rings = resolveBooleanRings(sceneProject, obj, leaf.localTime);
        item.pathD = rings.length > 0 ? pathToDRings(rings[0], rings.slice(1)) : '';
      } else if (state.path) {
        item.pathD = pathToD(state.path);
      }
      // A gradient paint (baked into the initial markup as url(#…)) wins over a
      // color track: emitting a per-frame hex here would clobber the gradient ref
      // via applyFrameToNodes.
      const hasFillGradient =
        (asset?.kind === 'vector' && !!asset.style.fillGradient) || state.fillGradient !== undefined;
      const hasStrokeGradient =
        (asset?.kind === 'vector' && !!asset.style.strokeGradient) || state.strokeGradient !== undefined;
      if (state.fill !== undefined && !hasFillGradient) item.fill = state.fill;
      if (state.stroke !== undefined && !hasStrokeGradient) item.stroke = state.stroke;
      if (state.fillGradient !== undefined) item.fillGradient = state.fillGradient;
      if (state.strokeGradient !== undefined) item.strokeGradient = state.strokeGradient;
      if (state.strokeDashoffset !== undefined) item.strokeDashoffset = fmt(state.strokeDashoffset);
      return item;
    })
    .filter((it): it is FrameItem => it !== null);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// Mutate a gradient <defs> element in place: imperative coordinate attrs + fully
// rebuilt <stop> children (robust to stop-count changes across keyframes). Stops
// are built via createElementNS (NOT innerHTML — SVG-namespaced innerHTML is
// unreliable in jsdom) and share gradientStopAttrs with the string emitter, so
// runtime == export == Stage by construction.
function applyGradientToElement(node: Element, id: string, g: Gradient): void {
  const owner = (node as SVGElement).ownerSVGElement;
  const root = owner ?? (node.getRootNode() as Document | null);
  const def = root && 'querySelector' in root ? root.querySelector(`#${CSS.escape(id)}`) : null;
  if (!def) return; // defensive: never throw mid-frame if the def is missing
  for (const [attr, value] of Object.entries(gradientAttrs(g))) {
    def.setAttribute(attr, value);
  }
  while (def.firstChild) def.removeChild(def.firstChild);
  const doc = def.ownerDocument;
  for (const s of g.stops) {
    const stop = doc.createElementNS(SVG_NS, 'stop');
    for (const [attr, value] of Object.entries(gradientStopAttrs(s))) {
      stop.setAttribute(attr, value);
    }
    def.appendChild(stop);
  }
}

// Applies a computed frame to live SVG nodes. Wrapper nodes
// (`[data-savig-object]`) take transform/opacity; vector objects also update the
// inner shape element (the wrapper's only child) with the geometry attributes.
// Shared by the standalone runtime player AND the editor's imperative painter.
export function applyFrameToNodes(nodes: Map<string, Element>, items: FrameItem[]): void {
  for (const item of items) {
    const node = nodes.get(item.objectId);
    if (!node) continue;
    node.setAttribute('transform', item.transform);
    node.setAttribute('opacity', item.opacity);
    if (item.geometry) {
      const shape = node.firstElementChild;
      if (shape) {
        for (const [attr, value] of Object.entries(item.geometry)) {
          shape.setAttribute(attr, value);
        }
      }
    }
    if (item.pathD !== undefined) {
      const shape = node.firstElementChild;
      if (shape) shape.setAttribute('d', item.pathD);
    }
    if (item.fill !== undefined || item.stroke !== undefined) {
      const shape = node.firstElementChild;
      if (shape) {
        if (item.fill !== undefined) shape.setAttribute('fill', item.fill);
        if (item.stroke !== undefined) shape.setAttribute('stroke', item.stroke);
      }
    }
    if (item.fillGradient) applyGradientToElement(node, `savig-grad-${item.objectId}-fill`, item.fillGradient);
    if (item.strokeGradient) applyGradientToElement(node, `savig-grad-${item.objectId}-stroke`, item.strokeGradient);
    if (item.strokeDashoffset !== undefined) {
      const shape = node.firstElementChild;
      if (shape) shape.setAttribute('stroke-dashoffset', item.strokeDashoffset);
    }
  }
}

/** Update the camera view-transform group (slice 8a) under `root` for `time`. No-op when the
 *  project has no camera (no `[data-savig-camera]` group is emitted). Shared by the runtime, the
 *  headless frame renderer, and (future) the editor so all paths animate the camera identically. */
export function applyCamera(root: ParentNode, project: Project, time: number): void {
  const el = root.querySelector('[data-savig-camera]');
  if (!el) return;
  const transform = computeCameraTransform(project, time);
  if (transform !== null) el.setAttribute('transform', transform);
}

// Set a scene group's display + opacity in one call. `opacity=null` clears any previously set ramp.
function setGroupState(g: Element, display: boolean, opacity: number | null): void {
  const style = (g as unknown as { style: CSSStyleDeclaration }).style;
  style.display = display ? '' : 'none';
  style.opacity = opacity === null ? '' : String(opacity);
}

// Apply scene `sceneId`'s camera at `localTime` to the [data-savig-camera] group inside its scene group.
function applySceneGroupCamera(root: ParentNode, project: Project, sceneId: string, camera: Camera | undefined, localTime: number): void {
  const group = root.querySelector(`[data-savig-scene="${CSS.escape(sceneId)}"]`);
  const camEl = group ? group.querySelector('[data-savig-camera]') : null;
  if (!camEl) return;
  const t = computeSceneCameraTransform(camera, project.meta.width, project.meta.height, localTime);
  if (t !== null) camEl.setAttribute('transform', t);
}

// Lazily create the full-frame dip overlay rect (top z, appended to the SVG root). Idempotent.
function ensureDipOverlay(root: ParentNode, project: Project): Element | null {
  const existing = root.querySelector('[data-savig-dip]');
  if (existing) return existing;
  const doc = (root as Element).ownerDocument ?? null;
  if (!doc) return null;
  const rect = doc.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('data-savig-dip', '');
  rect.setAttribute('x', '0');
  rect.setAttribute('y', '0');
  rect.setAttribute('width', fmt(project.meta.width));
  rect.setAttribute('height', fmt(project.meta.height));
  rect.setAttribute('opacity', '0');
  (rect as unknown as { style: CSSStyleDeclaration }).style.display = 'none';
  (root as Element).appendChild(rect); // last child ⇒ top z
  return rect;
}

/** Apply a master-time frame to a (possibly multi-scene) live SVG. Single-scene (no project.scenes):
 *  identical to before (applyFrameToNodes + applyCamera). Multi-scene: show/hide scene groups per
 *  the current transition (crossfade opacity ramp, dip overlay, or cut), apply each visible scene's
 *  own camera. Shared by the runtime player and the headless raster. */
export function applyProjectFrame(root: ParentNode, nodes: Map<string, Element>, project: Project, time: number): void {
  applyFrameToNodes(nodes, computeFrame(project, time));
  if (!project.scenes) {
    applyCamera(root, project, time);
    return;
  }
  const { primary, outgoing } = sceneAtTime(project, time);
  const existingOverlay = root.querySelector('[data-savig-dip]');
  const transition = outgoing ? primary.scene.transitionIn : undefined;
  const dip = transition && transition.kind === 'dip' ? transition : null;
  const crossfade = !!(transition && transition.kind === 'crossfade');

  // Decide per-group visibility + opacity for this frame.
  const outgoingId = outgoing ? outgoing.scene.id : null;
  let primaryVisible = true;
  let primaryOpacity: number | null = null; // null = clear (full opacity)
  let outgoingVisible = !!outgoing;
  const outgoingOpacity: number | null = null;

  if (outgoing && crossfade) {
    primaryOpacity = outgoing.progress; // incoming fades in 0→1
    // outgoing stays full (outgoingOpacity stays null)
  } else if (outgoing && dip) {
    // Dip: show outgoing during first half / incoming during second half; overlay covers the cut.
    const second = outgoing.progress >= 0.5;
    primaryVisible = second;
    outgoingVisible = !second;
  }

  root.querySelectorAll('[data-savig-scene]').forEach((g) => {
    const id = g.getAttribute('data-savig-scene');
    if (id === primary.scene.id) setGroupState(g, primaryVisible, primaryOpacity);
    else if (id === outgoingId) setGroupState(g, outgoingVisible, outgoingOpacity);
    else setGroupState(g, false, null);
  });

  // Apply each visible scene's own camera at its local time.
  applySceneGroupCamera(root, project, primary.scene.id, primary.scene.camera, primary.localTime);
  if (outgoing) applySceneGroupCamera(root, project, outgoing.scene.id, outgoing.scene.camera, outgoing.localTime);

  // Dip overlay: triangle ramp 0→1→0 over the overlap in the dip color. Created lazily.
  if (outgoing && dip) {
    const rect = existingOverlay ?? ensureDipOverlay(root, project);
    if (rect) {
      const p = outgoing.progress;
      const cover = p < 0.5 ? p / 0.5 : (1 - p) / 0.5;
      rect.setAttribute('fill', dip.color);
      rect.setAttribute('opacity', fmt(cover));
      (rect as unknown as { style: CSSStyleDeclaration }).style.display = '';
    }
  } else if (existingOverlay) {
    (existingOverlay as unknown as { style: CSSStyleDeclaration }).style.display = 'none';
  }
}
