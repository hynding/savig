import { describe, it, expect } from 'vitest';
import { createProject } from '@savig/engine';
import { addRect } from './build';
import { setCamera, panTo, zoomTo, kenBurns } from './camera';
import { compileShort, decompileProject, type ShortDoc } from './dsl';
import { renderFrameSvg } from './node/render';
import { renderSvgDocument } from '@savig/services/export/renderDocument';

const withRect = () => addRect(createProject({ width: 640, height: 360 }), { x: 100, y: 100, width: 80, height: 80, id: 'r' }).project;

describe('core/camera authoring', () => {
  it('setCamera seeds + merges the static framing', () => {
    const p = setCamera(withRect(), { zoom: 2, x: 100 });
    expect(p.camera!.base).toEqual({ x: 100, y: 180, zoom: 2, rotation: 0 }); // y/rotation from default pose
  });

  it('panTo / zoomTo animate from the current framing', () => {
    let p = zoomTo(withRect(), 2, { duration: 1.5 });
    expect(p.camera!.tracks.zoom!.map((k) => [k.time, k.value])).toEqual([[0, 1], [1.5, 2]]);
    p = panTo(p, { x: 300 }, { start: 0, duration: 1 });
    expect(p.camera!.tracks.x!.map((k) => k.value)).toEqual([320, 300]); // from default centre (640/2)
  });

  it('kenBurns ramps each changed axis from `from` to `to`', () => {
    const p = kenBurns(withRect(), { x: 100, y: 100, zoom: 1.2 }, { x: 300, y: 200, zoom: 1.6 }, { duration: 4 });
    expect(p.camera!.base).toMatchObject({ x: 100, y: 100, zoom: 1.2 });
    expect(p.camera!.tracks.zoom!.map((k) => k.value)).toEqual([1.2, 1.6]);
    expect(p.camera!.tracks.x!.map((k) => k.value)).toEqual([100, 300]);
  });
});

describe('core/camera render + DSL', () => {
  it('a camera wraps the scene in a data-savig-camera <g>, and it animates per frame', () => {
    const p = zoomTo(withRect(), 3, { start: 0, duration: 1 });
    const at0 = renderFrameSvg(p, 0);
    const at1 = renderFrameSvg(p, 1);
    expect(at0).toContain('data-savig-camera');
    // the camera group's transform changes as the zoom ramps 1 -> 3
    expect(at0).not.toEqual(at1);
    expect(at1).toContain('scale(3)');
  });

  it('NO camera => no wrapper (byte-identical export parity)', () => {
    const svg = renderSvgDocument(withRect());
    expect(svg).not.toContain('data-savig-camera');
  });

  it('DSL camera compiles and round-trips', () => {
    const doc: ShortDoc = {
      objects: [{ type: 'rect', id: 'r', x: 0, y: 0, width: 10, height: 10 }],
      camera: { base: { zoom: 1.5 }, animate: { x: [{ t: 0, value: 0 }, { t: 2, value: 200, easing: 'easeInOut' }] } },
    };
    const p1 = compileShort(doc);
    expect(p1.camera!.base.zoom).toBe(1.5);
    expect(p1.camera!.tracks.x!.length).toBe(2);
    const p2 = compileShort(decompileProject(p1));
    expect(p2.camera).toEqual(p1.camera);
  });
});
