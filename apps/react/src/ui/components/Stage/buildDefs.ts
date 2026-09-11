import type { Asset, SvgAsset } from '@savig/engine';
import { defineSymbol } from '@savig/services';

// The symbol-wrapping convention is shared with services/export/renderDocument via the ONE
// `defineSymbol` in @savig/services (closing the long-standing mirrored-copy dup): the editor
// stage and the exported bundle can never drift apart again.
export function buildDefs(assets: Asset[], usedIds: string[]): string {
  const byId = new Map(assets.map((a) => [a.id, a] as const));
  return usedIds
    .map((id) => byId.get(id))
    .filter((a): a is SvgAsset => !!a && a.kind === 'svg')
    .map(defineSymbol)
    .join('');
}
