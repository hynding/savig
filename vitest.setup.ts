import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// jsdom (used for apps/react/src/**) does not implement PointerEvent, so fireEvent's
// pointer events would carry no clientX/clientY. Polyfill it as a thin subclass
// of MouseEvent (which supplies the coordinate fields), plus `pressure` (MouseEvent has
// no such field, so it would silently drop it — needed for the tapered-brush pressure
// threading tests). Guarded so it is a no-op in the node test environment, where
// MouseEvent is undefined.
if (typeof PointerEvent === 'undefined' && typeof MouseEvent !== 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pressure: number;
    constructor(type: string, eventInitDict?: MouseEventInit & { pressure?: number }) {
      super(type, eventInitDict);
      this.pressure = eventInitDict?.pressure ?? 0;
    }
  }
  (globalThis as { PointerEvent?: unknown }).PointerEvent = PointerEventPolyfill;
}
