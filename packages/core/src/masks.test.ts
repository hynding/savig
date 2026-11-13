import { describe, expect, it } from 'vitest';
import { createProject } from '@savig/engine';
import type { Project } from '@savig/engine';
import { addEllipse, addRect, addText } from './build';
import { createMask, releaseMask, reveal, unmask } from './masks';
import { compileShort, decompileProject, type ShortDoc } from './dsl';
import { describeProject } from './describe';
import { validateProject } from './validate';
import { getTemplate } from './templates';
import { renderFrameRgba } from './node/render';

function scene(): Project {
  let p = createProject({ width: 100, height: 100 });
  ({ project: p } = addRect(p, { id: 't', x: 0, y: 0, width: 100, height: 100, style: { fill: '#ff0000', stroke: 'none', strokeWidth: 0 } }));
  ({ project: p } = addRect(p, { id: 'u', x: 0, y: 0, width: 10, height: 10 }));
  ({ project: p } = addRect(p, { id: 'm', x: 0, y: 0, width: 50, height: 100 }));
  return p;
}
const o = (p: Project, id: string) => p.objects.find((x) => x.id === id)!;
const px = (img: { width: number; pixels: Uint8Array }, x: number, y: number) =>
  Array.from(img.pixels.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));

describe('createMask / releaseMask / unmask', () => {
  it('links targets and releases them', () => {
    let p = createMask(scene(), 'm', ['t', 'u']);
    expect(o(p, 'm').isMask).toBe(true);
    expect([o(p, 't').maskedBy, o(p, 'u').maskedBy]).toEqual(['m', 'm']);
    expect(validateProject(p)).toEqual([]);
    p = unmask(p, ['u']);
    expect(o(p, 'u').maskedBy).toBeUndefined();
    p = releaseMask(p, 'm');
    expect(o(p, 'm').isMask).toBeUndefined();
    expect(o(p, 't').maskedBy).toBeUndefined();
  });

  it('fails loud on bad references', () => {
    expect(() => createMask(scene(), 'nope', ['t'])).toThrow(/no object/);
    expect(() => createMask(scene(), 'm', [])).toThrow(/at least one/);
    expect(() => createMask(scene(), 'm', ['m'])).toThrow(/itself/);
    expect(() => createMask(createMask(scene(), 'm', ['t']), 'u', ['m'])).toThrow(/is a mask/);
    expect(() => releaseMask(scene(), 't')).toThrow(/not a mask/);
  });
});

describe('reveal macro', () => {
  it('wipe: a rect over the targets, scaling 0→1 from the chosen side, actually reveals in the raster', () => {
    const only = { ...scene(), objects: scene().objects.filter((x) => x.id === 't') };
    const { project: p, maskId } = reveal(only, { targetIds: ['t'], from: 'left', start: 0, duration: 1 });
    const m = o(p, maskId);
    expect(m.isMask).toBe(true);
    expect([m.anchorX, m.anchorY]).toEqual([0, 0.5]);
    expect(m.tracks.scaleX!.map((k) => k.value)).toEqual([0, 1]);
    expect(o(p, 't').maskedBy).toBe(maskId);
    const mid = renderFrameRgba(p, 0.5, { width: 100 });
    expect(px(mid, 10, 50)).toEqual([255, 0, 0]); // left half revealed at the midpoint
    expect(px(mid, 90, 50)).toEqual([255, 255, 255]); // right half still hidden
    expect(px(renderFrameRgba(p, 1, { width: 100 }), 90, 50)).toEqual([255, 0, 0]);
  });

  it('wipe from top scales Y from the top edge', () => {
    const { project: p, maskId } = reveal(scene(), { targetIds: ['t'], from: 'top', id: 'w' });
    expect(maskId).toBe('w');
    expect([o(p, 'w').anchorX, o(p, 'w').anchorY]).toEqual([0.5, 0]);
    expect(o(p, 'w').tracks.scaleY).toHaveLength(2);
    expect(o(p, 'w').tracks.scaleX).toBeUndefined();
  });

  it('iris: a circle circumscribing the targets, centred, scaling both axes', () => {
    const { project: p, maskId } = reveal(scene(), { targetIds: ['u'], style: 'iris', start: 1, duration: 0.5 });
    const m = o(p, maskId);
    expect(m.shapeBase!.radiusX).toBeCloseTo(m.shapeBase!.radiusY!);
    expect(m.shapeBase!.radiusX! * 2).toBeGreaterThanOrEqual(Math.hypot(10, 10));
    expect(m.tracks.scaleX!.map((k) => k.time)).toEqual([1, 1.5]);
    expect(m.tracks.scaleY!.map((k) => k.time)).toEqual([1, 1.5]);
  });

  it('needs bounds for a target it cannot measure', () => {
    let p = createProject();
    ({ project: p } = addText(p, { id: 'txt', content: 'Hi', x: 10, y: 10 }));
    expect(() => reveal(p, { targetIds: ['txt'] })).toThrow(/bounds/);
    expect(() => reveal(p, { targetIds: ['txt'], bounds: { x: 0, y: 0, width: 50, height: 20 } })).not.toThrow();
    expect(() => reveal(p, { targetIds: [] })).toThrow();
    expect(() => reveal(p, { targetIds: ['txt'], duration: 0, bounds: { x: 0, y: 0, width: 1, height: 1 } })).toThrow(/duration/);
  });
});

