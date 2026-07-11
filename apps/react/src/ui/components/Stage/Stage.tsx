import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { buildTransform, flattenInstances, fmt, geometryToSvgAttrs, gradientHandlePositions, groupDescendantIds, identityCorrespondence, isLockedInTree, objectKeyframeTimes, onionSkinTimes, operandWorldRings, paintRef, pathBounds, pathToD, pathToDRings, resolveAnchor, resolveBooleanRings, sampleObject, shapeLocalBBox, trimToDashAttrs } from '@savig/engine';
import type { Gradient, GradientHandleId, LocalRect, PathData, Project, SceneObject, Transform2D } from '@savig/engine';
import { groupBBox, groupAABB, instanceAABB, entityAABB, isSymbolInstance, multiSelectionAABB, objectAABB, resolveObjectAnchor, nodeSnapVertices, type AABB } from '@savig/interaction';
import { rotateHandleLocal } from '@savig/interaction';
import { setStageCursor } from '@savig/interaction';
import { makeStageCoordinates } from '@savig/interaction';
import { usePanZoom } from './usePanZoom';
import { useMarqueeSelect } from './useMarqueeSelect';
import { useDrawTool } from './useDrawTool';
import { useBrushTool } from './useBrushTool';
import { useGradientDrag } from './useGradientDrag';
import { useRotateDrag } from './useRotateDrag';
import { useScaleDrag } from './useScaleDrag';
import { useObjectDrag } from './useObjectDrag';
import { useNodeDrag } from './useNodeDrag';
import { type SpacingGuide } from '@savig/interaction';
import { useEditor } from '../../store/store';
import { selectEditablePath, selectEditableRings, selectEditedShapeKeyframe, selectActiveObjects, selectEditProject, selectActiveAssetId, selectActiveSceneCamera } from '../../store/selectors';
import { isOrderPreserving, unreferencedTargets, linkSegments } from '@savig/interaction';
import { applyFrame } from '../../playback/applyFrame';
import { computeFrame, applyFrameToNodes } from '@savig/runtime/frame';
import { buildDefs } from './buildDefs';
import { handleLocalPositions, HANDLE_IDS, type HandleId } from '@savig/interaction';
import {
  scaleHandleLocalPositions,
  oppositeHandle,
  SCALE_HANDLE_IDS,
  type ScaleHandleId,
} from '@savig/interaction';
import { usePathTools } from './usePathTools';
import { nearFirstAnchor, hitTestSegment } from '@savig/interaction';
import styles from './Stage.module.css';

const HANDLE_SIZE = 8;
const ROTATE_STALK = 24;
const ONION_COUNT = 2;
const ONION_OPACITY = [0.55, 0.3];

// Renders a gradient paint definition. Placed AS A SIBLING AFTER the shape inside
// an object <g> (never before — the shape must stay the group's firstElementChild
// so applyFrameToNodes keeps finding it). objectBoundingBox is the SVG default, so
// no gradientUnits attribute is emitted (matches the export's gradientToSvg).
function GradientEl({ id, g }: { id: string; g: Gradient }) {
  const stops = g.stops.map((s, i) => (
    <stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity ?? 1} />
  ));
  return g.type === 'linear' ? (
    <linearGradient id={id} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}>
      {stops}
    </linearGradient>
  ) : (
    <radialGradient id={id} cx={g.cx} cy={g.cy} r={g.r} fx={g.fx} fy={g.fy}>
      {stops}
    </radialGradient>
  );
}

// Screen-space pick radius (px) for closing the pen and grabbing nodes/handles;
// divided by zoom at the call site to keep a constant on-screen tolerance.
const CLOSE_TOL = 8;
const CORR_KF_EPS = 1e-6;

