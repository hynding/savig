import type { LocalRect } from '@savig/engine';

/** Everything that affects glyph metrics for a text asset (mirrors the Stage's `<text>`
 *  attributes: x=0 y=0, dominant-baseline text-before-edge, plus these). */
export interface TextMeasureInput {
  content: string;
  fontSize: number;
  fontFamily?: string;
  textAnchor?: 'start' | 'middle' | 'end';
}

/** Returns the text's local-space bbox, or null when real measurement is unavailable (no DOM,
 *  jsdom without getBBox, …) — callers then fall back to `estimateTextBox`. */
export type TextMeasurer = (t: TextMeasureInput) => LocalRect | null;

// Module-ref registry (the `stageCursor` precedent): the neutral interaction package cannot
// touch the DOM, so the app layer registers a real glyph measurer at bootstrap and the text
// branch of `resolveObjectAnchor` consults it. Unregistered ⇒ byte-identical legacy estimate.
let measurer: TextMeasurer | null = null;

export function setTextMeasurer(m: TextMeasurer | null): void {
  measurer = m;
}

export function getTextMeasurer(): TextMeasurer | null {
  return measurer;
}
