// Shared coordinate ports for the interaction controllers (slice 5). Coordinate conversion
// (client → stage/object-local, via the SVG CTM) is inherently DOM-bound, so it stays in the app
// adapter and is injected into the controllers as a LAZY thunk: the controller calls it only
// after its own guards, so no CTM work runs on pointer moves the controller doesn't handle (this
// also avoids `getScreenCTM` throwing under jsdom on unrelated moves). A `null` result means the
// pointer is outside the drawable area / the CTM is unavailable.
import type { Point } from '@savig/interaction';

export type { Point };

/** Lazily resolve the current pointer to a stage/object-local point (`null` = unavailable). */
export type GetPoint = () => Point | null;