export function Stage({ nodes }: { nodes: Map<string, SVGGraphicsElement> }) {
  // In symbol edit mode the Stage renders the ACTIVE scene (the symbol's objects); at root it's
  // the real project. selectActiveObjects returns a stable ref, so this memo is stable (47 edit-mode).
  const present = useEditor((s) => s.history.present);
  const activeObjects = useEditor((s) => selectActiveObjects(s));
  const sceneCamera = useEditor((s) => selectActiveSceneCamera(s));
  const project = useMemo(
    () => (activeObjects === present.objects ? present : { ...present, objects: activeObjects, camera: sceneCamera, scenes: undefined }),
    [present, activeObjects, sceneCamera],
  );
  const time = useEditor((s) => s.time);
  const selectedId = useEditor((s) => s.selectedObjectId);
  const selectedIds = useEditor((s) => s.selectedObjectIds);
  const zoom = useEditor((s) => s.zoom);
  const onionSkin = useEditor((s) => s.onionSkin);
  const gridEnabled = useEditor((s) => s.gridEnabled);
  const gridSize = useEditor((s) => s.gridSize);
  const frameEnabled = useEditor((s) => s.frameEnabled);
  const pan = useEditor((s) => s.pan);
  const activeTool = useEditor((s) => s.activeTool);
  const selectedNodeIndex = useEditor((s) => s.selectedNodeIndex);
  const selectedNodeRing = useEditor((s) => s.selectedNodeRing);
  const correspondenceEditing = useEditor((s) => s.correspondenceEditing);
  const selectedShapeKeyframe = useEditor((s) => s.selectedShapeKeyframe);
  const activeAssetId = useEditor(selectActiveAssetId);

  // Live-boolean operand ghosts (slice 3c): when a live boolean — or one of its operands — is
  // selected at the root scene, surface each operand's world outline on canvas so it can be seen and
  // clicked (operands are otherwise render-hidden via flattenInstances `consumed`). Re-derives per
  // frame so ghosts track animated operands.
  const operandGhosts = useMemo(() => {
    if (activeAssetId !== null || !selectedId) return [];
    const byId = new Map(project.objects.map((o) => [o.id, o] as const));
    const sel = byId.get(selectedId);
    if (!sel) return [];
    const activeBool = sel.boolean
      ? sel
      : project.objects.find((o) => o.boolean?.operandIds.includes(selectedId));
    if (!activeBool?.boolean) return [];
    return activeBool.boolean.operandIds.flatMap((id) => {
      const op = byId.get(id);
      if (!op) return [];
      const rings = operandWorldRings(project, op, time);
      if (rings.length === 0) return [];
      return [{ id, boolId: activeBool.id, d: pathToDRings(rings[0], rings.slice(1)) }];
    });
  }, [project, time, selectedId, activeAssetId]);

  const pathTools = usePathTools();
  const pathToolsRef = useRef(pathTools);
  pathToolsRef.current = pathTools;

  const usedIds = useMemo(
    () => Array.from(new Set(project.objects.map((o) => o.assetId))).sort(),
    [project.objects],
  );
  const defs = useMemo(() => buildDefs(project.assets, usedIds), [project.assets, usedIds]);
  const assetsById = useMemo(
    () => new Map(project.assets.map((a) => [a.id, a] as const)),
    [project.assets],
  );
  // Effective-lock topology: an object is inert for editing if it OR an ancestor group is
  // locked (lock cascade). Used by every interaction gate below.
  const lockById = useMemo(
    () => new Map(project.objects.map((o) => [o.id, o] as const)),
    [project.objects],
  );
  // The drawable skeleton: flattenInstances expands symbol instances into composite-id leaves
  // (renderId == object id for a non-instanced object, so non-symbol scenes are unchanged). Each
  // leaf gets a DOM node keyed by renderId so the imperative painter (applyFrame, keyed by the
  // same renderId) finds it. Instances are atomic in 47a — pointer/selection routes to the
  // top-level ancestor (renderId before the first '/'); bbox handles for instances land in 47b.
  const renderLeaves = useMemo(() => flattenInstances(project, time), [project, time]);

  // Clip-path defs for clipping symbol instances (slice 47e). Collect unique clipIds from
  // renderLeaves and emit one <clipPath> string per instance. Concatenated into <defs>.
  const clipPathDefs = useMemo(() => {
    const seen = new Set<string>();
    const parts: string[] = [];
    for (const leaf of renderLeaves) {
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
  }, [renderLeaves]);

  // Tint filter defs for tinted symbol instances (slice 47f). Collect unique tintIds from
  // renderLeaves and emit one <filter> string per instance. Concatenated into <defs>.
  const tintFilterDefs = useMemo(() => {
    const seen = new Set<string>();
    const parts: string[] = [];
    for (const leaf of renderLeaves) {
      if (leaf.tintId && !seen.has(leaf.tintId)) {
        seen.add(leaf.tintId);
        parts.push(
          `<filter id="${leaf.tintId}" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">` +
          `<feFlood flood-color="${leaf.tintColor}" flood-opacity="${leaf.tintAmount}" result="flood"/>` +
          `<feComposite in="flood" in2="SourceGraphic" operator="in" result="tintLayer"/>` +
          `<feBlend in="SourceGraphic" in2="tintLayer" mode="multiply"/>` +
          `</filter>`,
        );
      }
    }
    return parts.join('');
  }, [renderLeaves]);

  // The currently-selected vector object plus its resolved render data, used to
  // draw the resize-handle overlay in the object's local space.
  const selectedVector = useMemo(() => {
    if (!selectedId || selectedIds.length !== 1) return null; // group handles take over for >1
    const obj = project.objects.find((o) => o.id === selectedId);
    const asset = obj ? assetsById.get(obj.assetId) : undefined;
    // Paths are move-only under the select tool: no bbox-resize overlay (their
    // geometry is edited via the node tool). Only rect/ellipse get resize handles.
    if (!obj || obj.hidden || isLockedInTree(obj, lockById) || !asset || asset.kind !== 'vector' || asset.shapeType === 'path') return null;
    const state = sampleObject(obj, time);
    const g = state.geometry ?? {};
    const width = asset.shapeType === 'ellipse' ? 2 * (g.radiusX ?? 0) : g.width ?? 0;
    const height = asset.shapeType === 'ellipse' ? 2 * (g.radiusY ?? 0) : g.height ?? 0;
    const anchor = resolveAnchor(obj, state, asset.shapeType);
    return { obj, shapeType: asset.shapeType, state, width, height, transform: buildTransform(state, anchor.anchorX, anchor.anchorY) };
  }, [selectedId, selectedIds, project.objects, assetsById, lockById, time]);

  // The selected vector object's gradient + the bbox/transform needed to draw the
  // on-canvas handle overlay (select tool only). Edits fill gradient if present,
  // else stroke; reflects the SAMPLED gradient at the playhead.
  const selectedGradient = useMemo(() => {
    if (activeTool !== 'select' || !selectedId || selectedIds.length !== 1) return null;
    const obj = project.objects.find((o) => o.id === selectedId);
    const asset = obj ? assetsById.get(obj.assetId) : undefined;
    if (!obj || obj.hidden || isLockedInTree(obj, lockById) || !asset || asset.kind !== 'vector') return null;
    const state = sampleObject(obj, time, asset.kind === 'vector' ? asset.primitive : undefined);
    const fillG = state.fillGradient ?? asset.style.fillGradient;
    const strokeG = state.strokeGradient ?? asset.style.strokeGradient;
    const property: 'fill' | 'stroke' | null = fillG ? 'fill' : strokeG ? 'stroke' : null;
    if (!property) return null;
    const gradient = (property === 'fill' ? fillG : strokeG)!;
    const sampledPath =
      asset.shapeType === 'path' ? state.path ?? asset.path ?? { nodes: [], closed: false } : undefined;
    const bbox: LocalRect = shapeLocalBBox(asset.shapeType, state.geometry ?? {}, sampledPath);
    const anchor = resolveAnchor(obj, state, asset.shapeType, sampledPath ? pathBounds(sampledPath) : undefined);
    const transform = buildTransform(state, anchor.anchorX, anchor.anchorY);
    return { obj, property, gradient, bbox, transform };
  }, [activeTool, selectedId, selectedIds, project.objects, assetsById, lockById, time]);

  // The selected vector object's bbox + anchor + transform for the rotate-handle
  // overlay (select tool only). Covers rect/ellipse AND path (unlike selectedVector).
  const selectedRotatable = useMemo(() => {
    if (activeTool !== 'select' || !selectedId || selectedIds.length !== 1) return null;
    const obj = project.objects.find((o) => o.id === selectedId);
    const asset = obj ? assetsById.get(obj.assetId) : undefined;
    if (!obj || obj.hidden || isLockedInTree(obj, lockById) || !asset) return null;
    const state = sampleObject(obj, time, asset.kind === 'vector' ? asset.primitive : undefined);
    let bbox: LocalRect;
    let anchorX: number;
    let anchorY: number;
    if (asset.kind === 'vector') {
      const sampledPath =
        asset.shapeType === 'path' ? state.path ?? asset.path ?? { nodes: [], closed: false } : undefined;
      bbox = shapeLocalBBox(asset.shapeType, state.geometry ?? {}, sampledPath);
      const pathBox = sampledPath ? pathBounds(sampledPath) : undefined;
      const anchor = resolveAnchor(obj, state, asset.shapeType, pathBox);
      anchorX = anchor.anchorX;
      anchorY = anchor.anchorY;
    } else if (asset.kind === 'svg') {
      // An imported-SVG object's local box is its intrinsic size; its anchor is absolute
      // (addObject seeds anchorX/Y = width/2,height/2 with no 'fraction' anchorMode), so
      // resolveAnchor returns (obj.anchorX, obj.anchorY) directly — shapeType is irrelevant.
      bbox = { x: 0, y: 0, width: asset.width, height: asset.height };
      const anchor = resolveAnchor(obj, state, undefined);
      anchorX = anchor.anchorX;
      anchorY = anchor.anchorY;
    } else {
      return null; // audio etc. — no rotate handle
    }
    const transform = buildTransform(state, anchorX, anchorY);
    return { obj, state, bbox, anchorX, anchorY, transform };
  }, [activeTool, selectedId, selectedIds, project.objects, assetsById, lockById, time]);

  // Path & imported-SVG objects get on-canvas SCALE handles (Transform2D.scaleX/scaleY).
  // Rect/ellipse use the geometry-resize overlay (selectedVector) instead — mutually exclusive.
  const selectedScalable = useMemo(() => {
    if (activeTool !== 'select' || !selectedId || selectedIds.length !== 1) return null;
    const obj = project.objects.find((o) => o.id === selectedId);
    const asset = obj ? assetsById.get(obj.assetId) : undefined;
    if (!obj || obj.hidden || isLockedInTree(obj, lockById) || !asset) return null;
    const state = sampleObject(obj, time, asset.kind === 'vector' ? asset.primitive : undefined);
    let bbox: LocalRect;
    let anchorX: number;
    let anchorY: number;
    if (asset.kind === 'vector' && asset.shapeType === 'path') {
      const sampledPath = state.path ?? asset.path ?? { nodes: [], closed: false };
      bbox = shapeLocalBBox('path', state.geometry ?? {}, sampledPath);
      const anchor = resolveAnchor(obj, state, 'path', pathBounds(sampledPath));
      anchorX = anchor.anchorX;
      anchorY = anchor.anchorY;
    } else if (asset.kind === 'svg') {
      bbox = { x: 0, y: 0, width: asset.width, height: asset.height };
      const anchor = resolveAnchor(obj, state, undefined);
      anchorX = anchor.anchorX;
      anchorY = anchor.anchorY;
    } else {
      return null; // rect/ellipse (resize) and audio
    }
    const transform = buildTransform(state, anchorX, anchorY);
    return { obj, state, bbox, anchorX, anchorY, transform };
  }, [activeTool, selectedId, selectedIds, project.objects, assetsById, lockById, time]);

  // The group bounding box (union of the selected objects' AABBs) for the multi-select
  // scale handles (slice 40). Only for a >1 selection; single objects use their own handles.
  const groupBounds = useMemo(() => {
    if (activeTool !== 'select') return null;
    // A single selected GROUP container shows the bbox handles too (slice 45b) — its bbox is
    // the children union mapped through the group transform.
    if (selectedIds.length === 1) {
      const only = project.objects.find((o) => o.id === selectedIds[0]);
      if (!only) return null;
      // A single GROUP or a single symbol INSTANCE (both node-less containers) shows the bbox
      // handles; its box is the children/scene union mapped through the container transform (47b).
      if (only.isGroup) return groupAABB(only, project.objects, project.assets, time);
      if (isSymbolInstance(only, project.assets)) return instanceAABB(only, project.assets, time);
      return null;
    }
    if (selectedIds.length <= 1) return null;
    return multiSelectionAABB(selectedIds, project.objects, project.assets, time);
  }, [activeTool, selectedIds, project.objects, project.assets, time]);

  // Onion-skin ghosts: the selected vector object sampled at its neighbouring
  // keyframe times. Editor-only chrome; null when off / no selection / no ghosts.
  const onionGhosts = useMemo(() => {
    if (!onionSkin || !selectedId) return null;
    const obj = project.objects.find((o) => o.id === selectedId);
    const asset = obj ? assetsById.get(obj.assetId) : undefined;
    if (!obj || obj.hidden || isLockedInTree(obj, lockById) || !asset || asset.kind !== 'vector') return null;
    const { before, after } = onionSkinTimes(objectKeyframeTimes(obj), time, ONION_COUNT);
    if (before.length === 0 && after.length === 0) return null;
    return { obj, asset, before, after };
  }, [onionSkin, selectedId, project.objects, assetsById, lockById, time]);

  // The selected path's node overlay (node tool only): the path data to draw
  // (the in-progress drag preview when present, else the committed path) plus the
  // object transform so the overlay sits in the object's local space.
  const selectedPath = useMemo(() => {
    if (activeTool !== 'node' || !selectedId) return null;
    const obj = project.objects.find((o) => o.id === selectedId);
    if (!obj || obj.hidden || isLockedInTree(obj, lockById)) return null;
    // The shared resolver: sampled morph shape at the playhead, else the base.
    const base = selectEditablePath(useEditor.getState());
    if (!base) return null;
    // All editable rings (0 = primary, k = compoundRings[k-1]); the in-progress drag
    // preview (pathTools.working) is substituted into its ring only. `path`/`transform`
    // stay anchored to the PRIMARY ring so dragging a hole node never shifts the frame.
    const w = pathTools.working; // { ring, path } | null
    const committed = selectEditableRings(useEditor.getState());
    const rings = committed.map((p, i) => (w && w.ring === i ? w.path : p));
    const path = rings[0] ?? base; // rings[0] always defined here (committed >= 1 when base non-null)
    const state = sampleObject(obj, time);
    const anchor = resolveAnchor(obj, state, 'path', pathBounds(base));
    return { obj, path, rings, transform: buildTransform(state, anchor.anchorX, anchor.anchorY) };
  }, [activeTool, selectedId, project.objects, assetsById, lockById, time, pathTools.working]);

  // Per-node easings of the keyframe at the playhead — drives the node-overlay markers.
  const editedNodeEasings = selectEditedShapeKeyframe(useEditor.getState())?.kf.nodeEasings;

  // Correspondence edit overlay: both bracketing keyframes (from-selected) ghosted in the
  // same object-local space as the node overlay, with node→node links, grow-from-point
  // markers for unreferenced B nodes, and a crossing (non-order-preserving) warning flag.
  let corrOverlay: {
    transform: string;
    from: PathData;
    to: PathData;
    crossing: boolean;
    grow: number[];
    links: ReturnType<typeof linkSegments>;
  } | null = null;
  if (correspondenceEditing && selectedPath && selectedShapeKeyframe) {
    const o = project.objects.find((ob) => ob.id === selectedShapeKeyframe.objectId);
    const track = o?.shapeTrack;
    const idx = track
      ? track.findIndex((k) => Math.abs(k.time - selectedShapeKeyframe.time) < CORR_KF_EPS)
      : -1;
    if (track && idx >= 0 && idx < track.length - 1 && (track[idx].morph ?? 'corresponded') === 'corresponded') {
      const from = track[idx].path;
      const to = track[idx + 1].path;
      const map = track[idx].correspondence ?? identityCorrespondence(from.nodes.length, to.nodes.length);
      corrOverlay = {
        transform: selectedPath.transform,
        from,
        to,
        crossing: !isOrderPreserving(map, to.nodes.length, to.closed),
        grow: unreferencedTargets(map, to.nodes.length),
        links: linkSegments(from, to, map),
      };
    }
  }

  // Imperatively paint the current frame whenever doc/time changes (paused path).
  useEffect(() => {
    applyFrame(nodes, project, time);
  }, [project, time, nodes]);

  // Correspondence link-drag drop resolution. In a real browser the button-held pointerup
  // does not reliably dispatch on the B-node element (pointer target/capture semantics), so
  // resolve the drop target window-side via elementFromPoint. The per-B-node onPointerUp
  // handler remains for environments where the event does land on the target (jsdom tests);
  // whichever fires first nulls corrDragRef, so the link commits exactly once.
  useEffect(() => {
    const onUp = (e: PointerEvent) => {
      const ai = corrDragRef.current;
      if (ai === null) return;
      corrDragRef.current = null;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const m = /^corr-b-(\d+)$/.exec(el?.getAttribute('data-testid') ?? '');
      if (m) useEditor.getState().setCorrespondenceLink(ai, Number(m[1]));
    };
    window.addEventListener('pointerup', onUp);
    return () => window.removeEventListener('pointerup', onUp);
  }, []);

  // Cache one ref callback per object id so its identity is stable across
  // renders — otherwise React would null-then-reset the ref every render,
  // briefly dropping the node from the playback map.
  const refCallbacks = useRef(new Map<string, (el: SVGGraphicsElement | null) => void>());
  const register = (id: string) => {
    let cb = refCallbacks.current.get(id);
    if (!cb) {
      cb = (el: SVGGraphicsElement | null) => {
        if (el) nodes.set(id, el);
        else nodes.delete(id);
      };
      refCallbacks.current.set(id, cb);
    }
    return cb;
  };

  const objectDrag = useObjectDrag();
  const panZoom = usePanZoom();
  const contentRef = useRef<SVGGElement | null>(null);
  // Node-tool anchor dragging + snapping lives in useNodeDrag (owns the grab flag + snap-target
  // refs); the grab is started from onBackgroundPointerDown via beginGrab.
  const nodeDrag = useNodeDrag();
  const overlayGroupRef = useRef<SVGGElement | null>(null);
  // The A-node index whose link is being dragged in correspondence-edit mode; committed
  // on pointer-up over a B node (outside any setState updater, StrictMode-safe).
  const corrDragRef = useRef<number | null>(null);
  const previewRef = useRef<SVGRectElement | null>(null);
  const primitivePreviewRef = useRef<SVGPathElement | null>(null);
  const drawTool = useDrawTool(previewRef, primitivePreviewRef);
  // Freehand brush preview path; the brush stroke samples + commit live in useBrushTool.
  const brushPreviewRef = useRef<SVGPathElement | null>(null);
  const brushTool = useBrushTool(brushPreviewRef);
  const handleGroupRef = useRef<SVGGElement | null>(null);
  // Gradient-handle drag: the live preview gradient (drives re-render) + a ref with
  // the immutable start + latest gradient (commit reads the ref, StrictMode-safe).
  const gradientHandleGroupRef = useRef<SVGGElement | null>(null);
  const { dragState: gradientDrag, onHandlePointerDown: gradientBeginDrag, move: gradientMove, end: gradientEnd } = useGradientDrag(gradientHandleGroupRef);
  const [snapGuides, setSnapGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number } | null>(null);
  // Equal-spacing dimension guides shown during a single-object move drag (empty when none).
  const [spacingGuides, setSpacingGuides] = useState<SpacingGuide[]>([]);
  // Live angle readout shown at the cursor during a rotate drag (content coords); `snapped` flags
  // that the magnetic 45° snap engaged (the readout then highlights). Cleared on pointer-up.
  const [rotateHud, setRotateHud] = useState<{ x: number; y: number; label: string; snapped: boolean } | null>(null);
  const { marquee, beginSelect: beginMarquee, move: marqueeMove, end: endMarquee } = useMarqueeSelect();
  // Scale-handle dragging (group scale + single scale + rect/ellipse resize) lives in useScaleDrag;
  // Rotate-handle dragging (single + group) in useRotateDrag. Each hook owns its interaction
  // refs; the pointer-down handlers below snapshot from the derived memos and call begin*.
  const scaleDrag = useScaleDrag();
  const rotateDrag = useRotateDrag();
  const onGradientHandlePointerDown = (id: GradientHandleId, e: ReactPointerEvent) => {
    if (!selectedGradient) return;
    gradientBeginDrag(id, e, selectedGradient);
  };
  // Rotate-handle drag: pivot (resolved anchor mapped to screen, captured once at
  // pointer-down, invariant under rotation) + the snapshotted state; commit reads
  // the ref (StrictMode-safe).
  const rotateHandleGroupRef = useRef<SVGGElement | null>(null);
  const onRotateHandlePointerDown = (e: ReactPointerEvent) => {
    // Transform editing flows through keyframes (setProperty is autoKey-gated), so the
    // handle rotates only when auto-key is on — consistent with the resize handles.
    if (!selectedRotatable || !useEditor.getState().autoKey) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const group = rotateHandleGroupRef.current;
    const ctm = group?.getScreenCTM();
    const svg = group?.ownerSVGElement;
    if (!group || !ctm || !svg) return;
    // The resolved anchor mapped to screen = the rotation pivot (invariant under rot).
    const p = svg.createSVGPoint();
    p.x = selectedRotatable.anchorX;
    p.y = selectedRotatable.anchorY;
    const pivot = p.matrixTransform(ctm);
    rotateDrag.beginSingle({
      objId: selectedRotatable.obj.id,
      pivot: { x: pivot.x, y: pivot.y },
      start: { x: e.clientX, y: e.clientY },
      startRotation: selectedRotatable.state.rotation,
      anchorX: selectedRotatable.anchorX,
      anchorY: selectedRotatable.anchorY,
      state: selectedRotatable.state,
      last: undefined,
    });
  };
  // Scale-handle drag (imported-svg & path): snapshot the start transform; each move
  // maps the pointer to content space and recomputes scale+translation (opposite corner
  // fixed). Commit reads the ref (StrictMode-safe).
  const scaleGroupRef = useRef<SVGGElement | null>(null);
  const onScaleHandlePointerDown = (id: ScaleHandleId, e: ReactPointerEvent) => {
    if (!selectedScalable) return;
    // Claim the gesture before the autoKey gate (like the resize handles) so an
    // autoKey-off click on a handle is a clean no-op and does NOT bubble to the
    // background and deselect the object.
    e.stopPropagation();
    if (!useEditor.getState().autoKey) return; // transform edits flow through keyframes
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const corners = scaleHandleLocalPositions(selectedScalable.bbox);
    const proj = selectEditProject(useEditor.getState());
    const t = useEditor.getState().time;
    const scaleTargets: AABB[] = [];
    for (const o of proj.objects) {
      if (o.isGroup || o.id === selectedScalable.obj.id) continue;
      const a = entityAABB(o, proj.objects, proj.assets, t);
      if (a) scaleTargets.push(a);
    }
    scaleTargets.push({ minX: 0, minY: 0, maxX: proj.meta.width, maxY: proj.meta.height });
    scaleDrag.beginScale({
      snapshot: {
        objId: selectedScalable.obj.id,
        state: selectedScalable.state,
        corner: corners[id],
        opposite: corners[oppositeHandle(id)],
        anchorX: selectedScalable.anchorX,
        anchorY: selectedScalable.anchorY,
        startScaleX: selectedScalable.state.scaleX,
        startScaleY: selectedScalable.state.scaleY,
        baseX: selectedScalable.state.x,
        baseY: selectedScalable.state.y,
        rotationDeg: selectedScalable.state.rotation,
      },
      targets: scaleTargets,
    });
  };
  // Snapshots everything applyHandleResize needs at drag start (in OLD geometry).
  function snapshotForResize() {
    const sv = selectedVector!;
    return {
      objId: sv.obj.id,
      isEllipse: sv.shapeType === 'ellipse',
      width: sv.width,
      height: sv.height,
      anchorFracX: sv.obj.anchorX,
      anchorFracY: sv.obj.anchorY,
      baseX: sv.state.x,
      baseY: sv.state.y,
      scaleX: sv.state.scaleX,
      scaleY: sv.state.scaleY,
      rotationDeg: sv.state.rotation,
    };
  }

  const onHandlePointerDown = (handle: HandleId, e: ReactPointerEvent) => {
    e.stopPropagation();
    if (!selectedVector || !useEditor.getState().autoKey) return;
    // Snap targets: every other object's stage AABB + the artboard (same set move/scale-snap uses).
    const proj = selectEditProject(useEditor.getState());
    const t = useEditor.getState().time;
    const targets: AABB[] = [];
    for (const o of proj.objects) {
      if (o.isGroup || o.id === selectedVector.obj.id) continue;
      const a = entityAABB(o, proj.objects, proj.assets, t);
      if (a) targets.push(a);
    }
    targets.push({ minX: 0, minY: 0, maxX: proj.meta.width, maxY: proj.meta.height });
    scaleDrag.beginResize({ handle, snapshot: snapshotForResize(), targets });
  };

  // Maps client (screen) coords to stage-local coords through the content group's
  // CTM, so draw/handle math accounts for viewBox scaling, pan, and zoom.
  // Coordinate-space conversions (./stageCoords): client↔content and client/stage↔object-local
  // via live SVG CTMs. Recreated each render like the inline closures they replaced.
  const { clientToLocal, clientToObjectLocal, stageToObjectLocal } = makeStageCoordinates(contentRef, overlayGroupRef);


  const onBackgroundPointerDown = (e: ReactPointerEvent) => {
    const s = useEditor.getState();
    if (panZoom.beginPan(e)) return;
    if (s.activeTool === 'eyedropper') {
      // One-shot: an empty-canvas press has no source object, so it's just a cancel —
      // revert to Select without touching history. No drag, no marquee.
      s.setActiveTool('select');
      return;
    }
    if (
      s.activeTool === 'rect' || s.activeTool === 'ellipse' ||
      s.activeTool === 'polygon' || s.activeTool === 'star' || s.activeTool === 'line'
    ) {
      const start = clientToLocal(e.clientX, e.clientY);
      if (start) drawTool.begin(start);
      return;
    }
    if (s.activeTool === 'pen' || s.activeTool === 'motion') {
      const local = clientToLocal(e.clientX, e.clientY);
      if (!local) return;
      const d = pathTools.draft;
      // Clicking the first anchor (with >= 2 nodes drawn) closes the path.
      if (d && d.nodes.length >= 2 && nearFirstAnchor({ nodes: d.nodes, closed: false }, local, CLOSE_TOL / s.zoom)) {
        pathTools.finishPen(true);
      } else {
        pathTools.onPenPointerDown(local, true);
      }
      return;
    }
    if (s.activeTool === 'brush') {
      const start = clientToLocal(e.clientX, e.clientY);
      if (start) brushTool.begin(start);
      return;
    }
    if (s.activeTool === 'node') {
      const local = clientToObjectLocal(e.clientX, e.clientY);
      if (!local) return;
      const tol = CLOSE_TOL / s.zoom;
      if (pathTools.onNodePointerDown(local, tol)) {
        // Snap targets: every other object's stage AABB + the artboard (same set move/scale-snap
        // uses), excluding the path being edited. Consumed by the node-drag handler.
        const proj = selectEditProject(s);
        const selfId = selectedPath?.obj.id;
        const targets: AABB[] = [];
        for (const o of proj.objects) {
          if (o.isGroup || o.id === selfId) continue;
          const a = entityAABB(o, proj.objects, proj.assets, s.time);
          if (a) targets.push(a);
        }
        targets.push({ minX: 0, minY: 0, maxX: proj.meta.width, maxY: proj.meta.height });
        // Vertex targets: every path's node anchors in world coords — OTHER paths (incl. grouped, via
        // the parent-chain compose) AND the self path's other nodes (excluding the dragged one, so a
        // node snaps onto its own path's vertices). onNodePointerDown just selected the grabbed node.
        const grabbedRing = useEditor.getState().selectedNodeRing;
        const grabbedIdx = grabbedRing ? -1 : (useEditor.getState().selectedNodeIndex ?? -1);
        nodeDrag.beginGrab(targets, nodeSnapVertices(proj.objects, proj.assets, selfId ?? '', grabbedIdx, s.time));
        return;
      }
      // Missed a node/handle: clicking a segment inserts a node there — scan every ring so
      // a click on a hole's edge inserts on that compound ring.
      const rings = selectedPath?.rings ?? [];
      for (let r = 0; r < rings.length; r++) {
        const seg = hitTestSegment(rings[r], local, tol);
        if (seg) {
          useEditor.getState().insertNode(r, seg.segmentIndex, seg.t);
          break;
        }
      }
      return;
    }
    if (s.activeTool === 'select') {
      beginMarquee(e, clientToLocal);
    }
  };

  const onSvgDoubleClick = () => {
    if (useEditor.getState().penDrafting) pathTools.finishPen(false);
  };

  // Double-click an instance's leaf to ENTER its symbol scene (edit-in-place, slice 47 edit-mode).
  const onObjectDoubleClick = (id: string) => {
    const proj = selectEditProject(useEditor.getState());
    const obj = proj.objects.find((o) => o.id === id);
    if (obj && isSymbolInstance(obj, proj.assets)) useEditor.getState().enterSymbol(obj.assetId);
  };

  const onObjectPointerDown = (id: string, e: ReactPointerEvent) => {
    if (useEditor.getState().activeTool === 'eyedropper') {
      // One-shot: press on an object restyles the selection from it (or copies to the
      // clipboard with no selection — applyStyleFrom's own semantics); any press exits
      // back to Select. No drag, no marquee. Even a locked object is a valid style source.
      e.stopPropagation();
      useEditor.getState().applyStyleFrom(id);
      useEditor.getState().setActiveTool('select');
      return;
    }
    const downProj = selectEditProject(useEditor.getState());
    const target = downProj.objects.find((o) => o.id === id);
    // inert: a locked object — or one inside a locked group (cascade) — bubbles to background -> deselect
    if (target && isLockedInTree(target, new Map(downProj.objects.map((o) => [o.id, o])))) return;
    e.stopPropagation();
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      useEditor.getState().toggleObjectOrGroup(id); // selection-building gesture: no move-drag (slice 42: whole group)
      return;
    }
    // Dragging a member of an existing multi-selection moves the whole set (slice 37).
    // Otherwise collapse to the clicked object's GROUP (slice 42) — which may itself be
    // several objects, so we must re-read the selection AFTER expansion to decide whether
    // this is a single- or multi-object drag (a one-gesture click-drag on a grouped
    // object must move the whole group, not just the clicked member).
    const ids = useEditor.getState().selectedObjectIds;
    const alreadyMulti = ids.includes(id) && ids.length > 1;
    if (!alreadyMulti) useEditor.getState().selectObjectOrGroup(id);
    // A grouped object resolves to its GROUP container (slice 45b): the drag moves the whole
    // group as a unit — preview its children, commit via nudgeSelected (selectedObjectIds is
    // now [groupId]) which keyframes the group when auto-key is on (animatable, 45d) else its
    // base. Groups always begin a move-drag (regardless of auto-key). Snap the children-bbox
    // like a multi-move (slice 44).
    const grp =
      !alreadyMulti
        ? selectEditProject(useEditor.getState()).objects.find(
            (o) => o.id === useEditor.getState().selectedObjectId && o.isGroup,
          )
        : undefined;
    if (grp) {
      const proj = selectEditProject(useEditor.getState());
      const t = useEditor.getState().time;
      const children = proj.objects.filter((o) => o.parentId === grp.id);
      const items = children.map((o) => {
        const sm = sampleObject(o, t);
        return { id: o.id, ox: sm.x, oy: sm.y };
      });
      const childIds = new Set(children.map((o) => o.id));
      const memberBoxes: AABB[] = [];
      const targets: AABB[] = [];
      for (const o of proj.objects) {
        if (o.isGroup) continue;
        const box = objectAABB(o, proj.assets.find((a) => a.id === o.assetId), t);
        if (!box) continue;
        if (childIds.has(o.id)) memberBoxes.push(box);
        else targets.push(box);
      }
      targets.push({ minX: 0, minY: 0, maxX: proj.meta.width, maxY: proj.meta.height });
      objectDrag.begin({
        id: grp.id, startX: e.clientX, startY: e.clientY, originX: 0, originY: 0, curX: 0, curY: 0, moved: false,
        baseAABB: groupBBox(memberBoxes), targets, multi: { items, dx: 0, dy: 0 },
      });
      return;
    }
    // Only begin a move-drag when auto-key is on (editing is otherwise blocked).
    if (!useEditor.getState().autoKey) return;
    const dragIds = alreadyMulti ? ids : useEditor.getState().selectedObjectIds;
    if (dragIds.length > 1) {
      const proj = selectEditProject(useEditor.getState());
      const t = useEditor.getState().time;
      // The MOVING objects: each selected entity, expanding a group container to its children
      // (a group has no node — it previews via its children; the commit moves the group's
      // base because nudgeSelected reads selectedObjectIds, which still holds the group id).
      const movingLockById = new Map(proj.objects.map((o) => [o.id, o]));
      const moving = dragIds.flatMap((sid) => {
        const o = proj.objects.find((ob) => ob.id === sid);
        if (!o || isLockedInTree(o, movingLockById)) return []; // skip locked (incl. via parent group)
        return o.isGroup ? proj.objects.filter((c) => c.parentId === o.id) : [o];
      });
      const items = moving.map((o) => {
        const s = sampleObject(o, t);
        return { id: o.id, ox: s.x, oy: s.y };
      });
      // Snap (slice 44): the group bbox of the MOVING objects, plus snap targets = every
      // other object's stage AABB + the artboard (mirrors single-drag).
      const sel = new Set(moving.map((o) => o.id));
      const memberBoxes: AABB[] = [];
      const targets: AABB[] = [];
      for (const o of proj.objects) {
        if (o.isGroup) continue; // group containers have no box of their own
        const box = objectAABB(o, proj.assets.find((as) => as.id === o.assetId), t);
        if (!box) continue;
        if (sel.has(o.id)) {
          memberBoxes.push(box);
        } else {
          targets.push(box);
        }
      }
      targets.push({ minX: 0, minY: 0, maxX: proj.meta.width, maxY: proj.meta.height });
      objectDrag.begin({
        id, startX: e.clientX, startY: e.clientY, originX: 0, originY: 0, curX: 0, curY: 0, moved: false,
        baseAABB: groupBBox(memberBoxes), targets, multi: { items, dx: 0, dy: 0 },
      });
      return;
    }
    const obj = selectEditProject(useEditor.getState()).objects.find((o) => o.id === id);
    if (!obj) return;
    const origin = sampleObject(obj, useEditor.getState().time);
    // Snapping targets: every other object's stage AABB + the artboard (slice 33).
    const proj = selectEditProject(useEditor.getState());
    const dragTime = useEditor.getState().time;
    const targets: AABB[] = [];
    for (const o of proj.objects) {
      if (o.id === id || o.isGroup) continue; // group containers have no box; their children count individually
      const a = entityAABB(o, proj.objects, proj.assets, dragTime); // objectAABB for leaves, instanceAABB for instances (47b)
      if (a) targets.push(a);
    }
    targets.push({ minX: 0, minY: 0, maxX: proj.meta.width, maxY: proj.meta.height });
    objectDrag.begin({
      id, startX: e.clientX, startY: e.clientY,
      originX: origin.x, originY: origin.y, curX: origin.x, curY: origin.y, moved: false,
      // entityAABB so a symbol instance (objectAABB is null for it) snaps by its scene bbox (47b).
      baseAABB: entityAABB(obj, proj.objects, proj.assets, dragTime), targets,
    });
  };

  // Begin a group-scale drag from a handle on the multi-selection bbox (slice 40). Captures
  // each object's origin transform + resolved anchor; commits via setObjectsTransforms on up.
  // Live-preview a group container's handle drag: a group has no DOM node, so compose the
  // in-progress group transform (`prefix`) onto each child's node — exactly the 45a
  // computeFrame composition. On release the commit writes the group base and applyFrame
  // re-renders identically (slice 45b).
  // Defined after previewSubtree below; rewritten to recompute-frame so a group's instance and
  // nested-group children (which have no DOM node of their own) preview too — see below.

  // Live-preview a CONTAINER that has no DOM node of its own (a symbol instance or a group):
  // recompute the frame from a project where the container carries the in-progress transform as
  // a static base (tracks stripped so it samples to `base`), then apply ONLY this container's own
  // leaves (`ownRenderId`). Reusing computeFrame — the exact commit path — makes the preview match
  // the committed result by construction; touching only this container's leaves means a mixed
  // multi-selection drag never reverts sibling objects' in-progress previews (slice 47b, review).
  const previewSubtree = (
    proj: Project,
    containerId: string,
    base: Transform2D,
    time: number,
    ownRenderId: (id: string) => boolean,
  ) => {
    const container = proj.objects.find((o) => o.id === containerId);
    if (!container) return;
    const previewObj = { ...container, base, tracks: {} };
    const previewProj = { ...proj, objects: proj.objects.map((o) => (o.id === containerId ? previewObj : o)) };
    const own = computeFrame(previewProj, time).filter((it) => ownRenderId(it.objectId));
    applyFrameToNodes(nodes, own);
  };

  // An instance renders only as `instId/…` leaves.
  const previewInstanceChildren = (proj: Project, instance: SceneObject, time: number, base: Transform2D) => {
    previewSubtree(proj, instance.id, base, time, (id) => id.startsWith(`${instance.id}/`));
  };

  // A group's subtree leaves — leaf children, instance leaves (`instId/…`), and nested-group
  // leaves — are all resolved by computeFrame's parent-chain walk. Filter to the group's own
  // subtree: split a composite renderId at the first '/' to map it back to its proj.objects-level
  // producer, then keep it iff that producer is a descendant of the group (so a mixed multi-select
  // drag never reverts a sibling's preview).
  const previewGroupChildren = (proj: Project, group: SceneObject, time: number, base: Transform2D) => {
    const descendants = groupDescendantIds(proj.objects, group.id);
    previewSubtree(proj, group.id, base, time, (id) => descendants.has(id.split('/')[0]));
  };

  // True when exactly one GROUP container is selected (its bbox handles edit the group's
  // transform — keyframed when auto-key is on, base when off; slices 45b/45d).
  const isSingleGroupSelected = () => {
    const ids = useEditor.getState().selectedObjectIds;
    return ids.length === 1 && !!selectEditProject(useEditor.getState()).objects.find((o) => o.id === ids[0] && o.isGroup);
  };

  const onGroupHandlePointerDown = (hid: HandleId, e: ReactPointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId); // robust drag delivery (like the other handles)
    if (!groupBounds) return;
    // A single GROUP transforms regardless of auto-key (the commit keyframes it when auto-key
    // is on, else writes base — 45d).
    if (!isSingleGroupSelected() && !useEditor.getState().autoKey) return;
    const w = groupBounds.maxX - groupBounds.minX;
    const h = groupBounds.maxY - groupBounds.minY;
    const pos = handleLocalPositions(w, h);
    const opp = oppositeHandle(hid as ScaleHandleId);
    const corner = { x: groupBounds.minX + pos[hid].x, y: groupBounds.minY + pos[hid].y };
    const pivot = { x: groupBounds.minX + pos[opp].x, y: groupBounds.minY + pos[opp].y };
    const sxAxis = hid === 'e' || hid === 'w' || hid.length === 2; // corners + left/right edges
    const syAxis = hid === 'n' || hid === 's' || hid.length === 2; // corners + top/bottom edges
    const proj = selectEditProject(useEditor.getState());
    const t = useEditor.getState().time;
    const scaleLockById = new Map(proj.objects.map((o) => [o.id, o]));
    const items = selectedIds
      .map((id) => proj.objects.find((o) => o.id === id))
      .filter((o): o is SceneObject => !!o && !isLockedInTree(o, scaleLockById) && !o.hidden)
      .map((o) => {
        const oAsset = proj.assets.find((a) => a.id === o.assetId);
        const st = sampleObject(o, t, oAsset?.kind === 'vector' ? oAsset.primitive : undefined);
        const r = resolveObjectAnchor(o, oAsset, st);
        return { id: o.id, ox: st.x, oy: st.y, osx: st.scaleX, osy: st.scaleY, ax: r ? r.anchorX : o.anchorX, ay: r ? r.anchorY : o.anchorY };
      });
    // Snap targets: every other top-level object's stage AABB + the artboard (same set move-snap uses).
    const scaleTargets: AABB[] = [];
    for (const o of proj.objects) {
      if (o.isGroup || selectedIds.includes(o.id)) continue; // skip the things being scaled
      const a = entityAABB(o, proj.objects, proj.assets, t);
      if (a) scaleTargets.push(a);
    }
    scaleTargets.push({ minX: 0, minY: 0, maxX: proj.meta.width, maxY: proj.meta.height });
    scaleDrag.beginGroup({ pivot, corner, sxAxis, syAxis, items, targets: scaleTargets, sx: 1, sy: 1, moved: false });
  };

  // Begin a group-rotate drag from the handle above the multi-selection bbox (slice 41).
  const onGroupRotatePointerDown = (e: ReactPointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (!groupBounds) return;
    if (!isSingleGroupSelected() && !useEditor.getState().autoKey) return;
    const start = clientToLocal(e.clientX, e.clientY);
    if (!start) return;
    const center = { x: (groupBounds.minX + groupBounds.maxX) / 2, y: (groupBounds.minY + groupBounds.maxY) / 2 };
    const proj = selectEditProject(useEditor.getState());
    const t = useEditor.getState().time;
    const rotLockById = new Map(proj.objects.map((o) => [o.id, o]));
    const items = selectedIds
      .map((id) => proj.objects.find((o) => o.id === id))
      .filter((o): o is SceneObject => !!o && !isLockedInTree(o, rotLockById) && !o.hidden)
      .map((o) => {
        const oAsset = proj.assets.find((a) => a.id === o.assetId);
        const st = sampleObject(o, t, oAsset?.kind === 'vector' ? oAsset.primitive : undefined);
        const r = resolveObjectAnchor(o, oAsset, st);
        return { id: o.id, ox: st.x, oy: st.y, orot: st.rotation, ax: r ? r.anchorX : o.anchorX, ay: r ? r.anchorY : o.anchorY };
      });
    rotateDrag.beginGroup({ center, start, items, theta: 0, moved: false });
  };

  useEffect(() => {
    // Shared deps for the extracted transform-drag hooks, captured here (same point the inline
    // branches captured them) so the delegated move/end behave identically to the old code.
    const rotateCtx = { nodes, clientToLocal, setRotateHud, rotateHandleGroupRef, previewGroupChildren, previewInstanceChildren };
    const scaleCtx = { nodes, zoom, clientToLocal, setSnapGuides, contentRef, handleGroupRef, scaleGroupRef, previewGroupChildren, previewInstanceChildren };
    const objectCtx = { nodes, setSnapGuides, setSpacingGuides, setDragOffset, previewGroupChildren, previewInstanceChildren };
    const nodeCtx = { clientToLocal, clientToObjectLocal, stageToObjectLocal, setSnapGuides, zoom, pathToolsRef };
    const onMove = (e: PointerEvent) => {
      // Each interaction is delegated to its hook, which self-gates on its own ref/tool and
      // returns true when it consumed the event (the interactions are mutually exclusive, so the
      // order is immaterial). Snap-bypass (hold Cmd/Ctrl) is read per-hook from the event.
      if (scaleDrag.move(e, scaleCtx)) return;
      if (rotateDrag.move(e, rotateCtx)) return;
      if (gradientMove(e)) return;
      const tool = useEditor.getState().activeTool;
      if (tool === 'pen' || tool === 'motion') {
        const local = clientToLocal(e.clientX, e.clientY);
        if (local) {
          pathToolsRef.current.onPenDrag(local);
          pathToolsRef.current.onPenPointerMove(local);
        }
        return;
      }
      if (nodeDrag.move(e, nodeCtx)) return;
      if (brushTool.move(e, clientToLocal)) return;
      if (drawTool.move(e, clientToLocal)) return;
      if (panZoom.panMove(e)) return;
      if (marqueeMove(e, clientToLocal)) return;
      if (objectDrag.move(e, objectCtx)) return;
    };
    const onUp = () => {
      if (scaleDrag.end(scaleCtx)) return;
      if (rotateDrag.end(rotateCtx)) return;
      if (endMarquee()) return;
      if (gradientEnd()) return;
      const tool = useEditor.getState().activeTool;
      if (tool === 'pen' || tool === 'motion') {
        pathToolsRef.current.onPenPointerUp();
        return;
      }
      if (nodeDrag.end(nodeCtx)) return;
      if (brushTool.end()) return;
      if (drawTool.end()) return;
      if (objectDrag.end(objectCtx)) return;
      panZoom.endPan(); // pan-up (and any no-match) falls through here
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  return (
    <div className={styles.root}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${project.meta.width} ${project.meta.height}`}
        onPointerDown={onBackgroundPointerDown}
        onDoubleClick={onSvgDoubleClick}
        onWheel={panZoom.onWheel}
        onPointerMove={(e) => setStageCursor(clientToLocal(e.clientX, e.clientY))}
        onPointerLeave={() => setStageCursor(null)}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-savig-symbol')) e.preventDefault(); }}
        onDrop={(e) => {
          const symId = e.dataTransfer.getData('application/x-savig-symbol');
          if (!symId) return;
          e.preventDefault();
          const p = clientToLocal(e.clientX, e.clientY);
          if (p) useEditor.getState().placeSymbolInstanceAt(symId, p.x, p.y);
        }}
      >
        <g ref={contentRef} transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          <defs dangerouslySetInnerHTML={{ __html: defs + clipPathDefs + tintFilterDefs }} />
          {gridEnabled &&
            Math.floor(project.meta.width / gridSize) + Math.floor(project.meta.height / gridSize) <= 400 && (
              <g data-testid="grid-overlay" pointerEvents="none">
                {Array.from({ length: Math.floor(project.meta.width / gridSize) + 1 }, (_, i) => i * gridSize).map((x) => (
                  <line key={`gx${x}`} x1={x} y1={0} x2={x} y2={project.meta.height} stroke="var(--color-accent)" strokeWidth={0.5 / zoom} opacity={0.18} />
                ))}
                {Array.from({ length: Math.floor(project.meta.height / gridSize) + 1 }, (_, i) => i * gridSize).map((y) => (
                  <line key={`gy${y}`} x1={0} y1={y} x2={project.meta.width} y2={y} stroke="var(--color-accent)" strokeWidth={0.5 / zoom} opacity={0.18} />
                ))}
              </g>
            )}
          <rect
            ref={previewRef}
            data-testid="draw-preview"
            visibility="hidden"
            fill="none"
            stroke="var(--color-accent)"
            strokeDasharray="4 2"
            pointerEvents="none"
          />
          <path
            ref={primitivePreviewRef}
            data-testid="primitive-preview"
            visibility="hidden"
            fill="none"
            stroke="var(--color-accent)"
            strokeDasharray="4 2"
            pointerEvents="none"
          />
          <path
            ref={brushPreviewRef}
            data-testid="brush-preview"
            visibility="hidden"
            fill="none"
            stroke="var(--color-accent)"
            pointerEvents="none"
          />
          {onionGhosts &&
            (() => {
              const { obj, asset } = onionGhosts;
              const ghost = (ghostTime: number, tint: string, opacity: number, key: string) => {
                const gs = sampleObject(obj, ghostTime);
                if (asset.shapeType === 'path') {
                  const path = gs.path ?? asset.path ?? { nodes: [], closed: false };
                  const anchor = resolveAnchor(obj, gs, 'path', pathBounds(path));
                  return (
                    <g key={key} transform={buildTransform(gs, anchor.anchorX, anchor.anchorY)} opacity={opacity}>
                      <path
                        data-testid={key}
                        d={pathToD(path)}
                        fill={tint}
                        fillOpacity={0.18}
                        stroke={tint}
                        strokeWidth={1.5 / zoom}
                      />
                    </g>
                  );
                }
                const anchor = resolveAnchor(obj, gs, asset.shapeType);
                const ShapeTag = asset.shapeType === 'rect' ? 'rect' : 'ellipse';
                return (
                  <g key={key} transform={buildTransform(gs, anchor.anchorX, anchor.anchorY)} opacity={opacity}>
                    <ShapeTag
                      data-testid={key}
                      {...geometryToSvgAttrs(asset.shapeType, gs.geometry ?? {})}
                      fill={tint}
                      fillOpacity={0.18}
                      stroke={tint}
                      strokeWidth={1.5 / zoom}
                    />
                  </g>
                );
              };
              return (
                <g data-testid="onion-skins" pointerEvents="none">
                  {onionGhosts.before.map((t, i) =>
                    ghost(t, 'var(--onion-before)', ONION_OPACITY[i] ?? 0.2, `onion-ghost-before-${i}`),
                  )}
                  {onionGhosts.after.map((t, i) =>
                    ghost(t, 'var(--onion-after)', ONION_OPACITY[i] ?? 0.2, `onion-ghost-after-${i}`),
                  )}
                </g>
              );
            })()}
          {(() => {
            // Render leaves, grouping consecutive clipping leaves under a
            // <g clipPath="url(#id)"> wrapper (slice 47e). Non-clipping leaves
            // render individually as before (parity when clip absent).
            const renderOneleaf = (leaf: (typeof renderLeaves)[number]) => {
              const o = leaf.object;
              const renderId = leaf.renderId;
              const topId = renderId.split('/')[0]; // instances are atomic in 47a: route to the top-level ancestor
              const asset = assetsById.get(o.assetId);
              if (asset?.kind === 'vector') {
                // Render shapes as real React elements so all attribute values (incl.
                // style.fill/stroke and the path `d`, which may derive from a loaded
                // .savig) are escaped by React — no dangerouslySetInnerHTML.
                // Effective gradients = the playhead sample (animated track) or the
                // static asset gradient. Matches the export's resolution exactly so the
                // editor preview shows the gradient even when it lives only on a track.
                const sampledObj = sampleObject(o, time, asset.primitive);
                // During a gradient-handle drag, preview the in-progress gradient on
                // the dragged object's paint so the fill/stroke updates live.
                const dragG = gradientDrag && selectedGradient?.obj.id === o.id ? gradientDrag : null;
                const fillGrad =
                  dragG?.property === 'fill'
                    ? dragG.gradient
                    : (sampledObj.fillGradient ?? asset.style.fillGradient);
                const strokeGrad =
                  dragG?.property === 'stroke'
                    ? dragG.gradient
                    : (sampledObj.strokeGradient ?? asset.style.strokeGradient);
                // Dash: pathLength-normalized; offset = sampled (animated) ?? static.
                // Spread into both shape branches; undefined props are omitted by React.
                const dashed = !!asset.style.strokeDasharray && asset.style.strokeDasharray.length > 0;
                const trim = !dashed && sampledObj.trim ? trimToDashAttrs(sampledObj.trim) : null;
                const dashProps = dashed
                  ? {
                      strokeDasharray: asset.style.strokeDasharray!.join(' '),
                      pathLength: 1,
                      strokeDashoffset: sampledObj.strokeDashoffset ?? asset.style.strokeDashoffset ?? 0,
                    }
                  : trim
                    ? {
                        pathLength: 1,
                        strokeDasharray: trim['stroke-dasharray'],
                        strokeDashoffset: trim['stroke-dashoffset'],
                      }
                    : {};
                if (asset.shapeType === 'path') {
                  // Live boolean: the rendered path is the clip of its operands at the playhead
                  // (applyFrame re-drives `d` each frame; this sets the initial `d` + the evenodd
                  // fill-rule, which applyFrame does not touch).
                  const boolRings = o.boolean ? resolveBooleanRings(project, o, time) : null;
                  return (
                    <g
                      key={renderId}
                      ref={register(renderId)}
                      data-testid={`object-${renderId}`}
                      data-savig-object={renderId}
                      data-selected={topId === selectedId}
                      className={styles.object}
                      onPointerDown={(e) => onObjectPointerDown(topId, e)}
                      onDoubleClick={() => onObjectDoubleClick(topId)}
                    >
                      <path
                        d={
                          boolRings
                            ? (boolRings.length > 0 ? pathToDRings(boolRings[0], boolRings.slice(1)) : '')
                            : sampledObj.path
                              ? pathToD(sampledObj.path)
                              : asset.path
                                ? pathToDRings(asset.path, asset.compoundRings)
                                : ''
                        }
                        fillRule={
                          boolRings ? 'evenodd' : asset.compoundRings && asset.compoundRings.length > 0 ? 'evenodd' : undefined
                        }
                        fill={fillGrad ? paintRef(`savig-grad-${renderId}-fill`) : asset.style.fill}
                        stroke={strokeGrad ? paintRef(`savig-grad-${renderId}-stroke`) : asset.style.stroke}
                        strokeWidth={asset.style.strokeWidth}
                        strokeLinecap={asset.style.strokeLinecap}
                        strokeLinejoin={asset.style.strokeLinejoin}
                        {...dashProps}
                      />
                      {fillGrad && <GradientEl id={`savig-grad-${renderId}-fill`} g={fillGrad} />}
                      {strokeGrad && <GradientEl id={`savig-grad-${renderId}-stroke`} g={strokeGrad} />}
                    </g>
                  );
                }
                const geometry = sampledObj.geometry ?? {};
                // Geometry flows through the shared geometryToSvgAttrs so it matches
                // export/runtime.
                const geomAttrs = geometryToSvgAttrs(asset.shapeType, geometry);
                const ShapeTag = asset.shapeType === 'rect' ? 'rect' : 'ellipse';
                return (
                  <g
                    key={renderId}
                    ref={register(renderId)}
                    data-testid={`object-${renderId}`}
                    data-savig-object={renderId}
                    data-selected={topId === selectedId}
                    className={styles.object}
                    onPointerDown={(e) => onObjectPointerDown(topId, e)}
                      onDoubleClick={() => onObjectDoubleClick(topId)}
                  >
                    <ShapeTag
                      {...geomAttrs}
                      fill={fillGrad ? paintRef(`savig-grad-${renderId}-fill`) : asset.style.fill}
                      stroke={strokeGrad ? paintRef(`savig-grad-${renderId}-stroke`) : asset.style.stroke}
                      strokeWidth={asset.style.strokeWidth}
                      strokeLinecap={asset.style.strokeLinecap}
                      strokeLinejoin={asset.style.strokeLinejoin}
                      {...dashProps}
                    />
                    {fillGrad && <GradientEl id={`savig-grad-${renderId}-fill`} g={fillGrad} />}
                    {strokeGrad && <GradientEl id={`savig-grad-${renderId}-stroke`} g={strokeGrad} />}
                  </g>
                );
              }
              if (asset?.kind === 'text') {
                // Positioned at local (0,0); the <g> transform (applied imperatively by applyFrame)
                // places it. text-before-edge baseline matches the export. (M5 slice 9)
                return (
                  <g
                    key={renderId}
                    ref={register(renderId)}
                    data-testid={`object-${renderId}`}
                    data-savig-object={renderId}
                    data-selected={topId === selectedId}
                    className={styles.object}
                    onPointerDown={(e) => onObjectPointerDown(topId, e)}
                    onDoubleClick={() => onObjectDoubleClick(topId)}
                  >
                    <text
                      x={0}
                      y={0}
                      fontSize={asset.fontSize}
                      fontFamily={asset.fontFamily}
                      fill={asset.fill}
                      stroke={asset.stroke && asset.stroke !== 'none' ? asset.stroke : undefined}
                      strokeWidth={asset.stroke && asset.stroke !== 'none' ? asset.strokeWidth : undefined}
                      textAnchor={asset.textAnchor}
                      dominantBaseline="text-before-edge"
                    >
                      {asset.content}
                    </text>
                  </g>
                );
              }
              return (
                <use
                  key={renderId}
                  ref={register(renderId)}
                  data-testid={`object-${renderId}`}
                  data-savig-object={renderId}
                  data-selected={topId === selectedId}
                  className={styles.object}
                  href={`#savig-asset-${o.assetId}`}
                  onPointerDown={(e) => onObjectPointerDown(topId, e)}
                      onDoubleClick={() => onObjectDoubleClick(topId)}
                />
              );
            };

            // Group consecutive clipping leaves under a <g clipPath> wrapper, and tinted
            // leaves under a <g filter> wrapper (slice 47f). Both may apply simultaneously
            // (outer tint, inner clip). INVARIANT: all leaves of one symbol instance are
            // contiguous because flattenInstances processes each symbol's subtree depth-first.
            const output: React.ReactNode[] = [];
            let idx = 0;
            while (idx < renderLeaves.length) {
              const leaf = renderLeaves[idx];
              const runClipId = leaf.clipId;
              const runTintId = leaf.tintId;
              if (runClipId || runTintId) {
                const run: (typeof renderLeaves)[number][] = [];
                while (
                  idx < renderLeaves.length &&
                  renderLeaves[idx].clipId === runClipId &&
                  renderLeaves[idx].tintId === runTintId
                ) {
                  run.push(renderLeaves[idx]);
                  idx++;
                }
                // Build innermost → outermost: clip wraps leaves, tint wraps clip.
                let node: React.ReactNode = run.map(renderOneleaf);
                if (runClipId) {
                  node = (
                    <g key={`clip-group-${runClipId}`} clipPath={`url(#${runClipId})`} data-testid={`clip-group-${runClipId}`}>
                      {node}
                    </g>
                  );
                }
                if (runTintId) {
                  node = (
                    <g key={`tint-group-${runTintId}`} filter={`url(#${runTintId})`} data-testid={`tint-group-${runTintId}`}>
                      {node}
                    </g>
                  );
                }
                output.push(node);
              } else {
                output.push(renderOneleaf(leaf));
                idx++;
              }
            }
            return output;
          })()}
          {/* Stage frame + out-of-bounds scrim. Rendered ABOVE the object leaves so
              out-of-bounds content is dimmed, but BELOW the selection handles/overlays
              (which come after) so handles stay crisp. Purely visual — pointerEvents=none
              keeps out-of-bounds objects clickable. */}
          {frameEnabled &&
            (() => {
              const W = project.meta.width;
              const H = project.meta.height;
              const M = 100000; // far-outside extent; the scrim covers any pan/zoom viewport
              return (
                <g data-testid="stage-frame-overlay" pointerEvents="none">
                  <path
                    data-testid="stage-scrim"
                    d={`M${-M} ${-M} H${W + M} V${H + M} H${-M} Z M0 0 H${W} V${H} H0 Z`}
                    fillRule="evenodd"
                    fill="var(--stage-scrim)"
                  />
                  <rect
                    data-testid="stage-frame"
                    x={0}
                    y={0}
                    width={W}
                    height={H}
                    fill="none"
                    stroke="var(--stage-frame)"
                    strokeWidth={1.5 / zoom}
                  />
                </g>
              );
            })()}
          {/* Live-boolean operand ghosts (slice 3c): faint, clickable outlines of the active
              boolean's operands. fill="transparent" + pointerEvents:'all' makes the whole area
              select; stopPropagation prevents the canvas-background deselect. */}
          {operandGhosts.map((g) => (
            <path
              key={`operand-ghost-${g.id}`}
              data-testid={`operand-ghost-${g.id}`}
              data-operand-of={g.boolId}
              d={g.d}
              fillRule="evenodd"
              fill="transparent"
              stroke="var(--color-accent)"
              strokeOpacity={0.5}
              strokeWidth={1 / zoom}
              strokeDasharray={`${4 / zoom} ${3 / zoom}`}
              style={{ pointerEvents: 'all', cursor: 'pointer' }}
              onPointerDown={(e) => {
                e.stopPropagation();
                useEditor.getState().selectObject(g.id);
              }}
            />
          ))}
          {selectedVector && (
            <g ref={handleGroupRef} transform={selectedVector.transform} data-testid="resize-handles">
              {HANDLE_IDS.map((id) => {
                const pos = handleLocalPositions(selectedVector.width, selectedVector.height)[id];
                const size = HANDLE_SIZE / zoom;
                return (
                  <rect
                    key={id}
                    data-testid={`handle-${id}`}
                    x={pos.x - size / 2}
                    y={pos.y - size / 2}
                    width={size}
                    height={size}
                    fill="var(--color-accent)"
                    stroke="var(--color-panel)"
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => onHandlePointerDown(id, e)}
                  />
                );
              })}
            </g>
          )}
          {selectedScalable && (
            <g ref={scaleGroupRef} transform={selectedScalable.transform} data-testid="scale-handles">
              {SCALE_HANDLE_IDS.map((id) => {
                const pos = scaleHandleLocalPositions(selectedScalable.bbox)[id];
                const size = HANDLE_SIZE / zoom;
                return (
                  <rect
                    key={id}
                    data-testid={`scale-handle-${id}`}
                    x={pos.x - size / 2}
                    y={pos.y - size / 2}
                    width={size}
                    height={size}
                    fill="var(--color-accent)"
                    stroke="var(--color-panel)"
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => onScaleHandlePointerDown(id, e)}
                  />
                );
              })}
            </g>
          )}
          {selectedGradient && (
            <g
              ref={gradientHandleGroupRef}
              transform={selectedGradient.transform}
              data-testid="gradient-handles"
            >
              {(() => {
                const liveGradient = gradientDrag?.gradient ?? selectedGradient.gradient;
                const handles = gradientHandlePositions(liveGradient, selectedGradient.bbox);
                const size = HANDLE_SIZE / zoom;
                const byId = Object.fromEntries(handles.map((h) => [h.id, h] as const));
                const lines =
                  liveGradient.type === 'linear'
                    ? ([['start', 'end']] as const)
                    : ([['center', 'radius'], ['center', 'focal']] as const);
                return (
                  <>
                    {lines.map(([a, b]) =>
                      byId[a] && byId[b] ? (
                        <line
                          key={`${a}-${b}`}
                          x1={byId[a].x}
                          y1={byId[a].y}
                          x2={byId[b].x}
                          y2={byId[b].y}
                          stroke="var(--color-accent)"
                          strokeWidth={1 / zoom}
                          pointerEvents="none"
                        />
                      ) : null,
                    )}
                    {handles.map((h) => (
                      <circle
                        key={h.id}
                        data-testid={`gradient-handle-${h.id}`}
                        cx={h.x}
                        cy={h.y}
                        r={size / 2}
                        fill="var(--color-panel)"
                        stroke="var(--color-accent)"
                        strokeWidth={1 / zoom}
                        style={{ cursor: 'pointer' }}
                        onPointerDown={(e) => onGradientHandlePointerDown(h.id, e)}
                      />
                    ))}
                  </>
                );
              })()}
            </g>
          )}
          {selectedRotatable && (
            <g
              ref={rotateHandleGroupRef}
              transform={selectedRotatable.transform}
              data-testid="rotate-handle-overlay"
            >
              {(() => {
                const { base, handle } = rotateHandleLocal(selectedRotatable.bbox, ROTATE_STALK / zoom);
                const size = HANDLE_SIZE / zoom;
                return (
                  <>
                    <line
                      x1={base.x}
                      y1={base.y}
                      x2={handle.x}
                      y2={handle.y}
                      stroke="var(--color-accent)"
                      strokeWidth={1 / zoom}
                      pointerEvents="none"
                    />
                    <circle
                      data-testid="rotate-handle"
                      cx={handle.x}
                      cy={handle.y}
                      r={size / 2}
                      fill="var(--color-panel)"
                      stroke="var(--color-accent)"
                      strokeWidth={1 / zoom}
                      style={{ cursor: 'pointer' }}
                      onPointerDown={onRotateHandlePointerDown}
                    />
                  </>
                );
              })()}
            </g>
          )}
          {pathTools.draft && pathTools.draft.nodes.length > 0 && (
            <g data-testid="pen-draft" pointerEvents="none">
              <path
                d={pathToD({ nodes: pathTools.draft.nodes, closed: false })}
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth={1 / zoom}
              />
              {pathTools.draft.cursor && (
                <line
                  x1={pathTools.draft.nodes[pathTools.draft.nodes.length - 1].anchor.x}
                  y1={pathTools.draft.nodes[pathTools.draft.nodes.length - 1].anchor.y}
                  x2={pathTools.draft.cursor.x}
                  y2={pathTools.draft.cursor.y}
                  stroke="var(--color-accent)"
                  strokeWidth={1 / zoom}
                  strokeDasharray="4 2"
                />
              )}
              {pathTools.draft.nodes.map((n, i) => (
                <circle
                  key={i}
                  cx={n.anchor.x}
                  cy={n.anchor.y}
                  r={(i === 0 ? 5 : 3) / zoom}
                  fill={i === 0 ? 'var(--color-panel)' : 'var(--color-accent)'}
                  stroke="var(--color-accent)"
                  strokeWidth={1 / zoom}
                />
              ))}
            </g>
          )}
          {(() => {
            const sel = project.objects.find((o) => o.id === selectedId);
            if (!sel?.motionPath || sel.hidden || isLockedInTree(sel, lockById)) return null;
            // The guide lives in stage coordinates (same space as object base.x/y),
            // so it renders directly in this content group with NO per-object transform.
            // Editor-only chrome — never part of the exported document.
            const followed = sampleObject(sel, time);
            return (
              <g data-testid="motion-guide" pointerEvents="none">
                <path
                  d={pathToD(sel.motionPath.path)}
                  fill="none"
                  stroke="var(--color-progress)"
                  strokeWidth={1.5 / zoom}
                  strokeDasharray={`${4 / zoom} ${3 / zoom}`}
                />
                <circle
                  data-testid="motion-marker"
                  cx={followed.x}
                  cy={followed.y}
                  r={4 / zoom}
                  fill="var(--color-progress)"
                />
              </g>
            );
          })()}
          {selectedPath && (
            <g ref={overlayGroupRef} transform={selectedPath.transform} data-testid="node-overlay">
              {selectedPath.rings.map((ring, r) =>
                ring.nodes.map((n, i) => (
                  <g key={`${r}-${i}`}>
                    {n.in && (
                      <>
                        <line
                          x1={n.anchor.x}
                          y1={n.anchor.y}
                          x2={n.anchor.x + n.in.x}
                          y2={n.anchor.y + n.in.y}
                          stroke="var(--color-accent)"
                          strokeWidth={1 / zoom}
                        />
                        <circle cx={n.anchor.x + n.in.x} cy={n.anchor.y + n.in.y} r={3 / zoom} fill="var(--color-accent)" />
                      </>
                    )}
                    {n.out && (
                      <>
                        <line
                          x1={n.anchor.x}
                          y1={n.anchor.y}
                          x2={n.anchor.x + n.out.x}
                          y2={n.anchor.y + n.out.y}
                          stroke="var(--color-accent)"
                          strokeWidth={1 / zoom}
                        />
                        <circle cx={n.anchor.x + n.out.x} cy={n.anchor.y + n.out.y} r={3 / zoom} fill="var(--color-accent)" />
                      </>
                    )}
                    <rect
                      data-testid={r === 0 ? `node-${i}` : `node-${r}-${i}`}
                      x={n.anchor.x - (4 / zoom)}
                      y={n.anchor.y - (4 / zoom)}
                      width={8 / zoom}
                      height={8 / zoom}
                      fill={r === selectedNodeRing && i === selectedNodeIndex ? 'var(--color-accent)' : 'var(--color-panel)'}
                      stroke="var(--color-accent)"
                      strokeWidth={1 / zoom}
                    />
                    {/* per-node easing markers are a primary-path morph construct (ring 0 only) */}
                    {r === 0 && editedNodeEasings?.[i] != null && (
                      <circle
                        data-testid={`node-easing-marker-${i}`}
                        cx={n.anchor.x}
                        cy={n.anchor.y}
                        r={7 / zoom}
                        fill="none"
                        stroke="var(--color-accent)"
                        strokeWidth={1 / zoom}
                        pointerEvents="none"
                      />
                    )}
                  </g>
                )),
              )}
            </g>
          )}
          {corrOverlay && (
            <g transform={corrOverlay.transform} data-testid="correspondence-overlay">
              {/* ghost B nodes (drop targets) */}
              {corrOverlay.to.nodes.map((n, j) => (
                <circle
                  key={`b-${j}`}
                  data-testid={`corr-b-${j}`}
                  cx={n.anchor.x}
                  cy={n.anchor.y}
                  r={4 / zoom}
                  fill="none"
                  stroke="var(--color-text-dim)"
                  strokeWidth={1 / zoom}
                  pointerEvents="all"
                  onPointerUp={(e) => {
                    e.stopPropagation(); // don't let the link drop also pan/select the stage
                    const ai = corrDragRef.current;
                    corrDragRef.current = null;
                    if (ai !== null) useEditor.getState().setCorrespondenceLink(ai, j);
                  }}
                />
              ))}
              {/* grow-from-point markers (dashed) for unreferenced B nodes */}
              {corrOverlay.grow.map((j) => (
                <circle
                  key={`grow-${j}`}
                  data-testid={`grow-target-${j}`}
                  cx={corrOverlay!.to.nodes[j].anchor.x}
                  cy={corrOverlay!.to.nodes[j].anchor.y}
                  r={6 / zoom}
                  fill="none"
                  stroke="var(--color-text-dim)"
                  strokeWidth={1 / zoom}
                  strokeDasharray={`${2 / zoom} ${2 / zoom}`}
                  pointerEvents="none"
                />
              ))}
              {/* links */}
              {corrOverlay.links.map((s) => (
                <line
                  key={`link-${s.ai}`}
                  data-testid={`corr-link-${s.ai}`}
                  x1={s.ax}
                  y1={s.ay}
                  x2={s.bx}
                  y2={s.by}
                  stroke={corrOverlay!.crossing ? 'var(--color-danger)' : 'var(--color-accent)'}
                  strokeWidth={1.5 / zoom}
                  pointerEvents="none"
                />
              ))}
              {/* draggable A handles (start a link drag) */}
              {corrOverlay.from.nodes.map((n, i) => (
                <rect
                  key={`a-${i}`}
                  data-testid={`corr-a-${i}`}
                  x={n.anchor.x - 4 / zoom}
                  y={n.anchor.y - 4 / zoom}
                  width={8 / zoom}
                  height={8 / zoom}
                  fill="var(--color-accent)"
                  style={{ cursor: 'grab' }}
                  onPointerDown={(e) => {
                    e.stopPropagation(); // start a link drag without triggering stage drag/select
                    corrDragRef.current = i;
                  }}
                />
              ))}
            </g>
          )}
          {/* Multi-select outlines (slice 36): a thin dashed box per selected object.
              Handles (single-object) draw above; this just makes the set visible. */}
          {selectedIds.map((sid) => {
            const o = project.objects.find((x) => x.id === sid);
            const a = o && !o.hidden ? entityAABB(o, project.objects, project.assets, time) : null;
            // Only objects that actually move follow the drag offset; a locked member
            // (excluded from the multi-drag — incl. via a locked parent group) keeps its outline put (slice 37 review).
            const off = dragOffset && o && !isLockedInTree(o, lockById) ? dragOffset : null;
            return a ? (
              <rect
                key={`sel-${sid}`}
                data-testid={`selection-outline-${sid}`}
                x={a.minX + (off?.dx ?? 0)}
                y={a.minY + (off?.dy ?? 0)}
                width={a.maxX - a.minX}
                height={a.maxY - a.minY}
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth={1 / zoom}
                strokeDasharray={`${3 / zoom} ${3 / zoom}`}
                pointerEvents="none"
              />
            ) : null;
          })}
          {/* Group scale handles for a multi-selection (slice 40). */}
          {groupBounds && (
            <g data-testid="group-handles">
              <rect
                x={groupBounds.minX}
                y={groupBounds.minY}
                width={groupBounds.maxX - groupBounds.minX}
                height={groupBounds.maxY - groupBounds.minY}
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth={1 / zoom}
                pointerEvents="none"
              />
              {HANDLE_IDS.map((hid) => {
                const p = handleLocalPositions(groupBounds.maxX - groupBounds.minX, groupBounds.maxY - groupBounds.minY)[hid];
                return (
                  <rect
                    key={hid}
                    data-testid={`group-handle-${hid}`}
                    x={groupBounds.minX + p.x - 4 / zoom}
                    y={groupBounds.minY + p.y - 4 / zoom}
                    width={8 / zoom}
                    height={8 / zoom}
                    fill="var(--color-accent)"
                    onPointerDown={(e) => onGroupHandlePointerDown(hid, e)}
                  />
                );
              })}
              {/* Rotate handle: a stalk + circle above the group bbox top-centre (slice 41). */}
              <line
                x1={(groupBounds.minX + groupBounds.maxX) / 2}
                y1={groupBounds.minY}
                x2={(groupBounds.minX + groupBounds.maxX) / 2}
                y2={groupBounds.minY - ROTATE_STALK / zoom}
                stroke="var(--color-accent)"
                strokeWidth={1 / zoom}
                pointerEvents="none"
              />
              <circle
                data-testid="group-rotate-handle"
                cx={(groupBounds.minX + groupBounds.maxX) / 2}
                cy={groupBounds.minY - ROTATE_STALK / zoom}
                r={5 / zoom}
                fill="var(--color-accent)"
                onPointerDown={onGroupRotatePointerDown}
              />
            </g>
          )}
          {/* Marquee (rubber-band) selection rect (slice 38). */}
          {marquee && (
            <rect
              data-testid="marquee"
              x={marquee.minX}
              y={marquee.minY}
              width={marquee.maxX - marquee.minX}
              height={marquee.maxY - marquee.minY}
              fill="var(--color-accent)"
              fillOpacity={0.08}
              stroke="var(--color-accent)"
              strokeWidth={1 / zoom}
              strokeDasharray={`${3 / zoom} ${3 / zoom}`}
              pointerEvents="none"
            />
          )}
          {/* Alignment guides for the active move-drag snap (slice 33). */}
          {snapGuides.x !== null && (
            <line
              data-testid="snap-guide-x"
              x1={snapGuides.x}
              y1={-100000}
              x2={snapGuides.x}
              y2={100000}
              stroke="var(--color-accent)"
              strokeWidth={1 / zoom}
              pointerEvents="none"
            />
          )}
          {snapGuides.y !== null && (
            <line
              data-testid="snap-guide-y"
              x1={-100000}
              y1={snapGuides.y}
              x2={100000}
              y2={snapGuides.y}
              stroke="var(--color-accent)"
              strokeWidth={1 / zoom}
              pointerEvents="none"
            />
          )}
          {spacingGuides.map((g, i) => {
            const mx = (g.x1 + g.x2) / 2;
            const my = (g.y1 + g.y2) / 2;
            const tick = 4 / zoom; // perpendicular end caps
            return (
              <g key={`sp-${i}`} data-testid="spacing-guide" pointerEvents="none">
                <line x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke="var(--color-accent)" strokeWidth={1 / zoom} />
                {g.orientation === 'h' ? (
                  <>
                    <line x1={g.x1} y1={g.y1 - tick} x2={g.x1} y2={g.y1 + tick} stroke="var(--color-accent)" strokeWidth={1 / zoom} />
                    <line x1={g.x2} y1={g.y2 - tick} x2={g.x2} y2={g.y2 + tick} stroke="var(--color-accent)" strokeWidth={1 / zoom} />
                  </>
                ) : (
                  <>
                    <line x1={g.x1 - tick} y1={g.y1} x2={g.x1 + tick} y2={g.y1} stroke="var(--color-accent)" strokeWidth={1 / zoom} />
                    <line x1={g.x2 - tick} y1={g.y2} x2={g.x2 + tick} y2={g.y2} stroke="var(--color-accent)" strokeWidth={1 / zoom} />
                  </>
                )}
                <text
                  x={mx + (g.orientation === 'v' ? 6 / zoom : 0)}
                  y={my - (g.orientation === 'h' ? 4 / zoom : 0)}
                  fontSize={11 / zoom}
                  fill="var(--color-accent)"
                  stroke="var(--color-panel)"
                  strokeWidth={3 / zoom}
                  paintOrder="stroke"
                  textAnchor="middle"
                  style={{ userSelect: 'none' }}
                >
                  {Math.round(g.gap)}
                </text>
              </g>
            );
          })}
          {rotateHud && (
            <text
              data-testid="rotate-readout"
              data-snapped={rotateHud.snapped ? 'true' : 'false'}
              x={rotateHud.x + 16 / zoom}
              y={rotateHud.y - 16 / zoom}
              fontSize={12 / zoom}
              fontWeight={rotateHud.snapped ? 700 : 400}
              fill="var(--color-accent)"
              stroke="var(--color-panel)"
              strokeWidth={3 / zoom}
              paintOrder="stroke"
              style={{ userSelect: 'none' }}
              pointerEvents="none"
            >
              {rotateHud.label}
            </text>
          )}
        </g>
      </svg>
    </div>
  );
}
