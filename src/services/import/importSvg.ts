import type { SvgAsset } from '../../engine';
import { SvgImportError } from '../errors';
import { hashContent } from '../hash';
import { namespaceIds } from './namespaceIds';
import { sanitizeSvgElement } from './sanitizeSvg';

export interface SvgImportResult {
  asset: SvgAsset;
  warnings: string[];
}

export function importSvg(source: string, name: string): SvgImportResult {
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (doc.querySelector('parsererror')) {
    throw new SvgImportError(`Could not parse "${name}" as SVG.`);
  }
  const svg = doc.documentElement;
  if (svg.tagName.toLowerCase() !== 'svg') {
    throw new SvgImportError(`"${name}" is not an SVG document.`);
  }

  const id = hashContent(source);
  const warnings = sanitizeSvgElement(svg);
  namespaceIds(svg, id);

  const { viewBox, width, height } = resolveDimensions(svg);
  svg.setAttribute('viewBox', viewBox);

  const normalizedContent = new XMLSerializer().serializeToString(svg);

  return {
    asset: { id, kind: 'svg', name, normalizedContent, viewBox, width, height },
    warnings,
  };
}

function resolveDimensions(svg: Element): { viewBox: string; width: number; height: number } {
  const vb = svg.getAttribute('viewBox');
  const widthAttr = parseFloat(svg.getAttribute('width') ?? '');
  const heightAttr = parseFloat(svg.getAttribute('height') ?? '');

  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      const width = Number.isFinite(widthAttr) ? widthAttr : parts[2];
      const height = Number.isFinite(heightAttr) ? heightAttr : parts[3];
      return { viewBox: vb.trim(), width, height };
    }
  }

  const width = Number.isFinite(widthAttr) && widthAttr > 0 ? widthAttr : 100;
  const height = Number.isFinite(heightAttr) && heightAttr > 0 ? heightAttr : 100;
  return { viewBox: `0 0 ${width} ${height}`, width, height };
}
