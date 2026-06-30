/** `@savig/core` — the headless, store-free authoring surface for agents / SDK / MCP / CLI.
 *
 * Pure functions over `Project` (the engine document); no React, no Zustand, no DOM. The editor's
 * Zustand store wraps the same engine for humans; this is the programmatic API. See the
 * M5 (Agent Authoring) design spec. v1 = slice 1: id-addressed builders + describe + validate. */
export { createIdFactory } from './ids';
export { addRect, addEllipse, addPath, addText, setKeyframe, setBaseTransform, removeObjects } from './build';
export { describeProject } from './describe';
export { validateProject, type ValidationIssue } from './validate';
export { renderFrameSvg, renderFramePng, renderFrameRgba, renderThumbnail, renderFrames, type RasterOpts } from './render';
export { renderGif, type GifOpts } from './gif';
export {
  compileShort,
  decompileProject,
  type ShortDoc,
  type ShortObject,
  type ShortRect,
  type ShortEllipse,
  type ShortPath,
  type ShortText,
  type ShortAnimate,
  type ShortKeyframe,
  type ShortCamera,
} from './dsl';
export { fadeIn, fadeOut, moveTo, scaleTo, rotateTo, spin, pulse, stagger, type TimingOpts } from './macros';
export { setCamera, setCameraKeyframe, panTo, zoomTo, kenBurns } from './camera';
export { templates, getTemplate, type Template } from './templates';

export { addScene, removeScene, reorderScene, setSceneDuration, setSceneTransition, withScene } from './scenes';

// Re-export the engine's project constructor + core types so a caller imports everything from here.
export { createProject } from '../engine';
export type { Project, SceneObject, PathData, VectorStyle, AnimatableProperty, Easing, Transform2D } from '../engine';
