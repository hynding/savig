// Per-character text animation (spec 2026-11-16-text-animator), agent surface. Root scene, fail loud.
import { isTextAnimator, TEXT_ANIMATOR_PRESETS } from '@savig/engine';
import type { Project, TextAnimator } from '@savig/engine';

export type TextAnimationInput = Partial<TextAnimator> & { preset?: string };

/** Set (or with null remove) the text animator of text object `id`. `preset` starts from a
 *  ready-made animator (typewriter, fadeUp, dropIn, wordsUp, scatter, fadeOut); the other fields
 *  override it (`from` merges). Without a preset the fields merge into the current animator. */
export function setTextAnimation(project: Project, id: string, input: TextAnimationInput | null): Project {
  const obj = project.objects.find((o) => o.id === id);
  if (!obj) throw new Error(`savig/core: no object "${id}"`);
  const asset = project.assets.find((a) => a.id === obj.assetId);
  if (obj.isGroup || asset?.kind !== 'text') throw new Error(`savig/core: object "${id}" is not a text object`);
  if (input === null) {
    const rest = { ...obj };
    delete rest.textAnimator;
    return { ...project, objects: project.objects.map((o) => (o.id === id ? rest : o)) };
  }
  const { preset, ...fields } = input;
  let base: Partial<TextAnimator> = obj.textAnimator ?? {};
  if (preset !== undefined) {
    const p = TEXT_ANIMATOR_PRESETS[preset];
    if (!p) throw new Error(`savig/core: unknown text animation preset ${JSON.stringify(preset)} (use ${Object.keys(TEXT_ANIMATOR_PRESETS).join(', ')})`);
    base = { start: obj.textAnimator?.start ?? 0, ...structuredClone(p.animator) };
  }
  const next = { start: 0, by: 'char', stagger: 0.05, duration: 0.3, ...base, ...fields, from: { ...(base.from ?? {}), ...(fields.from ?? {}) } };
  for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] === undefined) delete next[k];
  if (!isTextAnimator(next)) {
    throw new Error('savig/core: text animation needs by "char"|"word", finite start, stagger >= 0, duration >= 0, a known easing/order/direction and numeric from fields');
  }
  return { ...project, objects: project.objects.map((o) => (o.id === id ? { ...o, textAnimator: next } : o)) };
}
