// Lottie export (spec 2026-11-15-lottie-export): round-trip check. A small reference Lottie
// interpreter — written from the bodymovin format, independent of the exporter — turns a frame of
// the exported animation back into SVG; that raster must match SaViG's own raster of the same frame.
//
// The interpreter fixes the conventions the exporter relies on: layer transform
// P · R(r) · K(sk) · S(s) · (p - A), K = [[1, -tan(sk)], [0, 1]] (lottie-web skewFromAxis(-sk, 0)),
// positive r clockwise on screen; layers[0] drawn on top; in a group, earlier items draw above
// later ones (so a stroke listed before its fill draws over it); fill rule 1 nonzero, 2 even-odd;
// a layer shows for ip <= f < op; a `td` layer is the track matte of the layer right below it in
// the list (tt 1 alpha, 2 alpha inverted, 3 luma, 4 luma inverted); ty 0 draws a precomp's
// layers, ty 2 an image asset at its natural w x h.
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

type AnyLayer = Record<string, unknown> & { ty: number; ks: unknown; ip?: number; op?: number; td?: number; tt?: number; refId?: string; bm?: number; w?: number; h?: number };
type AnyAsset = { id: string; layers?: AnyLayer[]; w?: number; h?: number; p?: string };

/** Render frame `f` of a Lottie animation to SVG (the subset the exporter writes). */
function lottieFrameSvg(anim: LottieAnimation, f: number): string {
  const defs: string[] = [];
  const assets = new Map(((anim as unknown as { assets?: AnyAsset[] }).assets ?? []).map((a) => [a.id, a] as const));
  const body = renderLayers(anim.layers as unknown as AnyLayer[], f, defs, assets);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${anim.w}" height="${anim.h}" viewBox="0 0 ${anim.w} ${anim.h}"><defs>${defs.join('')}</defs>${body}</svg>`;
}

/** A layer list, layers[0] on top. A `td` layer is the track matte of the layer right after it. */
function renderLayers(layers: AnyLayer[], f: number, defs: string[], assets: Map<string, AnyAsset>): string {
  const out: string[] = [];
  let matte: AnyLayer | undefined;
  for (const layer of layers) {
    if (layer.td) {
      matte = layer;
      continue;
    }
    const visibleNow = f >= (layer.ip ?? -Infinity) && f < (layer.op ?? Infinity);
    let g = visibleNow ? renderLayer(layer, f, defs, assets) : '';
    if (g && layer.tt && matte) {
      const id = `m${defs.length}`;
      const content = renderLayer(matte, f, defs, assets);
      const luma = layer.tt === 3 || layer.tt === 4;
      const inverted = layer.tt === 2 || layer.tt === 4;
      if (!inverted) {
        defs.push(`<mask id="${id}" mask-type="${luma ? 'luminance' : 'alpha'}" style="mask-type:${luma ? 'luminance' : 'alpha'}" maskUnits="userSpaceOnUse" x="-10000" y="-10000" width="20000" height="20000">${content}</mask>`);
      } else {
        // 1 - coverage: a white rect minus a black rect masked by the matte.
        defs.push(`<mask id="${id}-src" mask-type="${luma ? 'luminance' : 'alpha'}" style="mask-type:${luma ? 'luminance' : 'alpha'}" maskUnits="userSpaceOnUse" x="-10000" y="-10000" width="20000" height="20000">${content}</mask>`);
        defs.push(`<mask id="${id}" mask-type="luminance" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="-10000" y="-10000" width="20000" height="20000"><rect x="-10000" y="-10000" width="20000" height="20000" fill="white"/><rect x="-10000" y="-10000" width="20000" height="20000" fill="black" mask="url(#${id}-src)"/></mask>`);
      }
      g = `<g mask="url(#${id})">${g}</g>`;
    }
    matte = undefined;
    out.push(g);
  }
  return out.reverse().join('');
}

