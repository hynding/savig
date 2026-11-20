// Framework-neutral spray-brush controller (roadmap 12). The store is injected; the stroke's
// points and seed live in a closure. `move` returns the particles to preview (the engine's
// deterministic `sprayParticles`, so the preview is exactly what `end` commits).
import { sprayParticles } from '@savig/engine';
import type { SprayParticle } from '@savig/engine';
import type { Point } from '@savig/interaction';
import type { ControllerStore } from './store';
import type { GetPoint } from './coords';

export interface SprayMoveResult {
  consumed: boolean;
  /** Particles to preview, or `null` to leave the overlay untouched this move. */
  particles: SprayParticle[] | null;
}

export function makeSprayToolController(store: ControllerStore, random: () => number = Math.random) {
  let points: Point[] | null = null;
  let seed = 1;
  const preview = () => sprayParticles(points ?? [], { ...store.getState().spray, seed });

  return {
    /** Start a stroke; returns the first burst to preview. */
    begin(start: Point): SprayParticle[] {
      points = [start];
      seed = Math.floor(random() * 0x7fffffff) + 1;
      return preview();
    },

    move(getPoint: GetPoint): SprayMoveResult {
      if (!points) return { consumed: false, particles: null };
      const cur = getPoint();
      if (!cur) return { consumed: true, particles: null };
      points.push(cur);
      return { consumed: true, particles: preview() };
    },

    end(): { consumed: boolean } {
      if (!points) return { consumed: false };
      const pts = points;
      points = null;
      store.getState().sprayStroke(pts, seed);
      return { consumed: true };
    },

    active(): boolean {
      return points !== null;
    },
  };
}

export type SprayToolController = ReturnType<typeof makeSprayToolController>;
