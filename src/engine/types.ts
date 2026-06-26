export type EasingName = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

export interface CubicBezierEasing {
  readonly type: 'cubicBezier';
  readonly p1: number;
  readonly p2: number;
  readonly p3: number;
  readonly p4: number;
}

export type Easing = EasingName | CubicBezierEasing;

export type ColorProperty = 'fill' | 'stroke';

export interface ColorKeyframe {
  /** Seconds from the start of the timeline. */
  time: number;
  /** Hex color ('#rgb' / '#rrggbb'), or 'none'. */
  value: string;
  easing: Easing;
}

export type RotationMode = 'shortest' | 'raw';

export type GeometryProperty =
  | 'width'
  | 'height'
  | 'cornerRadius'
  | 'radiusX'
  | 'radiusY';

export type AnimatableProperty =
  | 'x'
  | 'y'
  | 'scaleX'
  | 'scaleY'
  | 'rotation'
  | 'opacity'
  | GeometryProperty;

export type ResolvedGeometry = Partial<Record<GeometryProperty, number>>;

export interface Keyframe {
  /** Seconds from the start of the timeline. */
  time: number;
  value: number;
  easing: Easing;
  /** Only meaningful on the `rotation` track. Defaults to "shortest" when omitted. */
  rotationMode?: RotationMode;
}

export interface Transform2D {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
}

export type AnchorMode = 'absolute' | 'fraction';

/** Per-instance internal-timeline remap (slice 47c). */
export interface SymbolTiming {
  /** Seconds on the PARENT timeline before this instance's internal clock starts (>= 0). */
  startOffset: number;
  /** true = loop the symbol's internal timeline; false = play once and hold the last frame. */
  loop: boolean;
  /** When looping, bounce (play forward then backward) instead of wrapping. Absent/false = wrap. (47c) */
  pingPong?: boolean;
  /** Internal-clock speed multiplier (1 = real-time; must be > 0). */
  speed: number;
}

export interface SceneObject {
  id: string;
  name: string;
  assetId: string;
  zOrder: number;
  parentId?: string;
  /** True for a group CONTAINER object (slice 45): no asset, its own STATIC transform;
   *  children reference it via `parentId`. Skipped by shape rendering — its transform
   *  composes onto its children at compute time (a group has no DOM node). */
  isGroup?: boolean;
  /** When true, the object is not rendered on the Stage or in the export. */
  hidden?: boolean;
  /** When true, the object is non-interactive on the Stage (editor-only; still renders/exports). */
  locked?: boolean;
  anchorX: number;
  anchorY: number;
  /** Static values used for a property when it has no keyframes. */
  base: Transform2D;
  tracks: Partial<Record<AnimatableProperty, Keyframe[]>>;
  /** Static geometry values for vector objects when a geometry property has no keyframes. */
  shapeBase?: ResolvedGeometry;
  /** Present iff this path object is being morphed. The asset's `path` is the
   *  static base, used only when this is absent/empty. */
  shapeTrack?: ShapeKeyframe[];
  /** Per-property animated colors for vector objects. Absent property -> the asset's
   *  static VectorStyle color stands. */
  colorTracks?: Partial<Record<ColorProperty, ColorKeyframe[]>>;
  /** Per-property animated gradients for vector objects. Absent property -> the
   *  asset's static VectorStyle gradient (or solid paint) stands. A non-empty
   *  track governs that property's paint over time. */
  gradientTracks?: Partial<Record<ColorProperty, GradientKeyframe[]>>;
  /** Animated stroke-dashoffset (pathLength-normalized). A non-empty track
   *  overrides the static VectorStyle.strokeDashoffset (self-drawing effect). */
  dashOffsetTrack?: Keyframe[];
  /** When present with a non-empty progress track, the object follows this guide:
   *  x/y come from the path (overriding the x/y tracks), rotation from the tangent
   *  when orient is true. Absent -> ordinary transform. */
  motionPath?: MotionPath;
  /**
   * How anchorX/anchorY are interpreted. 'absolute' (default) = user units, as for
   * imported SVGs. 'fraction' = 0..1 of the shape bbox, resolved per-frame so the
   * pivot stays centered while geometry animates. Vector objects use 'fraction'.
   */
  anchorMode?: AnchorMode;
  /** Per-instance internal-timeline remap (slice 47c). ABSENT = identity (lockstep with the parent
   *  timeline — the 47a behaviour, so existing projects and the parity test are byte-unchanged).
   *  Only consulted when the object is a symbol instance. */
  symbolTime?: SymbolTiming;
}

