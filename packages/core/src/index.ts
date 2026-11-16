/** `@savig/core` — the headless, store-free authoring surface for agents / SDK / MCP / CLI.
 *
 * Pure functions over `Project` (the engine document); no React, no Zustand, no DOM. The editor's
 * Zustand store wraps the same engine for humans; this is the programmatic API. See the
 * M5 (Agent Authoring) design spec. v1 = slice 1: id-addressed builders + describe + validate. */
export { createIdFactory } from './ids';
export { addRect, addEllipse, addPath, addText, setKeyframe, setTrim, setTrimKeyframe, setRepeat, setBaseTransform, setAnchor, removeObjects, outlineStrokePath, blendPaths, addAudioTrack, addAudioClip, setClipFades, setTrackEffect, addBehavior, updateBehavior, removeBehavior, setVariable, removeVariable } from './build';
export { describeProject } from './describe';
export { validateProject, type ValidationIssue } from './validate';
export {
  compileShort,
  decompileProject,
  type ShortDoc,
  type ShortObject,
  type ShortShape,
  type ShortFrames,
  type ShortTween,
  type ShortRect,
  type ShortEllipse,
  type ShortPath,
  type ShortText,
  type ShortImage,
  type ShortAnimate,
  type ShortKeyframe,
  type ShortCamera,
  type ShortTrim,
  type ShortAudio,
  type ShortAudioClip,
  type ShortBehavior,
  type ShortInteractions,
} from './dsl';
export { fadeIn, fadeOut, moveTo, scaleTo, rotateTo, spin, pulse, drawOn, stagger, motionPreset, saveMotionPreset, exportPresetPack, importPresetPack, type TimingOpts } from './macros';
export { BUILTIN_MOTION_PRESETS, type MotionPreset } from '@savig/engine';
export { setCamera, setCameraKeyframe, panTo, zoomTo, kenBurns } from './camera';
export { addFrameLayer, putInFrameKey, frameKeyAtTime, addFrameKey, insertFrames, removeFrames, clearFrameKey, flipbook, shapeTween, removeShapeTween, type FrameLayerOpts } from './frames';
export { createMask, releaseMask, unmask, reveal, setMaskStyle, type MaskStyleOpts, type RevealOpts, type RevealStyle, type RevealFrom } from './masks';
export { addFilter, setFilter, removeFilter, setFilterKeyframe, animateFilter, type FilterSpec } from './filters';
export { addImage, addImageSequence, setGuide, type ImageOpts, type ImageSequenceInput } from './images';
export { setBlendMode } from './blend';
export { setCameraModifier, setModifier, type ModifierInput } from './modifiers';
export { paintBucket, erase, type PaintBucketOpts, type PaintBucketResult, type EraseOpts, type EraseResult } from './paintBucket';
export { addBone, attachToBone, poseIK, setBoneRotation, setBoneSpring, bindSkin, unbindSkin, type BoneOpts, type SpringOpts } from './bones';
export { bakeProjectSprings } from '@savig/engine';
export { templates, getTemplate, type Template } from './templates';
// Lottie JSON (spec 2026-11-15-lottie-export): pure, so it lives here rather than in core/node.
export { exportLottie, type LottieAnimation, type LottieExportResult } from '@savig/services';

export { addScene, removeScene, reorderScene, setSceneDuration, setSceneTransition, withScene } from './scenes';

// Re-export the engine's project constructor + core types so a caller imports everything from here.
export { createProject } from '@savig/engine';
export type { Project, SceneObject, PathData, VectorStyle, AnimatableProperty, Easing, Transform2D, RepeatSpec } from '@savig/engine';
export { setTextAnimation, type TextAnimationInput } from './textAnimator';
