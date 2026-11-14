// Bone springs (spec 2026-11-14-bone-springs): Flash's spring setting on bones, simulated at
// authoring time and baked as per-frame rotation offsets (`bone.spring.baked`), which
// `sampleObject` adds to the keyed rotation — so every renderer, export and the runtime play it
// with no further work. A sprung bone keeps its world angle by inertia and swings when its joint
// accelerates; a damped spring pulls it back toward its keyed angle.

import { boneJointWorld, boneTipWorld, isBone, type BoneObject, type BonePose } from './bones';
import { sampleObject } from './sample';
import { computeProjectDuration } from './duration';
import type { Project, SceneObject } from './types';

/** Simulation substeps per frame. */
const SUBSTEPS = 4;

/** Spring constants from Flash-style 0–100 settings: natural frequency 0.4–5 Hz, damping ratio
 *  0.05 (rings) – 1 (critical). */
export function springConstants(strength: number, damping: number): { k: number; c: number } {
  const s = Math.max(0, Math.min(100, strength)) / 100;
  const d = Math.max(0, Math.min(100, damping)) / 100;
  const w = 2 * Math.PI * (0.4 + 4.6 * s);
  return { k: w * w, c: 2 * (0.05 + 0.95 * d) * w };
}

const isSprung = (o: SceneObject): o is BoneObject => isBone(o) && (o.bone.spring?.strength ?? 0) > 0;

const wrapRad = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const round3 = (v: number) => Math.round(v * 1000) / 1000 + 0;

/** Simulated per-frame rotation offsets (degrees, frames 0..round(duration·fps)) for every sprung
 *  bone in `objects`. Deterministic; ancestors are simulated first so a sprung chain whips. */
export function simulateSprings(objects: SceneObject[], fps: number, duration: number): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const sprung = objects.filter(isSprung);
  if (sprung.length === 0 || !(fps > 0) || !(duration > 0)) return out;
  // Simulate against the KEYED motion: strip any previous bake.
  const clean = objects.map((o) => (isSprung(o) && o.bone.spring!.baked ? { ...o, bone: { ...o.bone, spring: { strength: o.bone.spring!.strength, damping: o.bone.spring!.damping } } } : o));
  const byId = new Map(clean.map((o) => [o.id, o] as const));
  const depth = (o: SceneObject) => {
    let d = 0;
    const seen = new Set<string>();
    for (let p = o.parentId ? byId.get(o.parentId) : undefined; p && !seen.has(p.id); p = p.parentId ? byId.get(p.parentId) : undefined) {
      seen.add(p.id);
      d++;
    }
    return d;
  };
  const order = sprung.map((o) => byId.get(o.id) as BoneObject).sort((a, b) => depth(a) - depth(b));
  const frames = Math.max(1, Math.round(duration * fps));
  const steps = frames * SUBSTEPS;
  const h = 1 / (fps * SUBSTEPS);

  /** Ancestors' simulated rotations at time `t` (offsets interpolated between frames). */
  const poseAt = (t: number, except: string): BonePose => {
    const pose: BonePose = new Map();
    for (const [id, offs] of out) {
      if (id === except) continue;
      const f = Math.min(frames, Math.max(0, t * fps));
      const i = Math.min(frames - 1, Math.floor(f));
      const o = offs[i] + (offs[i + 1] - offs[i]) * (f - i);
      pose.set(id, sampleObject(byId.get(id)!, t).rotation + o);
    }
    return pose;
  };

  for (const bone of order) {
    const { k, c } = springConstants(bone.bone.spring!.strength, bone.bone.spring!.damping);
    // Keyed (target) world angle, joint position and bone length at every substep.
    const theta: number[] = [];
    const jx: number[] = [];
    const jy: number[] = [];
    let len = 1;
    let sign = 1;
    for (let n = 0; n <= steps; n++) {
      const t = n * h;
      const pose = poseAt(t, bone.id);
      const j = boneJointWorld(clean, bone.id, t, pose);
      const tip = boneTipWorld(clean, bone.id, t, pose);
      theta.push(Math.atan2(tip.y - j.y, tip.x - j.x));
      jx.push(j.x);
      jy.push(j.y);
      if (n === 0) {
        len = Math.max(1e-6, Math.hypot(tip.x - j.x, tip.y - j.y));
        // Handedness: does +1° of local rotation turn the bone +1° in world space?
        const turned = new Map(pose);
        turned.set(bone.id, sampleObject(bone, 0).rotation + 1);
        const tip2 = boneTipWorld(clean, bone.id, 0, turned);
        sign = wrapRad(Math.atan2(tip2.y - j.y, tip2.x - j.x) - theta[0]) >= 0 ? 1 : -1;
      }
    }
    // Unwrap the target so its derivative is continuous.
    for (let n = 1; n <= steps; n++) theta[n] = theta[n - 1] + wrapRad(theta[n] - theta[n - 1]);
    let th = theta[0];
    let om = steps > 0 ? (theta[1] - theta[0]) / h : 0;
    const offsets: number[] = [0];
    const minR = bone.bone.min ?? -Infinity;
    const maxR = bone.bone.max ?? Infinity;
    for (let n = 0; n < steps; n++) {
      const dTarget = (theta[n + 1] - theta[n]) / h;
      const ax = n > 0 ? (jx[n + 1] - 2 * jx[n] + jx[n - 1]) / (h * h) : 0;
      const ay = n > 0 ? (jy[n + 1] - 2 * jy[n] + jy[n - 1]) / (h * h) : 0;
      // Pivot acceleration swings the bone like a pendulum: α = −(u × a)/L.
      const inertial = -(Math.cos(th) * ay - Math.sin(th) * ax) / len;
      const alpha = -k * (th - theta[n]) - c * (om - dTarget) + inertial;
      om += alpha * h;
      th += om * h;
      if ((n + 1) % SUBSTEPS === 0) {
        const t = ((n + 1) * h);
        const keyed = sampleObject(bone, t).rotation;
        let off = (sign * (th - theta[n + 1]) * 180) / Math.PI;
        const clamped = Math.min(maxR, Math.max(minR, keyed + off)) - keyed;
        if (clamped !== off) {
          off = clamped;
          th = theta[n + 1] + (sign * off * Math.PI) / 180;
          om = dTarget;
        }
        offsets.push(round3(off));
      }
    }
    out.set(bone.id, offsets);
  }
  return out;
}

