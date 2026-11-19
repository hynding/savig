// @savig/core/node — Node-only rasterization surface (native deps).
export { renderFrameSvg, renderFramePng, renderFrameRgba, renderThumbnail, renderFrames, type RasterOpts } from './node/render';
export { renderGif, type GifOpts } from './node/gif';
export { renderSpriteSheet, encodePng, type SpriteSheetRenderOpts, type SpriteSheetRender } from './node/spriteSheet';
export { renderAnimatedSvgNode, renderCssSvgNode } from './node/animatedSvg';
export { decodeImageAsset, traceImageObject, TRACE_MAX_SIDE } from './node/trace';