function renderLayer(layer: AnyLayer, f: number, defs: string[], assets: Map<string, AnyAsset>): string {
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
  const parts: string[] = [];
  // Earlier groups draw on top, so paint the last group first.
  for (const group of [...((layer.shapes ?? []) as { it: Record<string, unknown>[] }[])].reverse()) {
    const sh = group.it.filter((x) => x.ty === 'sh').map((x) => valueAt(x.ks as LottieProperty, f) as LottieShapePath);
    const paths = sh.map(d).join(' ');
    const tm = group.it.find((x) => x.ty === 'tm');
    const ordered = group.it.filter((x) => ['fl', 'st', 'gf', 'gs'].includes(x.ty as string)).reverse();
    for (const it of ordered) {
      const isFill = it.ty === 'fl' || it.ty === 'gf';
      let paint: string;
      if (it.ty === 'fl' || it.ty === 'st') paint = rgb(vec(it.c as LottieProperty, f));
      else {
        const gid = `g${defs.length}`;
        const n = (it.g as { p: number }).p;
        const flat = vec((it.g as { k: LottieProperty }).k, f);
        const stops = Array.from({ length: n }, (_, k) => {
          const alpha = flat.length > 4 * n ? flat[4 * n + 2 * k + 1] : 1;
          return `<stop offset="${flat[4 * k]}" stop-color="${rgb(flat.slice(4 * k + 1, 4 * k + 4))}" stop-opacity="${alpha}"/>`;
        }).join('');
        const st = vec(it.s as LottieProperty, f);
        const en = vec(it.e as LottieProperty, f);
        defs.push(
          it.t === 1
            ? `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${st[0]}" y1="${st[1]}" x2="${en[0]}" y2="${en[1]}">${stops}</linearGradient>`
            : `<radialGradient id="${gid}" gradientUnits="userSpaceOnUse" cx="${st[0]}" cy="${st[1]}" r="${Math.hypot(en[0] - st[0], en[1] - st[1])}">${stops}</radialGradient>`,
        );
        paint = `url(#${gid})`;
      }
      const op = num(it.o as LottieProperty, f) / 100;
      if (isFill) {
        parts.push(`<path d="${paths}" fill="${paint}" fill-opacity="${op}" fill-rule="${it.r === 2 ? 'evenodd' : 'nonzero'}" stroke="none"/>`);
      } else {
        const lc = ['', 'butt', 'round', 'square'][it.lc as number];
        const lj = ['', 'miter', 'round', 'bevel'][it.lj as number];
        let dashAttrs = '';
        if (tm) {
          // Trim window [s+o, e+o] of the whole (multi-path) length, as a normalized dash.
          const s0 = num(tm.s as LottieProperty, f) / 100;
          const e0 = num(tm.e as LottieProperty, f) / 100;
          const o0 = num(tm.o as LottieProperty, f) / 360;
          const vis = Math.max(0, Math.min(1, e0 - s0));
          const phase = (((s0 + o0) % 1) + 1) % 1;
          dashAttrs = ` pathLength="1" stroke-dasharray="${vis} ${1 - vis}" stroke-dashoffset="${-phase}"`;
        } else if (it.d) {
          const ds = it.d as { n: string; v: LottieProperty }[];
          const arr = ds.filter((x) => x.n !== 'o').map((x) => num(x.v, f));
          const off = ds.find((x) => x.n === 'o');
          dashAttrs = ` stroke-dasharray="${arr.join(' ')}" stroke-dashoffset="${off ? num(off.v, f) : 0}"`;
        }
        parts.push(`<path d="${paths}" fill="none" stroke="${paint}" stroke-opacity="${op}" stroke-width="${num(it.w as LottieProperty, f)}" stroke-linecap="${lc}" stroke-linejoin="${lj}"${dashAttrs}/>`);
      }
    }
  }
  if (layer.ty === 2) {
    const a = assets.get(layer.refId!)!;
    parts.push(`<image width="${a.w}" height="${a.h}" preserveAspectRatio="none" href="${a.p}" xlink:href="${a.p}"/>`);
  } else if (layer.ty === 0) {
    parts.push(renderLayers(assets.get(layer.refId!)!.layers!, f, defs, assets));
  }
  const bm = layer.bm ? ` style="mix-blend-mode:${BM[layer.bm]}"` : '';
  return `<g transform="matrix(${L[0]} ${L[1]} ${L[2]} ${L[3]} ${e} ${ff})" opacity="${opacity}"${bm}>${parts.join('')}</g>`;
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
    for (const f of [0, 5, 13, 19]) expect(diffRatio(p, f)).toBeLessThan(0.01);
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
    for (const f of [0, 2, 3]) expect(diffRatio(p, f)).toBeLessThan(0.01);
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
    for (const f of [0, 4, 9]) expect(diffRatio(p, f)).toBeLessThan(0.01);
    const ringLayer = exportLottie(p).animation.layers[1];
    expect(JSON.stringify(ringLayer.shapes)).toContain('"r":2'); // even-odd for the hole
  });
});