/** `objects` with every sprung bone's `spring.baked` re-simulated (and stale bakes on bones whose
 *  spring is off removed). Returns the SAME array when nothing changed. */
export function bakeSprings(objects: SceneObject[], fps: number, duration: number): SceneObject[] {
  const hasSpringData = objects.some((o) => isBone(o) && o.bone.spring);
  if (!hasSpringData) return objects;
  const sim = simulateSprings(objects, fps, duration);
  let changed = false;
  const next = objects.map((o) => {
    if (!isBone(o) || !o.bone.spring) return o;
    const offsets = sim.get(o.id);
    const prev = o.bone.spring.baked;
    if (!offsets) {
      if (!prev) return o;
      changed = true;
      const spring = { strength: o.bone.spring.strength, damping: o.bone.spring.damping };
      return { ...o, bone: { ...o.bone, spring } };
    }
    if (prev && prev.fps === fps && prev.offsets.length === offsets.length && prev.offsets.every((v, i) => v === offsets[i])) return o;
    changed = true;
    return { ...o, bone: { ...o.bone, spring: { ...o.bone.spring, baked: { fps, offsets } } } };
  });
  return changed ? next : objects;
}

/** `project` with every sprung bone re-baked: the root objects against the project's duration, or
 *  each scene's objects against that scene's duration (symbols aren't sprung). The headless path's
 *  counterpart of the editor's commit hook — call it after editing a sprung armature. Returns the
 *  SAME project when nothing changed. */
export function bakeProjectSprings(project: Project): Project {
  const fps = project.meta.fps;
  if (!project.scenes) {
    const objects = bakeSprings(project.objects, fps, computeProjectDuration(project));
    return objects === project.objects ? project : { ...project, objects };
  }
  let changed = false;
  const scenes = project.scenes.map((s) => {
    const objects = bakeSprings(s.objects, fps, s.duration);
    if (objects === s.objects) return s;
    changed = true;
    return { ...s, objects };
  });
  return changed ? { ...project, scenes } : project;
}
