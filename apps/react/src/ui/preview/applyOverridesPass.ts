// M9 interactivity: the editor-side DOM post-pass for runtime object overrides (spec §5's
// "apply seam"). Runs immediately after the normal imperative frame paint (applyFrameToNodes),
// so every mapped renderId is written from scratch each frame — a flipped override can never
// leave a stale attribute behind, and re-running after a fresh frame write never double-prepends
// the translate (the frame paint always rewrites `transform` before this pass runs again).
import type { ObjectOverride } from '@savig/engine';

export function applyOverridesPass(nodes: Map<string, SVGGraphicsElement>, expanded: Map<string, ObjectOverride>): void {
  for (const [renderId, o] of expanded) {
    const node = nodes.get(renderId);
    if (!node) continue;
    if (o.hidden !== undefined) node.setAttribute('display', o.hidden ? 'none' : '');
    if (o.opacity !== undefined) node.setAttribute('opacity', String(o.opacity));
    if (o.dx !== undefined || o.dy !== undefined) {
      node.setAttribute('transform', `translate(${o.dx ?? 0} ${o.dy ?? 0}) ${node.getAttribute('transform') ?? ''}`);
    }
    if (o.text !== undefined) {
      // Both the editor Stage and the export markup (renderDocument.ts) register the LEAF
      // WRAPPER — a <g data-savig-object> — whose child is the actual <text> element, never the
      // <text> itself (verified against Stage.tsx's text-leaf branch and the export's `<g
      // data-savig-object=...>${t}</g>` text case). A bare `node.tagName === 'text'` check would
      // therefore never match in practice; accept the node itself when it IS a <text> (defensive)
      // or its descendant, so `setText` actually reaches the rendered glyph either way.
      const textEl = node.tagName.toLowerCase() === 'text' ? node : node.querySelector('text');
      if (textEl) textEl.textContent = o.text;
    }
  }
}
