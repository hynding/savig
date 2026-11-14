/** A small gallery of complete example shorts, built from the full headless stack (builders +
 *  macros). Two purposes: (1) few-shot material so an agent learns idiomatic Savig authoring, and
 *  (2) a smoke test that the stack composes into real, valid, renderable shorts. Each `build()` is
 *  pure and reproducible (explicit ids). An agent can load one (MCP `load_template`) and `get_dsl`
 *  it back to see/edit the declarative form. */
import { createProject } from '@savig/engine';
import type { Project } from '@savig/engine';
import { addEllipse, addPath, addRect, addText, setKeyframe } from './build';
import { addFrameLayer, flipbook, putInFrameKey, shapeTween } from './frames';
import { reveal } from './masks';
import { addBone, attachToBone, bindSkin, poseIK, setBoneRotation } from './bones';
import { addFilter, animateFilter } from './filters';
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
  {
    id: 'bouncing-ball-on-twos',
    title: 'Bouncing ball on twos',
    description:
      'Frame-by-frame: twelve hand-placed ball drawings in a frame layer, each held two frames ("on twos") at 24 fps, squashing on the floor — cel animation, no tweens.',
    build() {
      let p = createProject({ name: 'Bouncing ball on twos', width: 640, height: 360, fps: 24 });
      ({ project: p } = addFrameLayer(p, { id: 'bounce', name: 'Bounce' }));
      const n = 12;
      const ids: string[][] = [];
      for (let i = 0; i < n; i++) {
        // One bounce per cycle: apex at drawing 0 (and the loop back), floor contact at 6 (squashed).
        // τ = time-from-apex (0…1); a falling body covers distance ∝ τ², so the spacing widens near the floor.
        const tau = 1 - Math.abs(2 * (i / n) - 1);
        const floor = i === n / 2;
        const w = floor ? 76 : 60;
        const h = floor ? 44 : 60;
        const y = 40 + 230 * tau * tau + (60 - h); // squash keeps the bottom on the floor
        const id = `ball${i}`;
        ({ project: p } = addEllipse(p, { id, x: 120 + i * 30 - (w - 60) / 2, y, width: w, height: h, style: { fill: '#ff7733', stroke: 'none', strokeWidth: 0 } }));
        ids.push([id]);
      }
      return flipbook(p, 'bounce', ids, { hold: 2 });
    },
  },
  {
    id: 'wipe-and-iris-reveal',
    title: 'Wipe and iris reveal',
    description:
      'Masks: a title card wipes in from the left behind an animated rectangle mask, then a badge opens with an iris (a growing circle mask) — the Flash mask-layer reveal.',
    build() {
      let p = createProject({ name: 'Wipe and iris reveal', width: 640, height: 360, fps: 24 });
      const none = { stroke: 'none', strokeWidth: 0 };
      ({ project: p } = addRect(p, { id: 'card', x: 80, y: 110, width: 380, height: 110, style: { fill: '#2244cc', ...none } }));
      ({ project: p } = addText(p, { id: 'title', content: 'Mask reveal', x: 110, y: 185, fontSize: 52, fill: '#ffffff' }));
      ({ project: p } = reveal(p, { id: 'wipe', targetIds: ['card', 'title'], from: 'left', start: 0, duration: 1, bounds: { x: 79, y: 109, width: 382, height: 112 } }));
      ({ project: p } = addEllipse(p, { id: 'badge', x: 470, y: 95, width: 140, height: 140, style: { fill: '#ff7733', ...none } }));
      ({ project: p } = reveal(p, { id: 'iris', targetIds: ['badge'], style: 'iris', start: 0.8, duration: 0.8, easing: 'easeOut' }));
      return p;
    },
  },
  {
    id: 'glowing-title',
    title: 'Glowing title',
    description:
      'Filters: a title with a drop shadow and a pulsing glow, over a backdrop whose blur sharpens into focus and whose colour warms up — the Flash Filters panel, animated.',
    build() {
      let p = createProject({ name: 'Glowing title', width: 640, height: 360, fps: 24 });
      const none = { stroke: 'none', strokeWidth: 0 };
      ({ project: p } = addRect(p, { id: 'sky', x: 0, y: 0, width: 640, height: 360, style: { fill: '#1b2a6b', ...none } }));
      ({ project: p } = addEllipse(p, { id: 'moon', x: 430, y: 50, width: 120, height: 120, style: { fill: '#f4e9c1', ...none } }));
      ({ project: p } = addText(p, { id: 'title', content: 'GLOW', x: 320, y: 220, fontSize: 96, textAnchor: 'middle', fill: '#ffffff' }));
      // Backdrop: starts blurred and desaturated, comes into focus and warms up.
      ({ project: p } = addFilter(p, 'sky', { kind: 'blur', id: 'soft' }));
      p = animateFilter(p, 'sky', 'soft', 'blur', [{ t: 0, value: 12 }, { t: 1, value: 0, easing: 'easeOut' }]);
      ({ project: p } = addFilter(p, 'moon', { kind: 'adjustColor', id: 'tone' }));
      p = animateFilter(p, 'moon', 'tone', 'saturation', [{ t: 0, value: -1 }, { t: 1.5, value: 0.3 }]);
      p = animateFilter(p, 'moon', 'tone', 'hue', [{ t: 0, value: 0 }, { t: 2, value: -20 }]);
      // Title: a static drop shadow, then a glow that pulses.
      ({ project: p } = addFilter(p, 'title', { kind: 'dropShadow', id: 'shadow', params: { dx: 6, dy: 6, blur: 3, opacity: 0.6 } }));
      ({ project: p } = addFilter(p, 'title', { kind: 'glow', id: 'halo', color: '#66ccff', params: { blur: 10 } }));
      p = animateFilter(p, 'title', 'halo', 'strength', [
        { t: 0, value: 0 },
        { t: 1, value: 3, easing: 'easeInOut' },
        { t: 2, value: 0.8, easing: 'easeInOut' },
      ]);
      return p;
    },
  },
  {
    id: 'shape-tween-morph',
    title: 'Shape tween morph',
    description:
      'Shape tweens: three keys on a frame layer — a circle morphs into a star, the star into a square — with the colours blending along the way. The Flash shape tween, no hand-drawn in-betweens.',
    build() {
      let p = createProject({ name: 'Shape tween morph', width: 640, height: 360, fps: 24 });
      const none = { stroke: 'none', strokeWidth: 0 };
      ({ project: p } = addFrameLayer(p, { id: 'morph', name: 'Morph', keys: [{ id: 'circle', time: 0 }, { id: 'star', time: 1 }, { id: 'square', time: 2 }], end: 3 }));
      ({ project: p } = addEllipse(p, { id: 'c', x: 240, y: 100, width: 160, height: 160, style: { fill: '#ff7733', ...none } }));
      p = putInFrameKey(p, 'c', 'morph', 'circle');
      const star = Array.from({ length: 10 }, (_, i) => {
        const r = i % 2 === 0 ? 90 : 38;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        return { anchor: { x: Math.round((320 + r * Math.cos(a)) * 100) / 100, y: Math.round((180 + r * Math.sin(a)) * 100) / 100 } };
      });
      ({ project: p } = addPath(p, { id: 's', path: { closed: true, nodes: star }, style: { fill: '#ffcc22', ...none } }));
      p = putInFrameKey(p, 's', 'morph', 'star');
      ({ project: p } = addRect(p, { id: 'q', x: 250, y: 110, width: 140, height: 140, style: { fill: '#2266dd', ...none } }));
      p = putInFrameKey(p, 'q', 'morph', 'square');
      p = shapeTween(p, 'morph', 'star', { easing: 'easeInOut' });
      return shapeTween(p, 'morph', 'circle', { easing: 'easeInOut' });
    },
  },
  {
    id: 'waving-arm',
    title: 'Waving arm',
    description:
      'Bones and IK: a three-bone arm (upper arm, forearm, hand) laid out at rest, drawings attached to each bone, then posed by dragging the hand to alternating spots over time — inverse kinematics bends the whole arm into a wave.',
    build() {
      let p = createProject({ name: 'Waving arm', width: 640, height: 360, fps: 24 });
      const none = { stroke: 'none', strokeWidth: 0 };
      ({ project: p } = addEllipse(p, { id: 'body', x: 120, y: 170, width: 120, height: 190, style: { fill: '#2266dd', ...none } }));
      ({ project: p } = addEllipse(p, { id: 'head', x: 140, y: 80, width: 80, height: 80, style: { fill: '#f2c79a', ...none } }));
      // The skeleton, at rest pointing right from the shoulder (220,200).
      ({ project: p } = addBone(p, { id: 'upper', name: 'Upper arm', x: 220, y: 200, length: 100 }));
      ({ project: p } = addBone(p, { id: 'fore', name: 'Forearm', parentId: 'upper', length: 90, min: -150, max: 0 }));
      ({ project: p } = addBone(p, { id: 'hand', name: 'Hand', parentId: 'fore', length: 30, min: -40, max: 40 }));
      // Drawings in rest-pose coordinates, attached to their bones.
      ({ project: p } = addRect(p, { id: 'sleeve', x: 215, y: 188, width: 110, height: 24, style: { fill: '#2266dd', ...none } }));
      ({ project: p } = addRect(p, { id: 'forearm', x: 318, y: 191, width: 96, height: 18, style: { fill: '#f2c79a', ...none } }));
      ({ project: p } = addEllipse(p, { id: 'palm', x: 405, y: 184, width: 40, height: 32, style: { fill: '#f2c79a', ...none } }));
      p = attachToBone(p, 'upper', ['sleeve']);
      p = attachToBone(p, 'fore', ['forearm']);
      p = attachToBone(p, 'hand', ['palm']);
      // The wave: the hand's tip swings between two raised spots; IK keys the whole chain each time.
      const spots = [
        { x: 330, y: 60 },
        { x: 410, y: 80 },
      ];
      for (let i = 0; i <= 4; i++) p = poseIK(p, 'hand', spots[i % 2], { time: i * 0.5, easing: 'easeInOut' });
      return p;
    },
  },
  {
    id: 'swaying-tail',
    title: 'Swaying tail',
    description:
      'Bone skinning: a fish whose tapered tail is ONE drawing bound to a chain of three bones, so it bends smoothly as the bones sway in a travelling wave (each bone a little later and further than the last). The fin rides on the last bone as an attached drawing.',
    build() {
      let p = createProject({ name: 'Swaying tail', width: 640, height: 360, fps: 24, loop: true, duration: 2, durationMode: 'manual' });
      const none = { stroke: 'none', strokeWidth: 0 };
      ({ project: p } = addRect(p, { id: 'water', x: 0, y: 0, width: 640, height: 360, style: { fill: '#0e3d5c', ...none } }));
      // Tail first (behind the body): one tapered path from the body to the fin.
      ({ project: p } = addPath(p, {
        id: 'tail',
        path: { closed: true, nodes: [{ anchor: { x: 250, y: 158 } }, { anchor: { x: 520, y: 174 } }, { anchor: { x: 520, y: 186 } }, { anchor: { x: 250, y: 202 } }] },
        style: { fill: '#ff8a3d', ...none },
      }));
      ({ project: p } = addPath(p, {
        id: 'fin',
        path: { closed: true, nodes: [{ anchor: { x: 510, y: 180 } }, { anchor: { x: 585, y: 128 } }, { anchor: { x: 565, y: 180 } }, { anchor: { x: 585, y: 232 } }] },
        style: { fill: '#ffb36b', ...none },
      }));
      ({ project: p } = addEllipse(p, { id: 'body', x: 110, y: 130, width: 190, height: 100, style: { fill: '#ff8a3d', ...none } }));
      ({ project: p } = addEllipse(p, { id: 'eye', x: 150, y: 160, width: 18, height: 18, style: { fill: '#10202c', ...none } }));
      // The spine: three bones along the tail, at rest pointing right.
      ({ project: p } = addBone(p, { id: 'spine1', name: 'Tail 1', x: 250, y: 180, length: 90, min: -35, max: 35 }));
      ({ project: p } = addBone(p, { id: 'spine2', name: 'Tail 2', parentId: 'spine1', length: 90, min: -35, max: 35 }));
      ({ project: p } = addBone(p, { id: 'spine3', name: 'Tail 3', parentId: 'spine2', length: 90, min: -35, max: 35 }));
      p = bindSkin(p, 'tail', ['spine1', 'spine2', 'spine3']);
      p = attachToBone(p, 'spine3', ['fin']);
      // A travelling wave: each bone sways a beat later and a little further than the one before.
      const bones = [
        { id: 'spine1', amp: 8 },
        { id: 'spine2', amp: 14 },
        { id: 'spine3', amp: 20 },
      ];
      bones.forEach(({ id, amp }, i) => {
        for (let k = 0; k <= 8; k++) {
          const t = k * 0.25;
          const value = Math.round(amp * Math.sin(2 * Math.PI * (t - i * 0.15)) * 100) / 100;
          p = setBoneRotation(p, id, value, { time: t, easing: 'easeInOut' });
        }
      });
      return p;
    },
  },
];

export function getTemplate(id: string): Template | undefined {
  return templates.find((t) => t.id === id);
}