describe('exportLottie round trip: gradients, trim, dashes (slice 2)', () => {
  const base = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
  it('linear + radial gradient fills (animated, with alpha) and a gradient stroke', () => {
    const p = createProject({ width: 200, height: 100, fps: 4, duration: 1 });
    p.assets.push(createVectorAsset('rect', { id: 'la', style: { fill: '#000000', stroke: 'none', strokeWidth: 0, fillGradient: { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 0.5, stops: [{ offset: 0, color: '#ff0000' }, { offset: 0.6, color: '#ffff00', opacity: 0.5 }, { offset: 1, color: '#0000ff' }] } } }));
    p.assets.push(createVectorAsset('ellipse', { id: 'ra', style: { fill: '#000000', stroke: '#000000', strokeWidth: 6, fillGradient: { type: 'radial', cx: 0.5, cy: 0.5, r: 0.5, stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#008800' }] }, strokeGradient: { type: 'linear', x1: 0, y1: 0, x2: 0, y2: 1, stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ff00ff' }] } } }));
    p.objects.push(createSceneObject('la', {
      id: 'lin', zOrder: 0, anchorMode: 'absolute', anchorX: 0, anchorY: 0, base: { ...base, x: 10, y: 10 }, shapeBase: { width: 100, height: 80 },
      gradientTracks: { fill: [
        { time: 0, gradient: { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 0.5, stops: [{ offset: 0, color: '#ff0000' }, { offset: 0.6, color: '#ffff00', opacity: 0.5 }, { offset: 1, color: '#0000ff' }] }, easing: 'linear' },
        { time: 1, gradient: { type: 'linear', x1: 0, y1: 1, x2: 1, y2: 0, stops: [{ offset: 0, color: '#00ff00' }, { offset: 0.3, color: '#000000', opacity: 1 }, { offset: 1, color: '#ffffff' }] }, easing: 'linear' },
      ] },
    }));
    p.objects.push(createSceneObject('ra', { id: 'rad', zOrder: 1, anchorMode: 'absolute', anchorX: 0, anchorY: 0, base: { ...base, x: 120, y: 15 }, shapeBase: { radiusX: 35, radiusY: 35 } }));
    for (const f of [0, 2, 3]) expect(diffRatio(p, f)).toBeLessThan(0.02);
    const json = JSON.stringify(exportLottie(p).animation);
    expect(json).toContain('"ty":"gf"');
    expect(json).toContain('"ty":"gs"');
  });

  it('an animated trim (draw-on) and a dashed stroke', () => {
    const P = (pts: number[][], closed = false) => ({ closed, nodes: pts.map(([x, y]) => ({ anchor: { x, y } })) });
    const p = createProject({ width: 200, height: 100, fps: 4, duration: 1 });
    p.assets.push(createVectorAsset('path', { id: 'ta', path: P([[0, 0], [80, 0], [80, 60], [0, 60]], true), style: { fill: '#ddeeff', stroke: '#cc0000', strokeWidth: 6, strokeLinecap: 'round' } }));
    p.assets.push(createVectorAsset('path', { id: 'da', path: P([[0, 30], [70, 0], [70, 60]]), style: { fill: 'none', stroke: '#003366', strokeWidth: 5, strokeDasharray: [0.1, 0.05], strokeDashoffset: 0.02 } }));
    p.objects.push(createSceneObject('ta', {
      id: 'trim', zOrder: 0, anchorMode: 'absolute', anchorX: 0, anchorY: 0, base: { ...base, x: 10, y: 20 },
      trim: { start: 0, end: 0.2, offset: 0.1, endTrack: [{ time: 0, value: 0.2, easing: 'linear' }, { time: 1, value: 0.9, easing: 'linear' }] },
    }));
    p.objects.push(createSceneObject('da', { id: 'dash', zOrder: 1, anchorMode: 'absolute', anchorX: 0, anchorY: 0, base: { ...base, x: 110, y: 20 } }));
    // resvg ignores pathLength, so SaViG's own raster cannot be the reference for normalized
    // dashes; check the converted values instead.
    const anim = exportLottie(p).animation;
    const trimLayer = anim.layers.find((l) => JSON.stringify(l.shapes).includes('"ty":"tm"'))!;
    const strokeGroup = (trimLayer.shapes as { nm: string; it: Record<string, unknown>[] }[]).find((g) => g.nm === 'Stroke')!;
    const tm = strokeGroup.it.find((x) => x.ty === 'tm') as Record<string, LottieProperty>;
    expect([num(tm.s, 0), num(tm.e, 0), num(tm.o, 0)]).toEqual([0, 20, 36]);
    expect(num(tm.e, 2)).toBeCloseTo(55, 6);
    expect(num(tm.e, 4)).toBeCloseTo(90, 6);
    const fillGroup = (trimLayer.shapes as { nm: string; it: Record<string, unknown>[] }[]).find((g) => g.nm === 'Fill')!;
    expect(fillGroup.it.some((x) => x.ty === 'tm')).toBe(false); // the trim never cuts the fill
    const dashLayer = anim.layers.find((l) => JSON.stringify(l.shapes).includes('"n":"d"'))!;
    const st = (dashLayer.shapes as { it: Record<string, unknown>[] }[])[0].it.find((x) => x.ty === 'st')!;
    const L = Math.hypot(70, 30) + 60;
    const ds = st.d as { n: string; v: LottieProperty }[];
    expect(ds.map((x) => x.n)).toEqual(['d', 'g', 'o']);
    expect(num(ds[0].v, 0)).toBeCloseTo(0.1 * L, 2);
    expect(num(ds[1].v, 0)).toBeCloseTo(0.05 * L, 2);
    expect(num(ds[2].v, 0)).toBeCloseTo(0.02 * L, 2);
    // The untrimmed fill still matches the raster.
    const fillOnly = { ...p, objects: p.objects.filter((o) => o.id === 'trim').map((o) => ({ ...o, trim: undefined })) };
    for (const f of [0]) expect(diffRatio(fillOnly, f)).toBeLessThan(0.01);
    expect(exportLottie(p).warnings).toEqual([]);
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


describe('exportLottie round trip: masks, images, scenes, camera (slice 3)', () => {
  const base = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
  const rectAsset = (id: string, fill: string) => createVectorAsset('rect', { id, style: { fill, stroke: 'none', strokeWidth: 0 } });

  it('alpha, inverted and luminance masks become track mattes', () => {
    const p = createProject({ width: 240, height: 100, fps: 4, duration: 1 });
    p.assets.push(rectAsset('bgA', '#eeeeee'), rectAsset('red', '#dd0000'), rectAsset('blue', '#0000dd'), rectAsset('green', '#00aa00'));
    p.assets.push(createVectorAsset('ellipse', { id: 'maskA', style: { fill: '#000000', stroke: 'none', strokeWidth: 0 } }));
    p.assets.push(createVectorAsset('rect', { id: 'lumA', style: { fill: '#999999', stroke: 'none', strokeWidth: 0 } }));
    const box = (id: string, assetId: string, x: number, z: number, extra = {}) =>
      createSceneObject(assetId, { id, zOrder: z, anchorMode: 'absolute', anchorX: 0, anchorY: 0, base: { ...base, x, y: 10 }, shapeBase: { width: 70, height: 80 }, ...extra });
    p.objects.push(box('bg', 'bgA', 0, 0, { shapeBase: { width: 240, height: 100 }, base: { ...base } }));
    p.objects.push(box('r', 'red', 5, 1, { maskedBy: 'm1' }));
    p.objects.push(createSceneObject('maskA', {
      id: 'm1', zOrder: 2, isMask: true, anchorMode: 'absolute', anchorX: 0, anchorY: 0, base: { ...base, x: 40, y: 50 }, shapeBase: { radiusX: 30, radiusY: 25 },
      tracks: { x: [{ time: 0, value: 30, easing: 'linear' }, { time: 1, value: 50, easing: 'linear' }] },
    }));
    p.objects.push(box('b', 'blue', 85, 3, { maskedBy: 'm2' }));
    p.objects.push(createSceneObject('maskA', { id: 'm2', zOrder: 4, isMask: true, maskInvert: true, anchorMode: 'absolute', anchorX: 0, anchorY: 0, base: { ...base, x: 120, y: 50 }, shapeBase: { radiusX: 20, radiusY: 20 } }));
    p.objects.push(box('g', 'green', 165, 5, { maskedBy: 'm3' }));
    p.objects.push(box('m3', 'lumA', 175, 6, { isMask: true, maskType: 'luminance', shapeBase: { width: 40, height: 60 } }));
    for (const f of [0, 2, 3]) expect(diffRatio(p, f)).toBeLessThan(0.01);
    const anim = exportLottie(p).animation;
    const tts = anim.layers.filter((l) => l.tt).map((l) => l.tt);
    expect(tts.sort()).toEqual([1, 2, 3]);
    anim.layers.forEach((l, i) => {
      if (l.td) expect(anim.layers[i + 1].tt).toBeGreaterThan(0); // each matte sits right above its target
    });
    expect(exportLottie(p).warnings).toEqual([]);
  });

  it('an image object becomes an image layer with an embedded asset', () => {
    const png = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="10" height="10" fill="#ff0000"/><rect x="10" width="10" height="10" fill="#0000ff"/></svg>').render().asPng();
    const p = createProject({ width: 120, height: 100, fps: 4, duration: 1 });
    p.assets.push({ id: 'img', kind: 'image', name: 'pic', mimeType: 'image/png', dataUrl: `data:image/png;base64,${Buffer.from(png).toString('base64')}`, width: 20, height: 10 });
    p.objects.push(createSceneObject('img', {
      id: 'i', zOrder: 0, anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5, base: { ...base, x: 60, y: 50, scaleX: 3, scaleY: 3 },
      tracks: { rotation: [{ time: 0, value: 0, easing: 'linear' }, { time: 1, value: 90, easing: 'linear' }] },
    }));
    for (const f of [0, 2, 3]) expect(diffRatio(p, f)).toBeLessThan(0.01);
    const anim = exportLottie(p).animation as LottieAnimation & { assets: { id: string; w: number; h: number; e: number; p: string }[] };
    expect(anim.layers[0]).toMatchObject({ ty: 2, refId: 'image_img' });
    expect(anim.assets.find((a) => (a as { id: string }).id === 'image_img')).toMatchObject({ w: 20, h: 10, e: 1 });
  });

  it('scenes with crossfade and dip transitions play on one timeline', () => {
    const p = createProject({ width: 100, height: 80, fps: 10, duration: 0 });
    p.assets.push(rectAsset('red', '#dd0000'), rectAsset('blue', '#0000dd'), rectAsset('green', '#00aa00'));
    const shot = (id: string, assetId: string, x: number) => ({
      id, name: id, duration: 1,
      objects: [createSceneObject(assetId, { id: `${id}-o`, zOrder: 0, anchorMode: 'absolute', anchorX: 0, anchorY: 0, base: { ...base, x, y: 10 }, shapeBase: { width: 50, height: 50 }, tracks: { y: [{ time: 0, value: 10, easing: 'linear' }, { time: 1, value: 25, easing: 'linear' }] } })],
    });
    p.scenes = [
      shot('s1', 'red', 10),
      { ...shot('s2', 'blue', 40), transitionIn: { kind: 'crossfade', duration: 0.4 } },
      { ...shot('s3', 'green', 25), transitionIn: { kind: 'dip', duration: 0.6, color: '#ffcc00' } },
    ];
    const anim = exportLottie(p).animation;
    const frames = Array.from({ length: anim.op }, (_, f) => f);
    for (const f of frames) expect(diffRatio(p, f), `frame ${f}`).toBeLessThan(0.01);
    expect(anim.layers.some((l) => l.nm === 'Scene transition')).toBe(true);
  });

  it('a project camera (pan, zoom, rotation) is baked into the layers', () => {
    // Camera keys do not extend an auto duration, so pin it.
    const p = createProject({ width: 160, height: 120, fps: 4, duration: 1, durationMode: 'manual' });
    p.assets.push(rectAsset('red', '#dd0000'), createVectorAsset('ellipse', { id: 'el', style: { fill: '#2244aa', stroke: '#000000', strokeWidth: 3 } }));
    p.objects.push(createSceneObject('red', { id: 'r', zOrder: 0, anchorMode: 'absolute', anchorX: 0, anchorY: 0, base: { ...base, x: 30, y: 30 }, shapeBase: { width: 50, height: 30 } }));
    p.objects.push(createSceneObject('el', { id: 'e', zOrder: 1, anchorMode: 'absolute', anchorX: 0, anchorY: 0, base: { ...base, x: 110, y: 80 }, shapeBase: { radiusX: 20, radiusY: 15 } }));
    p.camera = {
      base: { x: 80, y: 60, zoom: 1, rotation: 0 },
      tracks: {
        zoom: [{ time: 0, value: 1, easing: 'linear' }, { time: 1, value: 1.6, easing: 'linear' }],
        rotation: [{ time: 0, value: 0, easing: 'linear' }, { time: 1, value: 25, easing: 'linear' }],
        x: [{ time: 0, value: 80, easing: 'linear' }, { time: 1, value: 95, easing: 'linear' }],
      },
    };
    for (const f of [0, 1, 2, 3]) expect(diffRatio(p, f)).toBeLessThan(0.01);
  });
});
