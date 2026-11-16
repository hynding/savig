// Image-sequence import (spec 2026-11-16-image-sequence): the store verb.
import { beforeEach, expect, it } from 'vitest';
import { createProject, type ImageAsset } from '@savig/engine';
import { store } from './store';

const st = () => store.getState();
const img = (id: string): ImageAsset => ({ id, kind: 'image', name: `${id}.png`, mimeType: 'image/png', dataUrl: 'data:image/png;base64,AAAA', width: 20, height: 10 });

beforeEach(() => st().setProject(createProject({ fps: 10, width: 100, height: 100 })));

it('builds a centred frame layer from the playhead, shares identical pictures, and undoes in one step', () => {
  st().seek(0.3);
  st().importImageSequence([img('a'), img('b'), img('a')], { hold: 2 });
  const p = st().history.present;
  const layer = p.objects.find((o) => o.frames)!;
  expect(st().selectedObjectId).toBe(layer.id);
  expect(layer.frames!.keys.map((k) => k.time)).toEqual([0.3, 0.5, 0.7]);
  expect(layer.base).toMatchObject({ x: 40, y: 45 });
  expect(p.assets.filter((a) => a.kind === 'image').map((a) => a.id)).toEqual(['a', 'b']);
  expect(p.objects.filter((o) => o.parentId === layer.id)).toHaveLength(3);
  st().undo();
  expect(st().history.present.objects).toHaveLength(0);
  expect(st().history.present.assets).toHaveLength(0);
});
