import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { createProject, createVectorAsset, createSceneObject } from '@savig/engine';
import { addRect, setKeyframe } from './build';
import { renderFrameSvg, renderFramePng, renderThumbnail, renderFrames } from './render';

const PNG_MAGIC = [137, 80, 78, 71];

const bytesEqual = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

function withFade() {
  // a rect whose opacity animates 1 -> 0 over [0, 1]s
  let p = addRect(createProject({ width: 200, height: 100 }), { x: 50, y: 25, width: 40, height: 40, id: 'r', style: { fill: '#3366ff' } }).project;
  p = setKeyframe(p, { objectId: 'r', property: 'opacity', time: 0, value: 1 });
  p = setKeyframe(p, { objectId: 'r', property: 'opacity', time: 1, value: 0 });
  return p;
}

describe('core/render renderFrameSvg', () => {
  it('produces a static <svg> with the runtime script stripped', () => {
    const svg = renderFrameSvg(withFade(), 0);
    expect(svg).toMatch(/^<svg/);
    expect(svg).not.toContain('<script');
  });

  it('bakes the frame — opacity differs between t=0 and t=1', () => {
    const p = withFade();
    const at0 = renderFrameSvg(p, 0);
    const at1 = renderFrameSvg(p, 1);
    expect(at0).not.toEqual(at1);
    // at the end of the fade the object's opacity is ~0
    expect(at1).toMatch(/opacity="0(\.0+)?"/);
  });
});

describe('core/render renderFramePng', () => {
  it('rasterizes a frame to a PNG', () => {
    const png = renderFramePng(withFade(), 0, { width: 100 });
    expect([...png.slice(0, 4)]).toEqual(PNG_MAGIC);
    expect(png.length).toBeGreaterThan(100);
  });

  it('renders different bytes at different times (the fade is visible)', () => {
    const p = withFade();
    const a = renderFramePng(p, 0, { width: 100 });
    const b = renderFramePng(p, 1, { width: 100 });
    expect(bytesEqual(a, b)).toBe(false);
  });
});

describe('core/render renderThumbnail / renderFrames', () => {
  it('renderThumbnail returns a PNG', () => {
    const png = renderThumbnail(withFade());
    expect([...png.slice(0, 4)]).toEqual(PNG_MAGIC);
  });

  it('renderFrames returns N PNGs spanning [0, duration]', () => {
    const frames = renderFrames(withFade(), { count: 5, width: 80 });
    expect(frames).toHaveLength(5);
    expect(frames[0].time).toBe(0);
    expect(frames[4].time).toBeCloseTo(1, 5); // duration is 1s (opacity track ends at 1)
    for (const f of frames) expect([...f.png.slice(0, 4)]).toEqual(PNG_MAGIC);
  });
});

describe('renderFrameSvg — multi-scene (8b-2d)', () => {
  function multi() {
    const a = createVectorAsset('rect', { id: 'aRect' });
    const b = createVectorAsset('rect', { id: 'bRect' });
    return { ...createProject(), assets: [a, b], objects: [], scenes: [
      { id: 'scA', name: 'A', objects: [createSceneObject('aRect', { id: 'oa' })], duration: 2 },
      { id: 'scB', name: 'B', objects: [createSceneObject('bRect', { id: 'ob' })], duration: 2 },
    ] };
  }
  function sceneDisplay(svgMarkup: string, sceneId: string): string {
    const doc = new JSDOM(`<!DOCTYPE html><body>${svgMarkup}</body>`).window.document;
    const g = doc.querySelector(`[data-savig-scene="${sceneId}"]`) as HTMLElement;
    return g.style.display;
  }
  it('renders the active scene visible and the inactive scene hidden at master time t', () => {
    const project = multi();
    const at1 = renderFrameSvg(project, 1);   // scene A active
    expect(sceneDisplay(at1, 'scA')).not.toBe('none');
    expect(sceneDisplay(at1, 'scB')).toBe('none');
    const at3 = renderFrameSvg(project, 3);   // scene B active
    expect(sceneDisplay(at3, 'scB')).not.toBe('none');
    expect(sceneDisplay(at3, 'scA')).toBe('none');
  });
});
