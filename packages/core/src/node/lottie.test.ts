// Lottie export (spec 2026-11-15-lottie-export): round-trip check. A small reference Lottie
// interpreter — written from the bodymovin format, independent of the exporter — turns a frame of
// the exported animation back into SVG; that raster must match SaViG's own raster of the same frame.
//
// The interpreter fixes the conventions the exporter relies on: layer transform
// P · R(r) · K(sk) · S(s) · (p - A), K = [[1, -tan(sk)], [0, 1]] (lottie-web skewFromAxis(-sk, 0)),
// positive r clockwise on screen; layers[0] drawn on top; in a group, earlier items draw above
// later ones (so a stroke listed before its fill draws over it); fill rule 1 nonzero, 2 even-odd.
import { describe, expect, it } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import { createGroupObject, createProject, createSceneObject, createSymbolAsset, createVectorAsset, type Project } from '@savig/engine';
import { exportLottie, parseTransform, decomposeAffine, type LottieAnimation, type LottieKeyframe, type LottieProperty, type LottieShapePath } from '@savig/services';
import { compileShort } from '../dsl';
import { renderFrameRgba } from './render';


function valueAt(p: LottieProperty, f: number): unknown {
  if (p.a === 0) return p.k;
  const ks = p.k as LottieKeyframe[];
  let i = 0;
  while (i + 1 < ks.length && ks[i + 1].t <= f) i++;
  const k = ks[i];
  const next = ks[i + 1];
  const unwrap = (s: unknown[]) => (s.length === 1 ? s[0] : s);
  if (!next || k.h || f <= k.t) return unwrap(k.s as unknown[]);
  const t = (f - k.t) / (next.t - k.t);
  const a = k.s as number[];
  const b = next.s as number[];
  const v = a.map((x, d) => x + (b[d] - x) * t);
  return v.length === 1 ? v[0] : v;
}
const num = (p: LottieProperty, f: number): number => valueAt(p, f) as number;
const vec = (p: LottieProperty, f: number): number[] => valueAt(p, f) as number[];

function d(path: LottieShapePath): string {
  const n = path.v.length;
  if (n === 0) return '';
  const parts = [`M${path.v[0][0]} ${path.v[0][1]}`];
  const seg = (a: number, b: number) => {
    const c1 = [path.v[a][0] + path.o[a][0], path.v[a][1] + path.o[a][1]];
    const c2 = [path.v[b][0] + path.i[b][0], path.v[b][1] + path.i[b][1]];
    parts.push(`C${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${path.v[b][0]} ${path.v[b][1]}`);
  };
  for (let k = 1; k < n; k++) seg(k - 1, k);
  if (path.c) {
    seg(n - 1, 0);
    parts.push('Z');
  }
  return parts.join(' ');
}

const rgb = (c: number[]) => `rgb(${c.slice(0, 3).map((x) => Math.round(x * 255)).join(',')})`;
const BM = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];

/** Render frame `f` of a Lottie animation to SVG (the subset the exporter writes). */
function lottieFrameSvg(anim: LottieAnimation, f: number): string {
  const body: string[] = [];
  for (const layer of [...anim.layers].reverse()) {
    const ks = layer.ks as Record<string, LottieProperty & { s?: boolean; x?: LottieProperty; y?: LottieProperty }>;
    const px = ks.p.s ? num(ks.p.x!, f) : vec(ks.p, f)[0];
    const py = ks.p.s ? num(ks.p.y!, f) : vec(ks.p, f)[1];
    const r = (num(ks.r, f) * Math.PI) / 180;
    const s = vec(ks.s, f);
    const sk = (num(ks.sk, f) * Math.PI) / 180;
    const a = vec(ks.a, f);
    // P · R · K · S · T(-A)
    const R = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r)];
    const K = [1, 0, -Math.tan(sk), 1];
    const S = [s[0] / 100, 0, 0, s[1] / 100];
    const m2 = (x: number[], y: number[]) => [x[0] * y[0] + x[2] * y[1], x[1] * y[0] + x[3] * y[1], x[0] * y[2] + x[2] * y[3], x[1] * y[2] + x[3] * y[3]];
    const L = m2(m2(R, K), S);
    const e = px - (L[0] * a[0] + L[2] * a[1]);
    const ff = py - (L[1] * a[0] + L[3] * a[1]);
    const opacity = num(ks.o, f) / 100;
    const group = (layer.shapes as { it: Record<string, unknown>[] }[])[0];
    const paths = group.it.filter((x) => x.ty === 'sh').map((x) => d(valueAt(x.ks as LottieProperty, f) as LottieShapePath)).join(' ');
    const fill = group.it.find((x) => x.ty === 'fl');
    const stroke = group.it.find((x) => x.ty === 'st');
    const parts: string[] = [];
    // Items later in `it` draw first.
    const ordered = group.it.filter((x) => x.ty === 'fl' || x.ty === 'st').reverse();
    for (const it of ordered) {
      if (it === fill) {
        parts.push(`<path d="${paths}" fill="${rgb(vec(fill.c as LottieProperty, f))}" fill-opacity="${num(fill.o as LottieProperty, f) / 100}" fill-rule="${fill.r === 2 ? 'evenodd' : 'nonzero'}" stroke="none"/>`);
      } else if (it === stroke) {
        const lc = ['', 'butt', 'round', 'square'][stroke.lc as number];
        const lj = ['', 'miter', 'round', 'bevel'][stroke.lj as number];
        parts.push(`<path d="${paths}" fill="none" stroke="${rgb(vec(stroke.c as LottieProperty, f))}" stroke-opacity="${num(stroke.o as LottieProperty, f) / 100}" stroke-width="${num(stroke.w as LottieProperty, f)}" stroke-linecap="${lc}" stroke-linejoin="${lj}"/>`);
      }
    }
    const bm = layer.bm ? ` style="mix-blend-mode:${BM[layer.bm]}"` : '';
    body.push(`<g transform="matrix(${L[0]} ${L[1]} ${L[2]} ${L[3]} ${e} ${ff})" opacity="${opacity}"${bm}>${parts.join('')}</g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${anim.w}" height="${anim.h}" viewBox="0 0 ${anim.w} ${anim.h}">${body.join('')}</svg>`;
}

