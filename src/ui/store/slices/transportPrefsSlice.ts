// Transport (play/seek/step), view & tool preferences, and toasts. These actions are
// self-contained: they read/write transient view state and never mutate the document
// except seek's duration clamp. Extracted verbatim from store.ts (no behavior change).
import { computeProjectDuration, snapToFrame, newId } from '../../../engine';
import { SYMBOL_EDIT_TOOLS, type SliceCreator } from '../store-internals';

type TransportPrefsKeys =
  | 'seek' | 'setPlaying' | 'toggleAutoKey' | 'toggleSnap' | 'setSnapEnabled'
  | 'toggleGrid' | 'setGridSize' | 'toggleOnionSkin' | 'stepFrame' | 'setTheme'
  | 'setZoom' | 'setPan' | 'setActiveTool' | 'setPolygonSides' | 'setStarPoints'
  | 'setStarInnerRatio' | 'setPrimitiveCornerRadius' | 'setBrushSize' | 'setBrushSmoothing'
  | 'setPenDrafting' | 'requestCancelPen' | 'pushToast' | 'dismissToast';

export const createTransportPrefsSlice: SliceCreator<TransportPrefsKeys> = (set, get) => ({
  seek(time) {
    const duration = computeProjectDuration(get().history.present);
    const clamped = Math.min(Math.max(0, time), duration > 0 ? duration : Number.MAX_VALUE);
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