export interface SvgAsset {
  id: string;
  kind: 'svg';
  name: string;
  /** id-namespaced, sanitized SVG markup. */
  normalizedContent: string;
  viewBox: string;
  width: number;
  height: number;
}

export interface AudioAsset {
  id: string;
  kind: 'audio';
  name: string;
  mimeType: string;
}

export type VectorShapeType = 'rect' | 'ellipse' | 'path';

export interface PathPoint {
  x: number;
  y: number;
}

/**
 * A path node: an anchor plus optional bezier control handles, each stored as an
 * OFFSET relative to the anchor. Absent in/out = a corner (no handle on that side).
 * A node is "smooth" when in and out are mirrored (in == -out).
 */
export interface PathNode {
  anchor: PathPoint;
  in?: PathPoint;
  out?: PathPoint;
}

export interface PathData {
  nodes: PathNode[];
  closed: boolean;
}

/** How a shape-keyframe transition reconciles differing node sets: index-pad
 *  ('corresponded', default) or arc-length cross-shape morph ('resampled'). */
export type MorphMode = 'corresponded' | 'resampled';

/**
 * One shape keyframe: a full PathData snapshot at a time, with easing into the
 * NEXT keyframe. Adjacent keyframes MAY differ in node count (reconciled by
 * `reconcile` in samplePath — index-pad by default, arc-length when morph ===
 * 'resampled'). Easing is per-keyframe (not per-node) and defaults to 'linear'.
 */
export interface ShapeKeyframe {
  time: number;
  path: PathData;
  easing: Easing;
  /** Reconciliation for the transition INTO the next keyframe. Absent = 'corresponded'
   *  (index-pad, today's behavior). 'resampled' = arc-length cross-shape morph. */
  morph?: MorphMode;
  /** Per-node easing into the next keyframe, sparse and aligned 1:1 with path.nodes.
   *  Corresponded mode only; a hole/undefined/null falls back to the keyframe `easing`. */
  nodeEasings?: Easing[];
  /** Explicit a-index → b-index node map for the transition INTO the next keyframe.
   *  Corresponded mode only; absent = identity (index-pad). Editor keeps it
   *  cyclic-order-preserving; engine guards only length/range. */
  correspondence?: number[];
}

/**
 * A motion path: the object follows `path` over the timeline, paced by `progress`
 * (a normalized 0..1 arc-length position with per-keyframe easing). Guide coordinates
 * are stage-space (same as base.x/base.y). `orient` rotates the object to the path
 * tangent. Optional on SceneObject; absent or empty `progress` = no follow.
 */
export interface MotionPath {
  path: PathData;
  orient: boolean;
  progress: Keyframe[];
}

export interface GradientStop {
  /** 0..1 position along the gradient. */
  offset: number;
  /** Hex color ('#rgb' / '#rrggbb'). */
  color: string;
  /** 0..1; omitted = 1 (fully opaque). */
  opacity?: number;
}

export interface LinearGradient {
  type: 'linear';
  /** Endpoints in objectBoundingBox units (0..1). */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stops: GradientStop[];
}

export interface RadialGradient {
  type: 'radial';
  /** Center + radius in objectBoundingBox units (0..1). */
  cx: number;
  cy: number;
  r: number;
  /** Optional focal point (defaults to center). */
  fx?: number;
  fy?: number;
  stops: GradientStop[];
}

export type Gradient = LinearGradient | RadialGradient;

export interface GradientKeyframe {
  /** Seconds from the start of the timeline. */
  time: number;
  /** A full gradient snapshot (linear or radial) at this keyframe. */
  gradient: Gradient;
  /** Governs the outbound transition from this keyframe (like ColorKeyframe). */
  easing: Easing;
}

