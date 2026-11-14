/**
 * CSS-only export (spec 2026-11-14-css-export): the CSS @keyframes file, seeked with Web Animations,
 * matches the SMIL file (already parity-tested against the runtime) at the same times —
 * transform, opacity, a path morph and a scene cut — and it renders inside a script-free <img>.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createProject, createSceneObject, createVectorAsset, promoteToMultiScene } from '../packages/engine/src';
import type { Project, Scene } from '../packages/engine/src';
import { renderAnimatedSvgNode, renderCssSvgNode } from '../packages/core/src/node/animatedSvg';

function project(): Project {
  const p = createProject({ name: 'css-e2e' });
  p.meta.fps = 20;
  p.meta.duration = 1;
  p.meta.durationMode = 'manual';
  p.meta.loop = false;
  p.assets.push(createVectorAsset('rect', { id: 'ra', style: { fill: '#ff0000', stroke: 'none', strokeWidth: 1 } }));
  const k0 = { closed: true, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 40, y: 0 } }, { anchor: { x: 40, y: 40 } }] };
  const k1 = { closed: true, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 80, y: 10 } }, { anchor: { x: 10, y: 60 } }] };
  p.assets.push(createVectorAsset('path', { id: 'pa', path: k0, style: { fill: '#0000ff', stroke: 'none', strokeWidth: 1 } }));
  p.objects.push(
    createSceneObject('ra', {
      id: 'box',
      zOrder: 0,
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      base: { x: 20, y: 30, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      shapeBase: { width: 30, height: 20 },
      tracks: {
        x: [{ time: 0, value: 20, easing: 'easeInOut' }, { time: 1, value: 200, easing: 'linear' }],
        rotation: [{ time: 0, value: 0, easing: 'linear' }, { time: 1, value: 270, easing: 'linear' }],
        scaleX: [{ time: 0, value: 1, easing: 'linear' }, { time: 1, value: 2, easing: 'linear' }],
        opacity: [{ time: 0, value: 1, easing: 'linear' }, { time: 1, value: 0.2, easing: 'linear' }],
      },
    }),
    createSceneObject('pa', {
      id: 'blob',
      zOrder: 1,
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      base: { x: 150, y: 120, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      shapeTrack: [{ time: 0, easing: 'linear', path: k0 }, { time: 1, easing: 'linear', path: k1 }],
    }),
  );
  return p;
}

function write(markup: string, name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'savig-css-'));
  const file = join(dir, name);
  writeFileSync(file, markup);
  return pathToFileURL(file).href;
}

interface Probe {
  ctm: number[];
  opacity: number;
  bbox: number[];
}

/** Seek the open document to `t` (SMIL clock or every Web Animation) and probe each object. */
async function probe(page: Page, t: number, mode: 'smil' | 'css'): Promise<Record<string, Probe>> {
  return page.evaluate(
    ({ t, mode }) => {
      const svg = document.documentElement as unknown as SVGSVGElement;
      if (mode === 'smil') {
        svg.pauseAnimations();
        svg.setCurrentTime(t);
      } else {
        for (const a of document.getAnimations()) {
          a.pause();
          a.currentTime = t * 1000;
        }
      }
      const out: Record<string, { ctm: number[]; opacity: number; bbox: number[] }> = {};
      document.querySelectorAll('[data-savig-object]').forEach((el) => {
        const g = el as SVGGraphicsElement;
        const m = g.getCTM()!;
        const shape = g.firstElementChild as SVGGraphicsElement;
        const b = shape.getBBox();
        out[el.getAttribute('data-savig-object')!] = {
          ctm: [m.a, m.b, m.c, m.d, m.e, m.f],
          opacity: Number(getComputedStyle(g).opacity),
          bbox: [b.x, b.y, b.width, b.height],
        };
      });
      return out;
    },
    { t, mode },
  );
}

const close = (a: number[], b: number[], tol: number) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

test('CSS export matches the SMIL export at the same times (transform, opacity, morph)', async ({ page }) => {
  const p = project();
  const smil = write(renderAnimatedSvgNode(p), 'smil.svg');
  const css = write(renderCssSvgNode(p), 'css.svg');
  for (const t of [0, 0.25, 0.5, 0.8, 1]) {
    await page.goto(smil);
    const a = await probe(page, t, 'smil');
    await page.goto(css);
    const b = await probe(page, t, 'css');
    for (const id of ['box', 'blob']) {
      expect(close(b[id].ctm, a[id].ctm, 0.02), `${id} transform at ${t}s: css ${b[id].ctm} vs smil ${a[id].ctm}`).toBe(true);
      expect(Math.abs(b[id].opacity - a[id].opacity), `${id} opacity at ${t}s`).toBeLessThan(0.01);
      expect(close(b[id].bbox, a[id].bbox, 0.05), `${id} bbox at ${t}s: css ${b[id].bbox} vs smil ${a[id].bbox}`).toBe(true);
    }
  }
  // It really moves.
  await page.goto(css);
  const start = await probe(page, 0, 'css');
  const end = await probe(page, 1, 'css');
  expect(close(start.box.ctm, end.box.ctm, 1)).toBe(false);
});

test('CSS export switches scenes at the cut', async ({ page }) => {
  const one = promoteToMultiScene(project());
  const s0: Scene = { ...one.scenes![0], duration: 0.5 };
  const s1: Scene = { id: 's1', name: 'Scene 2', objects: s0.objects, duration: 0.5, transitionIn: { kind: 'cut' } };
  const p = { ...one, scenes: [s0, s1] };
  await page.goto(write(renderCssSvgNode(p), 'scenes.svg'));
  const shown = (t: number) =>
    page.evaluate((t) => {
      for (const a of document.getAnimations()) {
        a.pause();
        a.currentTime = t * 1000;
      }
      return [...document.querySelectorAll('[data-savig-scene]')].map((g) => Number(getComputedStyle(g).opacity) > 0.5);
    }, t);
  expect(await shown(0.2)).toEqual([true, false]);
  expect(await shown(0.7)).toEqual([false, true]);
});

test('CSS export renders inside an <img> (script-free context)', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'savig-css-img-'));
  writeFileSync(join(dir, 'anim.svg'), renderCssSvgNode(project()));
  writeFileSync(join(dir, 'wrap.html'), '<!DOCTYPE html><img src="anim.svg" width="320">');
  await page.goto(pathToFileURL(join(dir, 'wrap.html')).href);
  expect(await page.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
});
