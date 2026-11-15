// Paint bucket agent surface (spec 2026-11-15-paint-bucket-eraser).
import { describe, expect, it } from 'vitest';
import { createProject, type VectorAsset } from '@savig/engine';
import { addPath, addRect } from './build';
import { paintBucket } from './paintBucket';
import { renderFrameRgba } from './node/render';

const px = (img: { width: number; pixels: Uint8Array }, x: number, y: number) => Array.from(img.pixels.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));
const LINE = { fill: 'none', stroke: '#000000', strokeWidth: 2 };

describe('paintBucket', () => {
  it('fills the area closed by separate lines with a new shape, checked by raster', () => {
    let p = createProject({ width: 100, height: 100 });
    const seg = (id: string, a: [number, number], b: [number, number]) => {
      p = addPath(p, { id, path: { closed: false, nodes: [{ anchor: { x: a[0], y: a[1] } }, { anchor: { x: b[0], y: b[1] } }] }, style: LINE }).project;
    };
    seg('t', [20, 20], [80, 20]);
    seg('r', [80, 20], [80, 80]);
    seg('b', [80, 80], [20, 80]);
    seg('l', [20, 80], [20, 20]);
    const r = paintBucket(p, { x: 50, y: 50, color: '#FF0000', id: 'fill' });
    expect(r).toMatchObject({ kind: 'fill', id: 'fill' });
    expect(r.project.assets.some((a) => a.id === 'fill-asset')).toBe(true);
    const img = renderFrameRgba(r.project, 0);
    expect(px(img, 50, 50)).toEqual([255, 0, 0]);
    expect(px(img, 10, 10)).toEqual([255, 255, 255]);
  });

  it('recolours a shape nothing cuts', () => {
    const { project, id } = addRect(createProject(), { x: 0, y: 0, width: 50, height: 50, id: 'sq', style: { fill: '#000000' } });
    const r = paintBucket(project, { x: 25, y: 25, color: '#0f0' });
    expect(r).toMatchObject({ kind: 'recolor', id });
    expect((r.project.assets.find((a) => a.id === r.project.objects[0].assetId) as VectorAsset).style.fill).toBe('#0f0');
  });

  it('fails loud on open canvas, a line, a locked shape and a bad colour', () => {
    let { project } = addRect(createProject(), { x: 0, y: 0, width: 50, height: 50, id: 'sq', style: { fill: '#000000', stroke: '#000000', strokeWidth: 4 } });
    expect(() => paintBucket(project, { x: 300, y: 300, color: '#fff' })).toThrow(/nothing closed/);
    expect(() => paintBucket(project, { x: 0, y: 25, color: '#fff' })).toThrow(/on the line/);
    expect(() => paintBucket(project, { x: 25, y: 25, color: 'red' })).toThrow(/#rgb/);
    project = { ...project, objects: project.objects.map((o) => ({ ...o, locked: true })) };
    expect(() => paintBucket(project, { x: 25, y: 25, color: '#fff' })).toThrow(/locked/);
  });
});