function diffRatio(project: Project, f: number): number {
  const anim = exportLottie(project).animation;
  const want = renderFrameRgba(project, f / project.meta.fps);
  const got = new Resvg(lottieFrameSvg(anim, f), { background: 'white' }).render();
  const px = got.pixels;
  let bad = 0;
  for (let i = 0; i < want.pixels.length; i += 4) {
    if (Math.abs(want.pixels[i] - px[i]) > 48 || Math.abs(want.pixels[i + 1] - px[i + 1]) > 48 || Math.abs(want.pixels[i + 2] - px[i + 2]) > 48) bad++;
  }
  return bad / (want.pixels.length / 4);
}

describe('matrix helpers', () => {
  it('parses SVG transform lists and decomposes back exactly', () => {
    const m = parseTransform('translate(10, 20) rotate(30, 5, 5) scale(2, 0.5)');
    const t = decomposeAffine(m);
    const r = (t.rotation * Math.PI) / 180;
    const k = -Math.tan((t.skew * Math.PI) / 180);
    const L = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r)];
    // R · K · S
    const KS = [t.scaleX / 100, 0, (k * t.scaleY) / 100, t.scaleY / 100];
    const back = [L[0] * KS[0] + L[2] * KS[1], L[1] * KS[0] + L[3] * KS[1], L[0] * KS[2] + L[2] * KS[3], L[1] * KS[2] + L[3] * KS[3]];
    back.forEach((v, i) => expect(v).toBeCloseTo(m[i], 9));
    expect([t.x, t.y]).toEqual([m[4], m[5]]);
  });
});

