import type {
  AnimatableProperty,
  GeometryProperty,
  Keyframe,
  PrimitiveProperty,
  Project,
  ProjectMeta,
  SceneObject,
  SymbolAsset,
  TextAsset,
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

// The animatable primitive-param track keys, EXCLUDING 'cornerRadius' (shared with
// GEOMETRY_PROPERTIES above, so it isn't duplicated here). Consumers that need the full
// five-key set (sides/starPoints/innerRatio/primitiveRotation/cornerRadius) — e.g.
// omitPrimitiveTracks in @savig/editor-state's store.ts, and sample.ts's per-param
// primitive-path regeneration — spread this plus 'cornerRadius'.
export const PRIMITIVE_PROPERTIES: readonly PrimitiveProperty[] = [
  'sides',
  'starPoints',
  'innerRatio',
  'primitiveRotation',
] as const;

/** Every `AnimatableProperty` name, for runtime validation at the `setKeyframe` boundary (typo'd
 *  property strings from the MCP tool / DSL `animate` object would otherwise silently create a
 *  dead track — nothing ever reads it back). `'textPathOffset'` isn't grouped with the arrays
 *  above (it has no dedicated runtime array of its own), so it's appended directly.
 *
 *  NOTE: kept un-annotated (`as const`, no `: readonly AnimatableProperty[]`) so the compile-time
 *  exhaustiveness pin below actually narrows to the literal members present — an explicit
 *  `AnimatableProperty[]` annotation here would widen the array's inferred type to
 *  `AnimatableProperty` itself, making the pin trivially pass even with a member missing. */
const _all = [
  ...ANIMATABLE_PROPERTIES,
  ...GEOMETRY_PROPERTIES,
  ...PRIMITIVE_PROPERTIES,
  'textPathOffset',
] as const;

// Compile-time pin: if `AnimatableProperty` (types.ts) grows a member not included in `_all`
// above, this assignment fails to type-check ("Type 'true' is not assignable to type 'never'").
// Keeps the runtime validator honest without a duplicated literal list to fall out of sync.
type _Covered = (typeof _all)[number];
const _exhaustive: [AnimatableProperty] extends [_Covered] ? true : never = true;
void _exhaustive;

export const ALL_ANIMATABLE_PROPERTIES: readonly AnimatableProperty[] = _all;

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
    version: 5,
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

/** A group CONTAINER object (slice 45): no asset, its own static transform; children
 *  reference it via `parentId`. `anchorX/anchorY` are ABSOLUTE artboard coords (the group
 *  pivot — the children's bbox centre at creation). */
export function createGroupObject(
  opts: { id: string; name?: string; anchorX: number; anchorY: number; zOrder: number },
): SceneObject {
  return {
    id: opts.id,
    name: opts.name ?? 'Group',
    assetId: '',
    isGroup: true,
    zOrder: opts.zOrder,
    anchorX: opts.anchorX,
    anchorY: opts.anchorY,
    base: { ...DEFAULT_TRANSFORM },
    tracks: {},
  };
}

export function createVectorAsset(
  shapeType: VectorShapeType,
  overrides: Partial<VectorAsset> = {},
): VectorAsset {
  return {
    id: newId(),
    kind: 'vector',
    name: shapeType === 'rect' ? 'Rectangle' : shapeType === 'ellipse' ? 'Ellipse' : 'Path',
    shapeType,
    style: { ...DEFAULT_VECTOR_STYLE },
    ...overrides,
  };
}

export function createSymbolAsset(overrides: Partial<SymbolAsset> = {}): SymbolAsset {
  return {
    id: newId(),
    kind: 'symbol',
    name: 'Symbol',
    objects: [],
    width: 0,
    height: 0,
    duration: 0,
    ...overrides,
  };
}

export function createTextAsset(overrides: Partial<TextAsset> = {}): TextAsset {
  return {
    id: newId(),
    kind: 'text',
    name: 'Text',
    content: 'Text',
    fontSize: 48,
    fill: '#000000',
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
