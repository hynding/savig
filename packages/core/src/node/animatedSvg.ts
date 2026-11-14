/** Node-safe animated-SVG export: the shared emitter needs DOMParser/XMLSerializer, which bare
 *  Node lacks — inject jsdom's (same dependency renderFrameSvg already uses). A fresh JSDOM per
 *  call keeps this deterministic and side-effect-free (no global mutation). */
import { JSDOM } from 'jsdom';
import type { Project } from '@savig/engine';
import { renderAnimatedSvgDocument } from '@savig/services/export/animatedSvg';
import { renderCssSvgDocument } from '@savig/services/export/cssSvg';

export function renderAnimatedSvgNode(project: Project): string {
  const { window } = new JSDOM('');
  return renderAnimatedSvgDocument(project, {
    DOMParser: window.DOMParser as unknown as typeof DOMParser,
    XMLSerializer: window.XMLSerializer as unknown as typeof XMLSerializer,
  });
}

/** Node-safe CSS-only animated SVG (spec 2026-11-14-css-export): same jsdom injection. */
export function renderCssSvgNode(project: Project): string {
  const { window } = new JSDOM('');
  return renderCssSvgDocument(project, {
    DOMParser: window.DOMParser as unknown as typeof DOMParser,
    XMLSerializer: window.XMLSerializer as unknown as typeof XMLSerializer,
  });
}