describe('exportLottie round trip (reference interpreter vs SaViG raster)', () => {
  it('animated fill + stroke rects, ellipse, colour track, blend', () => {
    const p = compileShort({
      meta: { width: 200, height: 120, fps: 10, duration: 2 },
      objects: [
        { type: 'rect', id: 'bg', x: 0, y: 0, width: 200, height: 120, fill: '#eeeeff' },
        {
          type: 'rect', id: 'r', x: 20, y: 20, width: 60, height: 40, fill: '#ff0000', stroke: '#000000', strokeWidth: 4, cornerRadius: 8,
          animate: { x: [{ t: 0, value: 20 }, { t: 2, value: 120 }], rotation: [{ t: 0, value: 0 }, { t: 2, value: 270, easing: 'easeInOut' }] },
        },
        { type: 'ellipse', id: 'e', x: 100, y: 60, width: 50, height: 30, fill: '#00aa00', blend: 'multiply', animate: { scaleX: [{ t: 0, value: 1 }, { t: 1, value: 2 }] } },
      ],
    } as never);
    p.objects = p.objects.map((o) => (o.id === 'r' ? { ...o, colorTracks: { fill: [{ time: 0, value: '#ff0000', easing: 'linear' }, { time: 2, value: '#0000ff', easing: 'linear' }] } } : o));
    for (const f of [0, 5, 13, 20]) expect(diffRatio(p, f)).toBeLessThan(0.01);
    const anim = exportLottie(p).animation;
    expect(anim).toMatchObject({ fr: 10, op: 20, w: 200, h: 120 });
    expect(anim.layers.map((l) => l.nm)).toEqual(['Ellipse 3', 'Rectangle 2', 'Rectangle 1']); // top first
    expect(anim.layers[0].bm).toBe(1);
  });

  it('a rotated child under a non-uniformly scaled group (needs skew) and a symbol instance', () => {
    const p = createProject({ width: 160, height: 160, fps: 4, duration: 1 });
    p.assets.push(createVectorAsset('rect', { id: 'ra', style: { fill: '#cc3300', stroke: '#002244', strokeWidth: 3 } }));
    p.objects.push({ ...createGroupObject({ id: 'g', zOrder: 0, anchorX: 0, anchorY: 0 }), base: { x: 30, y: 20, scaleX: 2, scaleY: 0.6, rotation: 15, opacity: 1 } });
    p.objects.push(createSceneObject('ra', { id: 'child', parentId: 'g', zOrder: 0, anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5, base: { x: 10, y: 20, scaleX: 1, scaleY: 1, rotation: 40, opacity: 0.8 }, shapeBase: { width: 30, height: 30 }, tracks: { rotation: [{ time: 0, value: 40, easing: 'linear' }, { time: 1, value: 130, easing: 'linear' }] } }));
    const sym = createSymbolAsset({ id: 'sym', name: 'S', objects: [createSceneObject('ra', { id: 'in', zOrder: 0, anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5, base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, shapeBase: { width: 20, height: 10 } })] });
    p.assets.push(sym);
    p.objects.push(createSceneObject('sym', { id: 'inst', zOrder: 1, base: { x: 100, y: 110, scaleX: 1.5, scaleY: 1.5, rotation: -20, opacity: 1 } }));
    const childSkew = JSON.stringify((exportLottie(p).animation.layers[1].ks as { sk: unknown }).sk);
    expect(childSkew).toMatch(/[1-9]/); // the child needs skew
    for (const f of [0, 2, 4]) expect(diffRatio(p, f)).toBeLessThan(0.01);
  });

  it('a path morph and a compound (holed) path', () => {
    const P = (pts: number[][]) => ({ closed: true, nodes: pts.map(([x, y]) => ({ anchor: { x, y } })) });
    const p = createProject({ width: 120, height: 120, fps: 10, duration: 1 });
    p.assets.push(createVectorAsset('path', { id: 'ringA', path: P([[0, 0], [100, 0], [100, 100], [0, 100]]), compoundRings: [P([[30, 30], [30, 70], [70, 70], [70, 30]])], style: { fill: '#333399', stroke: 'none', strokeWidth: 0 } }));
    p.assets.push(createVectorAsset('path', { id: 'mA', path: P([[0, 40], [40, 0], [80, 40]]), style: { fill: '#ffaa00', stroke: '#000000', strokeWidth: 2 } }));
    p.objects.push(createSceneObject('ringA', { id: 'ring', zOrder: 0, anchorMode: 'absolute', anchorX: 0, anchorY: 0, base: { x: 10, y: 10, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } }));
    p.objects.push(createSceneObject('mA', {
      id: 'm', zOrder: 1, anchorMode: 'absolute', anchorX: 0, anchorY: 0, base: { x: 20, y: 20, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      shapeTrack: [{ time: 0, path: P([[0, 40], [40, 0], [80, 40]]), easing: 'linear' }, { time: 1, path: P([[0, 80], [40, 40], [80, 80]]), easing: 'linear' }],
    }));
    for (const f of [0, 4, 10]) expect(diffRatio(p, f)).toBeLessThan(0.01);
    const ringLayer = exportLottie(p).animation.layers[1];
    expect(JSON.stringify(ringLayer.shapes)).toContain('"r":2'); // even-odd for the hole
  });
});

describe('channel thinning and warnings', () => {
  it('a linear tween keeps two keyframes; constants are static; unsupported content is reported', () => {
    const p = compileShort({
      meta: { width: 100, height: 100, fps: 30, duration: 2 },
      objects: [
        { type: 'rect', id: 'r', x: 0, y: 0, width: 10, height: 10, animate: { x: [{ t: 0, value: 0 }, { t: 2, value: 60 }] } },
        { type: 'text', id: 't', x: 0, y: 50, content: 'hi' },
      ],
    } as never);
    const { animation, warnings } = exportLottie(p);
    const layer = animation.layers.find((l) => /Rect/.test(l.nm))!;
    const ks = layer.ks as { p: { x: { a: number; k: unknown[] }; y: { a: number } }; r: { a: number } };
    expect(ks.p.x.a).toBe(1);
    expect(ks.p.x.k).toHaveLength(2);
    expect(ks.p.y.a).toBe(0);
    expect(ks.r.a).toBe(0);
    expect(warnings.some((w) => /text/.test(w))).toBe(true);
  });
});

