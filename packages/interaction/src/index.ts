// @savig/interaction — pure Stage geometry/interaction math.
// INVARIANT: this package depends on @savig/engine ONLY. Do NOT import React, the
// editor store/selectors, @savig/services, or any apps/* module here — the store
// depends on this package, so a reverse import would create a cycle.
export * from './align';
export * from './correspondenceOverlay';
export * from './drawGeometry';
export * from './gridSnap';
export * from './handleMath';
export * from './pathEdit';
export * from './pathHitTest';
export * from './pickRingTarget';
export * from './pointInRings';
export * from './resizeHandles';
export * from './rotateHandle';
export * from './scaleHandles';
export * from './scaleSnap';
export * from './snapping';
export * from './spacingGuides';
export * from './stageCoords';
export * from './stageCursor';
