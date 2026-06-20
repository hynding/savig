import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// jsdom (used for src/ui/**) does not implement PointerEvent, so fireEvent's
// pointer events would carry no clientX/clientY. Polyfill it as a thin subclass
// of MouseEvent (which supplies the coordinate fields). Guarded so it is a
// no-op in the node test environment, where MouseEvent is undefined.
if (typeof PointerEvent === 'undefined' && typeof MouseEvent !== 'undefined') {
  class PointerEventPolyfill extends MouseEvent {}
  (globalThis as { PointerEvent?: unknown }).PointerEvent = PointerEventPolyfill;
}
