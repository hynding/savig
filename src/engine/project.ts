import type {
  GeometryProperty,
  Keyframe,
  Project,
  ProjectMeta,
  SceneObject,
  Transform2D,
  VectorAsset,
  VectorShapeType,
  VectorStyle,
} from './types';

export const ANIMATABLE_PROPERTIES: readonly (keyof Transform2D)[] = [
  'x',
  'y',
  'scaleX',
  'scaleY',
  'rotation',
  'opacity',
] as const;

export const GEOMETRY_PROPERTIES: readonly GeometryProperty[] = [
  'width',
  'height',
  'cornerRadius',
  'radiusX',
  'radiusY',
] as const;

export const DEFAULT_TRANSFORM: Transform2D = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
};

export const DEFAULT_VECTOR_STYLE: VectorStyle = {
  fill: '#cccccc',
  stroke: 'none',
  strokeWidth: 0,
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
    version: 2,
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

export function createVectorAsset(
  shapeType: VectorShapeType,
  overrides: Partial<VectorAsset> = {},
): VectorAsset {
  return {
    id: newId(),
    kind: 'vector',
    name: shapeType === 'rect' ? 'Rectangle' : 'Ellipse',
    shapeType,
    style: { ...DEFAULT_VECTOR_STYLE },
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
