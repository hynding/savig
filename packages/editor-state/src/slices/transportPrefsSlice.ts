// Transport (play/seek/step), view & tool preferences, and toasts. These actions are
// self-contained: they read/write transient view state and never mutate the document
// except seek's duration clamp. Extracted verbatim from store.ts (no behavior change).
import { snapToFrame, newId } from '@savig/engine';
import { SYMBOL_EDIT_TOOLS, TIMELINE_ZOOM_MAX, TIMELINE_ZOOM_MIN, TIMELINE_ZOOM_STEPS, type SliceCreator } from '../store-internals';
import { selectEditDuration } from '../selectors';

type TransportPrefsKeys =
  | 'seek' | 'setPlaying' | 'toggleAutoKey' | 'toggleSnap' | 'setSnapEnabled'
  | 'toggleGrid' | 'setGridSize' | 'toggleFrame' | 'toggleGraphEditor' | 'toggleHistoryPanel' | 'setTimelineZoom' | 'stepTimelineZoom' | 'toggleOnionSkin' | 'stepFrame' | 'setTheme'
  | 'setZoom' | 'setPan' | 'setActiveTool' | 'setPolygonSides' | 'setStarPoints'
  | 'setStarInnerRatio' | 'setPrimitiveCornerRadius' | 'setBrushSize' | 'setBrushSmoothing'
  | 'setBrushTaperIn' | 'setBrushTaperOut' | 'setBrushUsePressure' | 'setBucketColor' | 'setEraserSize' | 'setLassoMode'
  | 'setPenDrafting' | 'requestCancelPen' | 'pushToast' | 'dismissToast';

export const createTransportPrefsSlice: SliceCreator<TransportPrefsKeys> = (set, get) => ({
  seek(time, opts) {
    const duration = selectEditDuration(get());
    const clamped = Math.min(Math.max(0, time), duration > 0 && !opts?.pastEnd ? duration : Number.MAX_VALUE);
    set({ time: clamped });
  },
  setPlaying(playing) {
    set({ playing });
  },
  toggleAutoKey() {
    set({ autoKey: !get().autoKey });
  },
  toggleSnap() {
    set({ snapEnabled: !get().snapEnabled });
  },
  setSnapEnabled(b) {
    set({ snapEnabled: b });
  },
  toggleGrid() {
    set({ gridEnabled: !get().gridEnabled });
  },
  setGridSize(n) {
    set({ gridSize: Math.max(1, Math.round(n)) }); // ≥1px, integer lattice
  },
  toggleFrame() {
    set({ frameEnabled: !get().frameEnabled });
  },
  toggleGraphEditor() {
    set({ graphEditorOpen: !get().graphEditorOpen });
  },
  toggleHistoryPanel() {
    set({ historyPanelOpen: !get().historyPanelOpen });
  },
  setTimelineZoom(zoom) {
    if (!Number.isFinite(zoom)) return;
    set({ timelineZoom: Math.min(TIMELINE_ZOOM_MAX, Math.max(TIMELINE_ZOOM_MIN, zoom)) });
  },
  stepTimelineZoom(direction) {
    // Next ladder rung strictly past the current zoom (a wheel-zoomed value between rungs snaps
    // to the neighbouring rung in that direction); stays put at either end.
    const z = get().timelineZoom;
    const next = direction > 0 ? TIMELINE_ZOOM_STEPS.find((v) => v > z + 1e-9) : [...TIMELINE_ZOOM_STEPS].reverse().find((v) => v < z - 1e-9);
    if (next !== undefined) set({ timelineZoom: next });
  },
  toggleOnionSkin() {
    set({ onionSkin: !get().onionSkin });
  },
  stepFrame(direction) {
    const project = get().history.present;
    const frame = 1 / project.meta.fps;
    get().seek(snapToFrame(get().time + direction * frame, project.meta.fps));
  },
  setTheme(theme) {
    set({ theme });
  },
  setZoom(zoom) {
    set({ zoom: Math.min(8, Math.max(0.1, zoom)) });
  },
  setPan(pan) {
    set({ pan });
  },
  setActiveTool(tool) {
    if (get().editPath.length > 0 && !SYMBOL_EDIT_TOOLS.has(tool)) return; // edit mode: select/create tools + node ok; motion gated (deferred)
    // The correspondence overlay only renders in the node tool; leaving the node tool
    // hides it, so clear the edit flag too (keeps the "Edit links" toggle consistent).
    set(tool === 'node' ? { activeTool: tool } : { activeTool: tool, correspondenceEditing: false });
    // The camera tool looks through the camera: object selection (and its handles) steps aside.
    if (tool === 'camera') get().selectObjects([]);
  },
  setPolygonSides(n) {
    set({ polygonSides: Math.max(3, Math.floor(n)) });
  },
  setStarPoints(n) {
    set({ starPoints: Math.max(2, Math.floor(n)) });
  },
  setStarInnerRatio(r) {
    set({ starInnerRatio: Math.min(0.99, Math.max(0.01, r)) });
  },
  setPrimitiveCornerRadius(n) {
    set({ primitiveCornerRadius: Math.max(0, Number.isFinite(n) ? n : 0) });
  },
  setBrushSize(n) {
    set({ brushSize: Math.max(1, n) });
  },
  setBrushSmoothing(r) {
    set({ brushSmoothing: Math.min(1, Math.max(0, r)) });
  },
  setBrushTaperIn(n) {
    set({ brushTaperIn: Math.min(0.5, Math.max(0, n)) });
  },
  setBrushTaperOut(n) {
    set({ brushTaperOut: Math.min(0.5, Math.max(0, n)) });
  },
  setBucketColor(color) {
    // Stored as #rrggbb (what a colour input shows); #rgb is expanded.
    if (/^#[0-9a-fA-F]{6}$/.test(color)) set({ bucketColor: color.toLowerCase() });
    else if (/^#[0-9a-fA-F]{3}$/.test(color)) set({ bucketColor: `#${[...color.slice(1)].map((c) => c + c).join('')}`.toLowerCase() });
  },
  setEraserSize(size) {
    if (Number.isFinite(size)) set({ eraserSize: Math.min(500, Math.max(1, size)) });
  },
  setLassoMode(mode) {
    if (mode === 'freehand' || mode === 'polygon') set({ lassoMode: mode });
  },
  setBrushUsePressure(b) {
    set({ brushUsePressure: b });
  },
  setPenDrafting(drafting) {
    set({ penDrafting: drafting });
  },
  requestCancelPen() {
    set({ cancelPenRequested: get().cancelPenRequested + 1 });
  },
  pushToast(kind, message) {
    set({ toasts: [{ id: newId(), kind, message }, ...get().toasts] });
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
});