describe('DSL + describe', () => {
  it('compiles mask / maskedBy (mask may come after its targets) and round-trips', () => {
    const doc: ShortDoc = {
      meta: { width: 100, height: 100 },
      objects: [
        { type: 'rect', id: 'a', x: 0, y: 0, width: 50, height: 50, maskedBy: 'm' },
        { type: 'ellipse', id: 'm', x: 0, y: 0, width: 30, height: 30, mask: true },
        { type: 'frames', id: 'L', mask: true, keys: [{ time: 0, objects: [{ type: 'rect', x: 0, y: 0, width: 5, height: 5 }] }] },
        { type: 'rect', id: 'b', x: 0, y: 0, width: 5, height: 5, maskedBy: 'L' },
      ],
    } as ShortDoc;
    const p = compileShort(doc);
    expect(o(p, 'a').maskedBy).toBe('m');
    expect(o(p, 'm').isMask).toBe(true);
    expect(o(p, 'L').isMask).toBe(true);
    expect(o(p, 'b').maskedBy).toBe('L');
    expect(validateProject(p)).toEqual([]);
    expect(compileShort(decompileProject(p))).toEqual(p);
  });

  it('a mask-free doc decompiles without mask fields (parity)', () => {
    let p = createProject();
    ({ project: p } = addEllipse(p, { id: 'e', x: 0, y: 0, width: 5, height: 5 }));
    expect(JSON.stringify(decompileProject(p))).not.toContain('mask');
  });

  it('describe names a mask’s targets and a target’s mask', () => {
    const text = describeProject(createMask(scene(), 'm', ['t']));
    expect(text).toContain('MASK (not drawn) reveals: t');
    expect(text).toContain('maskedBy=m');
  });
});

describe('wipe-and-iris-reveal template', () => {
  it('builds a valid project whose title is hidden at t=0 and shown at the end', () => {
    const p = getTemplate('wipe-and-iris-reveal')!.build();
    expect(validateProject(p).filter((i) => i.severity === 'error')).toEqual([]);
    expect(o(p, 'wipe').isMask && o(p, 'iris').isMask).toBe(true);
    // The card (blue) at its centre: masked out at t=0, revealed after the wipe.
    expect(px(renderFrameRgba(p, 0, { width: 640 }), 270, 130)).toEqual([255, 255, 255]);
    expect(px(renderFrameRgba(p, 1.6, { width: 640 }), 270, 130)).toEqual([0x22, 0x44, 0xcc]);
  });
});
