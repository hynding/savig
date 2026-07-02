/** A small gallery of complete example shorts, built from the full headless stack (builders +
 *  macros). Two purposes: (1) few-shot material so an agent learns idiomatic Savig authoring, and
 *  (2) a smoke test that the stack composes into real, valid, renderable shorts. Each `build()` is
 *  pure and reproducible (explicit ids). An agent can load one (MCP `load_template`) and `get_dsl`
 *  it back to see/edit the declarative form. */
import { createProject } from '@savig/engine';
import type { Project } from '@savig/engine';
import { addEllipse, addRect, setKeyframe } from './build';
import { fadeIn, moveTo, pulse, scaleTo, spin, stagger } from './macros';

export interface Template {
  id: string;
  title: string;
  description: string;
  build(): Project;
}

export const templates: Template[] = [
  {
    id: 'bouncing-ball',
    title: 'Bouncing ball',
    description: 'A classic gravity bounce — an ellipse falls (ease-in) and rebounds (ease-out), with a little horizontal drift.',
    build() {
      let p = createProject({ name: 'Bouncing ball', width: 640, height: 360, fps: 30 });
      ({ project: p } = addEllipse(p, { x: 290, y: 40, width: 60, height: 60, id: 'ball', style: { fill: '#ff7733', stroke: 'none', strokeWidth: 0 } }));
      // gravity feel: accelerate down (ease-in to the floor), decelerate up (ease-out to the apex)
      p = setKeyframe(p, { objectId: 'ball', property: 'y', time: 0, value: 40 });
      p = setKeyframe(p, { objectId: 'ball', property: 'y', time: 0.9, value: 270, easing: 'easeIn' });
      p = setKeyframe(p, { objectId: 'ball', property: 'y', time: 1.8, value: 40, easing: 'easeOut' });
      p = moveTo(p, 'ball', { x: 420, fromX: 290 }, { start: 0, duration: 1.8, easing: 'linear' });
      return p;
    },
  },
  {
    id: 'fade-in-title',
    title: 'Fade-in title',
    description: 'A title bar fades in while sliding up — the standard intro beat.',
    build() {
      let p = createProject({ name: 'Fade-in title', width: 640, height: 360, fps: 30 });
      ({ project: p } = addRect(p, { x: 120, y: 180, width: 400, height: 80, id: 'bar', style: { fill: '#2244cc', stroke: 'none', strokeWidth: 0 } }));
      p = fadeIn(p, 'bar', { start: 0, duration: 0.6 });
      p = moveTo(p, 'bar', { y: 180, fromY: 220 }, { start: 0, duration: 0.6, easing: 'easeOut' });
      return p;
    },
  },
  {
    id: 'staggered-dots',
    title: 'Staggered dots',
    description: 'Five dots pop in one after another (stagger + fade + scale-from-zero) — a loading/list reveal.',
    build() {
      let p = createProject({ name: 'Staggered dots', width: 480, height: 120, fps: 30 });
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const id = `dot${i}`;
        ids.push(id);
        ({ project: p } = addEllipse(p, { x: 60 + i * 90, y: 45, width: 30, height: 30, id, style: { fill: '#33bb88', stroke: 'none', strokeWidth: 0 } }));
      }
      p = stagger(p, ids, 0.12, (proj, id, start) => {
        let q = fadeIn(proj, id, { start, duration: 0.3 });
        q = scaleTo(q, id, { scale: 1, from: 0 }, { start, duration: 0.3, easing: 'easeOut' });
        return q;
      });
      return p;
    },
  },
  {
    id: 'pulsing-badge',
    title: 'Pulsing badge',
    description: 'A badge that pulses (scale up and back) — a gentle attention loop.',
    build() {
      let p = createProject({ name: 'Pulsing badge', width: 200, height: 200, fps: 30 });
      ({ project: p } = addEllipse(p, { x: 50, y: 50, width: 100, height: 100, id: 'badge', style: { fill: '#cc3366', stroke: 'none', strokeWidth: 0 } }));
      p = pulse(p, 'badge', 1.25, { start: 0, duration: 1 });
      return p;
    },
  },
  {
    id: 'slide-and-spin',
    title: 'Slide and spin',
    description: 'A square slides across the frame while spinning one full turn.',
    build() {
      let p = createProject({ name: 'Slide and spin', width: 640, height: 360, fps: 30 });
      ({ project: p } = addRect(p, { x: 60, y: 150, width: 60, height: 60, id: 'sq', style: { fill: '#7755dd', stroke: 'none', strokeWidth: 0 } }));
      p = moveTo(p, 'sq', { x: 520 }, { start: 0, duration: 2, easing: 'easeInOut' });
      p = spin(p, 'sq', 1, { start: 0, duration: 2 });
      return p;
    },
  },
];

export function getTemplate(id: string): Template | undefined {
  return templates.find((t) => t.id === id);
}