export interface VectorStyle {
  /** CSS color, or the literal 'none'. */
  fill: string;
  /** CSS color, or the literal 'none'. */
  stroke: string;
  strokeWidth: number;
  /** Optional; render default 'butt'. */
  strokeLinecap?: 'butt' | 'round' | 'square';
  /** Optional; render default 'miter'. */
  strokeLinejoin?: 'miter' | 'round' | 'bevel';
  /** When present, fill is painted with this gradient (overrides `fill` + any fill color track). */
  fillGradient?: Gradient;
  /** When present, stroke is painted with this gradient (overrides `stroke` + any stroke color track). */
  strokeGradient?: Gradient;
  /** Dash pattern in pathLength-normalized units (0..1). Absent = solid stroke. */
  strokeDasharray?: number[];
  /** Static dash phase in pathLength-normalized units. Absent = 0. */
  strokeDashoffset?: number;
}

/** Editable parameters of a stamped polygon/star (slice 35). Lives on the vector
 *  asset; present until the path is node-edited (which detaches it). cx/cy/radius/
 *  rotation are in the asset's normalized LOCAL frame so a re-edit keeps the centre. */
export interface PrimitiveSpec {
  kind: 'polygon' | 'star';
  cx: number;
  cy: number;
  radius: number;
  rotation: number;
  sides?: number; // polygon (>=3)
  points?: number; // star (>=2)
  innerRatio?: number; // star (0..1)
  cornerRadius: number; // >=0
}

export interface VectorAsset {
  id: string; // uuid — mutable content, NOT a content hash
  kind: 'vector';
  name: string;
  shapeType: VectorShapeType;
  style: VectorStyle;
  /** Present iff shapeType === 'path'. Static this slice (node positions do not keyframe). */
  path?: PathData;
  /** Extra closed rings rendered together with `path` using fill-rule:evenodd —
   *  boolean-op results with holes/disjoint pieces (slice 46). Render/export/
   *  transform-only in v1: node-editing and morph operate on the primary `path`. */
  compoundRings?: PathData[];
  /** Present iff this path was stamped as a polygon/star and not yet node-edited (slice 35). */
  primitive?: PrimitiveSpec;
}

/** A reusable, self-contained animated scene (Flash "MovieClip"). Instanced by ordinary
 *  SceneObjects whose `assetId` points here — exactly as an SVG-asset object points at an
 *  SvgAsset. Editing this definition propagates to every instance (they share it). The
 *  instance-composition engine (`flattenInstances`) expands an instance into this scene's
 *  objects at compute time, composing the instance transform + opacity (slice 47a). */
export interface SymbolAsset {
  id: string; // uuid
  kind: 'symbol';
  name: string;
  /** The symbol's own scene graph. Reuses SceneObject + the timeline machinery; `parentId`
   *  references resolve WITHIN this list (groups inside a symbol work unchanged). */
  objects: SceneObject[];
  /** Intrinsic content size (library thumbnail / future clip). Not a hard clip in 47a. */
  width: number;
  height: number;
  /** The symbol's manual timeline-length override (seconds). 0 = AUTO: the effective duration is the
   *  intrinsic `objectsMaxKeyframeTime(objects)`. > 0 = the symbol's effective loop/clip length, used
   *  by `symbolEffectiveDuration` in the flattenInstances time remap (47c manual-override). */
  duration: number;
}

export type Asset = SvgAsset | AudioAsset | VectorAsset | SymbolAsset;

export interface AudioClip {
  id: string;
  assetId: string;
  /** Timeline time (seconds) at which the clip begins. */
  startTime: number;
  /** Source in-point (seconds into the audio asset). */
  inPoint: number;
  /** Source out-point (seconds into the audio asset). */
  outPoint: number;
  /** 0..1 linear gain. */
  volume: number;
}

export type DurationMode = 'auto' | 'manual';

export interface ProjectMeta {
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  durationMode: DurationMode;
  loop: boolean;
  version: number;
}

export interface Project {
  meta: ProjectMeta;
  assets: Asset[];
  objects: SceneObject[];
  audioClips: AudioClip[];
}
