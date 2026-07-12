import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { Resvg } from '@resvg/resvg-js';
import { createProject, createVectorAsset, createSceneObject } from '@savig/engine';
import type { PathData } from '@savig/engine';
import { addRect, addPath, addText, setKeyframe } from '../build';
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

// resvg <textPath> support probe (text-on-path task 1). This is a smoke test against RAW SVG
// markup (not the project pipeline — Tasks 2-4 wire resolveTextPath into renderDocument/
// frame.ts/Stage; this only answers "does our resvg binding rasterize <textPath> at all, and
// do the glyphs visibly move off the plain-text position". The verdict is recorded in the
// Task 1 report.
describe('resvg <textPath> support probe (text-on-path task 1)', () => {
  function doc(withPath: boolean): string {
    const textContent = withPath
      ? '<textPath href="#tp" startOffset="0">HELLO</textPath>'
      : 'HELLO';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">
      <defs><path id="tp" d="M0,50 C30,0 70,0 100,50" pathLength="1"/></defs>
      <text x="10" y="50" font-size="20" fill="#000000">${textContent}</text>
    </svg>`;
  }

  function raster(svg: string): Uint8Array {
    return new Resvg(svg, { fitTo: { mode: 'original' as const }, background: 'white' }).render().asPng();
  }

  it('rasterizes a <textPath> document without throwing, producing non-blank PNG output', () => {
    let png: Uint8Array | undefined;
    expect(() => {
      png = raster(doc(true));
    }).not.toThrow();
    expect([...png!.slice(0, 4)]).toEqual(PNG_MAGIC);
    expect(png!.length).toBeGreaterThan(100);
  });

  it('pixel content differs between <textPath>-bound text and plain text (glyph positions moved)', () => {
    const withPath = raster(doc(true));
    const plain = raster(doc(false));
    expect(bytesEqual(withPath, plain)).toBe(false);
  });
});

// Pin test (task-2 follow-up, text-on-path final review): renderFramePng of a project whose
// text object carries a REAL textPath binding (through the full renderDocument pipeline, not
// the raw-markup probe above) must rasterize cleanly at a non-zero playhead time and must
// produce different pixels than the same project with the binding removed. This pins the
// runtime's `transform=""` identity behavior for a bound `<g data-savig-object>` wrapper
// (bound text carries no transform — resolveTextPath's worldD already carries the target's
// full world transform chain) probed at the text-on-path final review.
describe('renderFramePng — bound text-on-path (task-2 follow-up pin)', () => {
  function boundTextProject(): { project: ReturnType<typeof createProject>; textId: string } {
    const path: PathData = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 150, y: 0 } }] };
    let p = createProject({ width: 200, height: 100 });
    const pathResult = addPath(p, { path, id: 'p' });
    p = pathResult.project;
    const textResult = addText(p, { content: 'Hello', x: 10, y: 30, id: 't' });
    p = textResult.project;
    // addText has no DSL builder for the textPath binding itself (dsl.ts precedent: only the
    // textPathOffset TRACK round-trips) — patch the object directly, as the brief specifies.
    p = {
      ...p,
      objects: p.objects.map((o) =>
        o.id === textResult.id ? { ...o, textPath: { pathObjectId: pathResult.id, startOffset: 0 } } : o,
      ),
    };
    return { project: p, textId: textResult.id };
  }

  it('rasterizes without throwing and differs from the same project unbound, at t > 0', () => {
    const { project: bound, textId } = boundTextProject();
    const unbound = {
      ...bound,
      objects: bound.objects.map((o) => (o.id === textId ? { ...o, textPath: undefined } : o)),
    };
    let boundPng: Uint8Array | undefined;
    expect(() => {
      boundPng = renderFramePng(bound, 0.5, { width: 200 });
    }).not.toThrow();
    expect([...boundPng!.slice(0, 4)]).toEqual(PNG_MAGIC);
    const unboundPng = renderFramePng(unbound, 0.5, { width: 200 });
    expect(bytesEqual(boundPng!, unboundPng)).toBe(false);
  });
});
