/** Headless 9-slice scaling (roadmap 13): give a symbol a scale-9 grid so its scaled instances
 *  keep their corners. Pure, id-addressed; the grid is measured in the symbol's content box,
 *  found from its drawn outlines at t=0 (the same measure createButton uses). */
import { defaultScale9, normalizeScale9, operandWorldRings, pathBounds } from '@savig/engine';
import type { Project, Scale9Grid, SymbolAsset } from '@savig/engine';

/** The drawn box of a symbol's content at t=0, or its [0,width] x [0,height] box when it draws nothing. */
export function symbolContentBox(project: Project, symbol: SymbolAsset): { x: number; y: number; width: number; height: number } {
  const view: Project = { ...project, objects: symbol.objects, scenes: undefined };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const o of symbol.objects) {
    if (o.parentId || o.isGroup) continue; // rings come from drawn leaves
    for (const ring of operandWorldRings(view, o, 0)) {
      const b = pathBounds(ring);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    }
  }
  return minX <= maxX ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : { x: 0, y: 0, width: symbol.width, height: symbol.height };
}

/** Set symbol `symbolId`'s 9-slice grid: insets from its content box edges (missing ones keep
 *  their current value, or a quarter of the shorter side), `true` for the default grid, or null
 *  to turn it off. Insets are clamped so a middle cell remains. */
export function setSymbolScale9(project: Project, symbolId: string, grid: Partial<Pick<Scale9Grid, 'left' | 'top' | 'right' | 'bottom'>> | true | null): Project {
  const sym = project.assets.find((a) => a.id === symbolId);
  if (!sym || sym.kind !== 'symbol') throw new Error(`savig/core: no symbol with id "${symbolId}"`);
  let next: SymbolAsset;
  if (grid === null) {
    next = { ...sym };
    delete next.scale9;
  } else {
    const box = symbolContentBox(project, sym);
    const base = sym.scale9 ?? defaultScale9(box);
    const g = normalizeScale9({ ...base, ...(grid === true ? {} : grid), ...box }, box.width, box.height);
    if (!g) throw new Error(`savig/core: symbol "${symbolId}" is too small for 9-slice scaling`);
    next = { ...sym, scale9: g };
  }
  return { ...project, assets: project.assets.map((a) => (a.id === symbolId ? next : a)) };
}
