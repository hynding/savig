import { describe, expect, it, beforeEach } from 'vitest';
import { store } from '@savig/editor-state';
import { sprayParticles } from '@savig/engine';
import { makeSprayToolController } from './sprayTool';

beforeEach(() => store.getState().newProject());

describe('spray tool controller', () => {
  it('previews exactly the particles it commits, as one group', () => {
    store.getState().setSprayOptions({ radius: 10, density: 3 });
    const ctrl = makeSprayToolController(store, () => 0.25);
    const first = ctrl.begin({ x: 50, y: 50 });
    expect(first).toHaveLength(3);
    expect(ctrl.move(() => null)).toEqual({ consumed: true, particles: null });
    const r = ctrl.move(() => ({ x: 75, y: 50 }));
    expect(r.particles).toHaveLength(9);
    expect(ctrl.end()).toEqual({ consumed: true });
    expect(ctrl.active()).toBe(false);
    const objs = store.getState().history.present.objects;
    const group = objs.find((o) => o.isGroup)!;
    const dots = objs.filter((o) => o.parentId === group.id);
    expect(dots).toHaveLength(9);
    const seed = Math.floor(0.25 * 0x7fffffff) + 1;
    expect(sprayParticles([{ x: 50, y: 50 }, { x: 75, y: 50 }], { ...store.getState().spray, seed })).toEqual(r.particles);
  });

  it('ignores moves and ends without a stroke', () => {
    const ctrl = makeSprayToolController(store);
    expect(ctrl.move(() => ({ x: 0, y: 0 }))).toEqual({ consumed: false, particles: null });
    expect(ctrl.end()).toEqual({ consumed: false });
  });
});
