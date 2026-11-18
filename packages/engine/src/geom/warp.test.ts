// Distort and envelope (spec 2026-11-18-skew-distort, slice 3).
import { describe, expect, it } from 'vitest';
import { applyWarp, boxCorners, boxMesh, distortMap, envelopeMap, warpPath, warpPieces, type Box } from './warp';
import { createProject, createSceneObject, createVectorAsset } from '../project';
import { flattenPath } from './arcLength';
import { mapPoint } from '../groupTransform';
import { resolveAnchor, sampleObject } from '../sample';
import { pathBounds } from '../path';
import type { PathData, VectorAsset } from '../types';

const box: Box = { x: 0, y: 0, width: 100, height: 50 };
const square: PathData = {
  closed: true,
  nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }, { anchor: { x: 100, y: 50 } }, { anchor: { x: 0, y: 50 } }],
};

describe('warp maps', () => {
  it('identity corners and mesh leave points alone', () => {
    const d = distortMap(box, boxCorners(box));
    const e = envelopeMap(box, boxMesh(box));
    for (const p of [{ x: 0, y: 0 }, { x: 37, y: 12 }, { x: 100, y: 50 }]) {
      expect(d(p).x).toBeCloseTo(p.x, 9);
      expect(e(p).y).toBeCloseTo(p.y, 9);
    }
  });

  it('distort sends each corner where it is pinned', () => {
    const corners = [{ x: 10, y: 5 }, { x: 90, y: -10 }, { x: 120, y: 70 }, { x: -5, y: 40 }] as const;
    const d = distortMap(box, [...corners] as never);
    expect(d({ x: 100, y: 50 })).toEqual({ x: 120, y: 70 });
    expect(d({ x: 0, y: 0 })).toEqual({ x: 10, y: 5 });
  });
});

describe('warpPath', () => {
  it('a distorted rectangle stays a 4-node quad of straight sides', () => {
    const corners = [{ x: 10, y: 5 }, { x: 90, y: -10 }, { x: 120, y: 70 }, { x: -5, y: 40 }];
    const warp = { kind: 'distort' as const, corners: corners as never };
    const out = warpPath(square, distortMap(box, warp.corners), warpPieces(warp), 100);
    expect(out.nodes.map((n) => n.anchor)).toEqual(corners);
    expect(out.nodes.every((n) => !n.in && !n.out)).toBe(true);
    expect(out.closed).toBe(true);
  });

  it('an envelope bulge curves the top edge through the dragged point', () => {
    const mesh = boxMesh(box);
    mesh[1] = { x: 50, y: -40 }; // pull the top-middle handle up
    const map = envelopeMap(box, mesh);
    const out = warpPath(square, map, warpPieces({ kind: 'envelope', mesh }), 100);
    // The top edge now bows upward: its highest point is the patch at u=0.5,v=0 → y = 0.5·(-40) = -20.
    const pts = flattenPath(out).pts;
    const top = Math.min(...pts.map((p) => p.y));
    expect(top).toBeCloseTo(-20, 0);
    // corners are untouched
    expect(out.nodes[0].anchor).toEqual({ x: 0, y: 0 });
  });

  it('keeps an open path open', () => {
    const open: PathData = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 50 } }] };
    const mesh = boxMesh(box);
    mesh[4] = { x: 70, y: 10 };
    const out = warpPath(open, envelopeMap(box, mesh), warpPieces({ kind: 'envelope', mesh }), 100);
    expect(out.closed).toBe(false);
    expect(out.nodes.at(-1)!.anchor).toEqual({ x: 100, y: 50 });
  });
});

describe('applyWarp', () => {
  function rectProject(extra: Partial<VectorAsset> = {}) {
    const p = createProject();
    p.assets.push({ ...createVectorAsset('rect', { id: 'va' }), ...extra });
    p.objects.push(createSceneObject('va', { id: 'r', shapeBase: { width: 100, height: 50 }, base: { x: 20, y: 30, scaleX: 1.5, scaleY: 1, rotation: 25, opacity: 1 } }));
    return p;
  }

  it('turns a rect into a distorted path without moving the untouched corners on screen', () => {
    const p = rectProject();
    const obj = p.objects[0];
    const st = sampleObject(obj, 0);
    const a = resolveAnchor(obj, st, 'rect');
    const worldBefore = mapPoint(st, a.anchorX, a.anchorY, 0, 0);
    const corners = boxCorners(box);
    corners[2] = { x: 130, y: 80 };
    const r = applyWarp(p.objects, p.assets, 'r', { kind: 'distort', corners }, 0);
    if ('refused' in r) throw new Error(r.refused);
    const o2 = r.objects[0];
    const asset = r.assets[0] as VectorAsset;
    expect(asset.shapeType).toBe('path');
    expect(asset.path!.nodes[2].anchor).toEqual({ x: 130, y: 80 });
    expect(o2.shapeBase).toBeUndefined();
    expect(o2.anchorMode).toBe('absolute');
    const st2 = sampleObject(o2, 0);
    const worldAfter = mapPoint(st2, o2.anchorX, o2.anchorY, 0, 0);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 9);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 9);
    expect(pathBounds(asset.path!).width).toBeCloseTo(130);
  });

  it('copies a shared asset instead of changing the other object', () => {
    const p = rectProject();
    p.objects.push(createSceneObject('va', { id: 'twin', shapeBase: { width: 100, height: 50 } }));
    const corners = boxCorners(box);
    corners[0] = { x: -10, y: -10 };
    const r = applyWarp(p.objects, p.assets, 'r', { kind: 'distort', corners }, 0);
    if ('refused' in r) throw new Error(r.refused);
    expect(r.assets.map((a) => a.id)).toEqual(['va', 'va-r']);
    expect(r.objects[1].assetId).toBe('va');
    expect((r.assets[0] as VectorAsset).shapeType).toBe('rect');
  });

  it('keeps a rounded rect rounded', () => {
    const p = rectProject();
    p.objects[0] = { ...p.objects[0], shapeBase: { width: 100, height: 50, cornerRadius: 10 } };
    const r = applyWarp(p.objects, p.assets, 'r', { kind: 'distort', corners: boxCorners(box) }, 0);
    if ('refused' in r) throw new Error(r.refused);
    const nodes = (r.assets[0] as VectorAsset).path!.nodes;
    expect(nodes.some((n) => n.in || n.out)).toBe(true);
    expect(pathBounds({ nodes, closed: true }).width).toBeCloseTo(100, 3);
  });

  it('refuses animated outlines, groups and locked drawings', () => {
    const p = rectProject();
    const keyed = { ...p.objects[0], tracks: { width: [{ time: 0, value: 10, easing: 'linear' as const }] } };
    expect(applyWarp([keyed], p.assets, 'r', { kind: 'distort', corners: boxCorners(box) }, 0)).toEqual({ refused: 'animated-shape' });
    const locked = { ...p.objects[0], locked: true };
    expect(applyWarp([locked], p.assets, 'r', { kind: 'distort', corners: boxCorners(box) }, 0)).toEqual({ refused: 'locked' });
    expect(applyWarp(p.objects, p.assets, 'nope', { kind: 'distort', corners: boxCorners(box) }, 0)).toEqual({ refused: 'not-a-drawing' });
  });
});
