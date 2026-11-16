// Per-character text animation (spec 2026-11-16-text-animator): agent surface + every export.
import { describe, expect, it } from 'vitest';
import { computeProjectDuration, createProject } from '@savig/engine';
import { migrateProject } from '@savig/services';
import { RUNTIME_JS } from '@savig/runtime/runtimeSource.generated';
import { addRect, addText } from '../build';
import { setTextAnimation } from '../textAnimator';
import { compileShort, decompileProject } from '../dsl';
import { describeProject } from '../describe';
import { validateProject } from '../validate';
import { renderFrameSvg } from './render';
import { renderAnimatedSvgNode, renderCssSvgNode } from './animatedSvg';

function titled(preset = 'fadeUp') {
  const p = addText(createProject({ width: 300, height: 100, fps: 10 }), { content: 'Hello', x: 10, y: 10, id: 't' }).project;
  return setTextAnimation(p, 't', { preset, start: 0.2 });
}

describe('setTextAnimation', () => {
  it('applies a preset with overrides, merges later fields, and removes', () => {
    let p = titled();
    expect(p.objects[0].textAnimator).toMatchObject({ by: 'char', start: 0.2, stagger: 0.04, duration: 0.4, from: { opacity: 0, dy: 20 } });
    p = setTextAnimation(p, 't', { order: 'reverse', from: { rotation: 10 } });
    expect(p.objects[0].textAnimator).toMatchObject({ order: 'reverse', from: { opacity: 0, dy: 20, rotation: 10 } });
    p = setTextAnimation(p, 't', null);
    expect('textAnimator' in p.objects[0]).toBe(false);
  });
  it('fails loud on a non-text object, an unknown preset or bad values', () => {
    const p = addRect(titled(), { x: 0, y: 0, width: 5, height: 5, id: 'r' }).project;
    expect(() => setTextAnimation(p, 'r', { preset: 'typewriter' })).toThrow(/not a text object/);
    expect(() => setTextAnimation(p, 't', { preset: 'explode' })).toThrow(/unknown text animation preset/);
    expect(() => setTextAnimation(p, 't', { stagger: -1 })).toThrow(/text animation needs/);
  });
  it('grows the automatic duration to the last letter', () => {
    // 5 letters: 0.2 + 0.04 * 4 + 0.4
    expect(computeProjectDuration(titled())).toBeCloseTo(0.76, 9);
  });
  it('round-trips through the DSL, describes, validates and survives a load', () => {
    const p = titled('scatter');
    const back = compileShort(JSON.parse(JSON.stringify(decompileProject(p))));
    expect(back.objects[0].textAnimator).toEqual(p.objects[0].textAnimator);
    expect(describeProject(p)).toMatch(/text-anim in by char @0\.2s stagger 0\.03s dur 0\.6s random/);
    expect(validateProject(p).filter((i) => i.code.startsWith('text-animator'))).toEqual([]);
    const loaded = migrateProject(JSON.parse(JSON.stringify(p)));
    expect(loaded.objects[0].textAnimator).toEqual(p.objects[0].textAnimator);
    const junk = migrateProject(JSON.parse(JSON.stringify({ ...p, objects: [{ ...p.objects[0], textAnimator: { by: 'line' } }] })));
    expect('textAnimator' in junk.objects[0]).toBe(false);
  });
});

describe('text animation in every export', () => {
  it('raster frames draw one tspan per letter and change over time', () => {
    const p = titled();
    const early = renderFrameSvg(p, 0.25);
    expect(early.match(/data-savig-unit/g)).toHaveLength(5);
    expect(early).not.toBe(renderFrameSvg(p, 0.5));
    expect(renderFrameSvg(p, 2)).toBe(renderFrameSvg(p, 3));
  });
  it('SMIL animates tspan offsets and opacity; CSS animates opacity and holds the settled pose', () => {
    const p = titled();
    const smil = renderAnimatedSvgNode(p);
    expect(smil).toMatch(/<tspan[^>]*data-savig-unit="0"[^>]*>H<animate attributeName="dy"/);
    expect(smil).toMatch(/attributeName="fill-opacity"/);
    const css = renderCssSvgNode(p);
    expect(css).toMatch(/fill-opacity/);
    expect(css).toMatch(/<tspan[^>]*data-savig-unit="0"[^>]*dy="0"/);
  });
  it('the HTML runtime bundle updates the tspans', () => {
    expect(RUNTIME_JS).toContain('data-savig-unit');
  });
});
