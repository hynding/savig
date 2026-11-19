import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { createKeyframe, createProject, createSceneObject } from '@savig/engine';
import {
  SPRITE_SHEET_MAX_FRAMES, SPRITE_SHEET_MAX_SIDE, planSpriteSheet, spriteSheetAtlas, spriteSheetStem, zipSpriteSheet,
} from './spriteSheet';

/** 800x600 artboard, `seconds` long (x animates over it). */
function project(seconds: number) {
  const obj = createSceneObject('a', { id: 'o1', tracks: { x: [createKeyframe(0, 0), createKeyframe(seconds, 10)] } });
  const p = createProject();
  return { ...p, meta: { ...p.meta, width: 800, height: 600 }, objects: [obj] };
}

describe('planSpriteSheet', () => {
  it('samples i/fps over the duration and lays cells out near-square, row-major', () => {
    const plan = planSpriteSheet(project(1), { fps: 10, frameWidth: 100 });
    expect(plan.frameCount).toBe(10);
    expect(plan.times).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]);
    expect(plan.frameHeight).toBe(75); // aspect kept
    expect([plan.columns, plan.rows]).toEqual([4, 3]);
    expect([plan.width, plan.height]).toEqual([400, 225]);
    expect(plan.cells[0]).toEqual({ x: 0, y: 0, w: 100, h: 75 });
    expect(plan.cells[5]).toEqual({ x: 100, y: 75, w: 100, h: 75 });
  });

  it('honours explicit columns and padding (gaps between cells only)', () => {
    const plan = planSpriteSheet(project(1), { fps: 4, frameWidth: 40, columns: 4, padding: 2 });
    expect([plan.columns, plan.rows]).toEqual([4, 1]);
    expect(plan.width).toBe(4 * 40 + 3 * 2);
    expect(plan.cells.map((c) => c.x)).toEqual([0, 42, 84, 126]);
    // More columns than frames collapses to one row of exactly the frames.
    expect(planSpriteSheet(project(1), { fps: 4, frameWidth: 40, columns: 10 }).columns).toBe(4);
  });

  it('a static project is a single frame', () => {
    const plan = planSpriteSheet(createProject(), { fps: 12, frameWidth: 64 });
    expect(plan.frameCount).toBe(1);
    expect([plan.columns, plan.rows]).toEqual([1, 1]);
  });

  it('clamps fps and falls back to the project for NaN fields', () => {
    const p = project(1);
    expect(planSpriteSheet(p, { fps: 500, frameWidth: 10 }).fps).toBe(60);
    const plan = planSpriteSheet(p, { fps: NaN, frameWidth: NaN, columns: NaN, padding: NaN });
    expect(plan.fps).toBe(p.meta.fps);
    expect(plan.frameWidth).toBe(800);
    expect(plan.padding).toBe(0);
  });

  it('refuses sheets over the side limit or the frame cap, with a reason', () => {
    expect(() => planSpriteSheet(project(1), { fps: 30, frameWidth: 2000 })).toThrow(new RegExp(`${SPRITE_SHEET_MAX_SIDE}px limit`));
    expect(() => planSpriteSheet(project(20), { fps: 60, frameWidth: 8 })).toThrow(new RegExp(`at most ${SPRITE_SHEET_MAX_FRAMES} frames`));
  });
});

describe('spriteSheetAtlas', () => {
  it('describes every cell in TexturePacker JSON-hash form with an animation and frame tag', () => {
    const plan = planSpriteSheet(project(1), { fps: 4, frameWidth: 40, columns: 2 });
    const atlas = spriteSheetAtlas(plan, 'My Walk!');
    const names = Object.keys(atlas.frames);
    expect(names).toEqual(['My-Walk_0000', 'My-Walk_0001', 'My-Walk_0002', 'My-Walk_0003']);
    expect(atlas.frames['My-Walk_0003']).toEqual({
      frame: { x: 40, y: 30, w: 40, h: 30 }, rotated: false, trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: 40, h: 30 }, sourceSize: { w: 40, h: 30 }, duration: 250,
    });
    expect(atlas.animations).toEqual({ 'My-Walk': names });
    expect(atlas.meta).toMatchObject({ image: 'My-Walk.png', size: { w: 80, h: 60 }, fps: 4, frameTags: [{ name: 'My-Walk', from: 0, to: 3, direction: 'forward' }] });
  });

  it('stems fall back for names with no safe characters', () => {
    expect(spriteSheetStem('  ')).toBe('sprites');
    expect(spriteSheetStem('a/b c')).toBe('a-b-c');
  });
});

describe('zipSpriteSheet', () => {
  it('bundles <stem>.png and <stem>.json', () => {
    const plan = planSpriteSheet(createProject(), { fps: 1, frameWidth: 8 });
    const atlas = spriteSheetAtlas(plan, 'hero');
    const files = unzipSync(zipSpriteSheet(new Uint8Array([137, 80, 78, 71]), atlas, 'hero'));
    expect(Object.keys(files).sort()).toEqual(['hero.json', 'hero.png']);
    expect(Array.from(files['hero.png'])).toEqual([137, 80, 78, 71]);
    expect(JSON.parse(strFromU8(files['hero.json'])).meta.image).toBe('hero.png');
  });
});
