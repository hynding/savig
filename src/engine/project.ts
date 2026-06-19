import type {
  AnimatableProperty,
  Keyframe,
  Project,
  ProjectMeta,
  SceneObject,
  Transform2D,
} from './types';

export const ANIMATABLE_PROPERTIES: readonly AnimatableProperty[] = [
  'x',
  'y',
  'scaleX',
  'scaleY',
  'rotation',
  'opacity',
] as const;

export const DEFAULT_TRANSFORM: Transform2D = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
};

export function newId(): string {
  return crypto.randomUUID();
}

export function createProject(overrides: Partial<ProjectMeta> = {}): Project {
  const meta: ProjectMeta = {
    name: 'Untitled',
    width: 1280,
    height: 720,
    fps: 30,
    duration: 0,
    durationMode: 'auto',
    loop: false,
    version: 1,
    ...overrides,
  };
  return { meta, assets: [], objects: [], audioClips: [] };
}

export function createSceneObject(
  assetId: string,
  overrides: Partial<SceneObject> = {},
): SceneObject {
  return {
    id: newId(),
    name: 'Object',
    assetId,
    zOrder: 0,
    anchorX: 0,
    anchorY: 0,
    base: { ...DEFAULT_TRANSFORM },
    tracks: {},
    ...overrides,
  };
}

export function createKeyframe(
  time: number,
  value: number,
  overrides: Partial<Keyframe> = {},
): Keyframe {
  return { time, value, easing: 'linear', ...overrides };
}
