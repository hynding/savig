/** Minimal ambient types for `gifenc` (it ships no declarations) — only the surface used by
 *  src/core/gif.ts. See https://github.com/mattdesl/gifenc */
declare module 'gifenc' {
  export type Palette = number[][];

  export function quantize(rgba: Uint8Array, maxColors: number, opts?: Record<string, unknown>): Palette;
  export function applyPalette(rgba: Uint8Array, palette: Palette, format?: string): Uint8Array;

  export interface GifEncoderInstance {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: { palette?: Palette; delay?: number; repeat?: number; transparent?: boolean; dispose?: number },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  }
  export function GIFEncoder(opts?: { auto?: boolean }): GifEncoderInstance;
}
