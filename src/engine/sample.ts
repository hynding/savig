import { interpolate } from './interpolate';
import { ANIMATABLE_PROPERTIES } from './project';
import type { Project, SceneObject, Transform2D } from './types';

export interface RenderState extends Transform2D {
  objectId: string;
}

export function sampleObject(obj: SceneObject, time: number): RenderState {
  const resolve = (prop: keyof Transform2D): number => {
    const track = obj.tracks[prop];
    if (track && track.length > 0) {
      return interpolate(track, time, prop === 'rotation');
    }
    return obj.base[prop];
  };

  const state = { objectId: obj.id } as RenderState;
  for (const prop of ANIMATABLE_PROPERTIES) {
    state[prop] = resolve(prop);
  }
  return state;
}

export function sampleProject(project: Project, time: number): RenderState[] {
  return project.objects
    .map((obj, index) => ({ obj, index }))
    .sort((p, q) => p.obj.zOrder - q.obj.zOrder || p.index - q.index)
    .map(({ obj }) => sampleObject(obj, time));
}
