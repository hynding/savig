// Pure-JS SVG path `d` parser: tokenizes the command string into a flat list of ABSOLUTE commands.
// Runs in jsdom + the runtime bundle (no browser SVG APIs). Relative commands fold against the
// running point; H/V become L; S/T expand to C/Q by reflecting the previous control point; Z resets
// the running point to the subpath start. Malformed input stops parsing and returns the partial list
// (never throws). A's two flags are single 0/1 chars (so "11" is large=1,sweep=1, not the number 11).

export type PathCommand =
  | { type: 'M' | 'L'; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Q'; x1: number; y1: number; x: number; y: number }
  | { type: 'A'; rx: number; ry: number; rot: number; large: boolean; sweep: boolean; x: number; y: number }
  | { type: 'Z' };

const CMD = 'MmLlHhVvCcSsQqTtAaZz';

export function parsePathD(d: string): PathCommand[] {
  const out: PathCommand[] = [];
  const n = d.length;
  let i = 0;
  let cx = 0;
  let cy = 0; // current point
  let sx = 0;
  let sy = 0; // subpath start
  let pcx = 0;
  let pcy = 0; // previous cubic control (for S)
  let pqx = 0;
  let pqy = 0; // previous quad control (for T)
  let lastCubic = false;
  let lastQuad = false;

  const isSep = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === ',';
  const skipSep = () => {
    while (i < n && isSep(d[i])) i++;
  };

  // Scan one number at i; NaN (without advancing) when none is present.
  const num = (): number => {
    skipSep();
    const s = i;
    if (i < n && (d[i] === '+' || d[i] === '-')) i++;
    let digit = false;
    while (i < n && d[i] >= '0' && d[i] <= '9') {
      i++;
      digit = true;
    }
    if (i < n && d[i] === '.') {
      i++;
      while (i < n && d[i] >= '0' && d[i] <= '9') {
        i++;
        digit = true;
      }
    }
    if (!digit) {
      i = s;
      return NaN;
    }
    if (i < n && (d[i] === 'e' || d[i] === 'E')) {
      const save = i;
      i++;
      if (i < n && (d[i] === '+' || d[i] === '-')) i++;
      let exp = false;
      while (i < n && d[i] >= '0' && d[i] <= '9') {
        i++;
        exp = true;
      }
      if (!exp) i = save; // 'e' wasn't a real exponent
    }
    return parseFloat(d.slice(s, i));
  };

  // Scan a single arc flag (0 or 1); NaN when absent.
  const flag = (): number => {
    skipSep();
    if (i < n && (d[i] === '0' || d[i] === '1')) {
      const v = d[i] === '1' ? 1 : 0;
      i++;
      return v;
    }
    return NaN;
  };

  // Does a number plausibly start at the current position (for implicit-repeat detection)?
  const numAhead = (): boolean => {
    skipSep();
    if (i >= n) return false;
    const c = d[i];
    return c === '+' || c === '-' || c === '.' || (c >= '0' && c <= '9');
  };

  while (i < n) {
    skipSep();
    if (i >= n) break;
    const ch = d[i];
    if (!CMD.includes(ch)) break; // malformed: stop, return what we have
    i++;
    const up = ch.toUpperCase();
    const rel = ch !== up;

    if (up === 'Z') {
      out.push({ type: 'Z' });
      cx = sx;
      cy = sy;
      lastCubic = lastQuad = false;
      continue;
    }

    let pair = 0; // index of the argument group within this command (for M->L implicit conversion)
    for (;;) {
      if (pair > 0 && !numAhead()) break; // no more repeats
      if (up === 'M' || up === 'L') {
        let x = num();
        let y = num();
        if (Number.isNaN(x) || Number.isNaN(y)) return out;
        if (rel) {
          x += cx;
          y += cy;
        }
        const type = up === 'M' && pair === 0 ? 'M' : 'L';
        out.push({ type, x, y });
        cx = x;
        cy = y;
        if (type === 'M') {
          sx = x;
          sy = y;
        }
        lastCubic = lastQuad = false;
      } else if (up === 'H') {
        let x = num();
        if (Number.isNaN(x)) return out;
        if (rel) x += cx;
        out.push({ type: 'L', x, y: cy });
        cx = x;
        lastCubic = lastQuad = false;
      } else if (up === 'V') {
        let y = num();
        if (Number.isNaN(y)) return out;
        if (rel) y += cy;
        out.push({ type: 'L', x: cx, y });
        cy = y;
        lastCubic = lastQuad = false;
      } else if (up === 'C') {
        let x1 = num();
        let y1 = num();
        let x2 = num();
        let y2 = num();
        let x = num();
        let y = num();
        if ([x1, y1, x2, y2, x, y].some(Number.isNaN)) return out;
        if (rel) {
          x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy;
        }
        out.push({ type: 'C', x1, y1, x2, y2, x, y });
        pcx = x2; pcy = y2;
        cx = x; cy = y;
        lastCubic = true; lastQuad = false;
      } else if (up === 'S') {
        let x2 = num();
        let y2 = num();
        let x = num();
        let y = num();
        if ([x2, y2, x, y].some(Number.isNaN)) return out;
        if (rel) {
          x2 += cx; y2 += cy; x += cx; y += cy;
        }
        const x1 = lastCubic ? 2 * cx - pcx : cx;
        const y1 = lastCubic ? 2 * cy - pcy : cy;
        out.push({ type: 'C', x1, y1, x2, y2, x, y });
        pcx = x2; pcy = y2;
        cx = x; cy = y;
        lastCubic = true; lastQuad = false;
      } else if (up === 'Q') {
        let x1 = num();
        let y1 = num();
        let x = num();
        let y = num();
        if ([x1, y1, x, y].some(Number.isNaN)) return out;
        if (rel) {
          x1 += cx; y1 += cy; x += cx; y += cy;
        }
        out.push({ type: 'Q', x1, y1, x, y });
        pqx = x1; pqy = y1;
        cx = x; cy = y;
        lastQuad = true; lastCubic = false;
      } else if (up === 'T') {
        let x = num();
        let y = num();
        if (Number.isNaN(x) || Number.isNaN(y)) return out;
        if (rel) {
          x += cx; y += cy;
        }
        const x1 = lastQuad ? 2 * cx - pqx : cx;
        const y1 = lastQuad ? 2 * cy - pqy : cy;
        out.push({ type: 'Q', x1, y1, x, y });
        pqx = x1; pqy = y1;
        cx = x; cy = y;
        lastQuad = true; lastCubic = false;
      } else if (up === 'A') {
        const rx = num();
        const ry = num();
        const rot = num();
        const large = flag();
        const sweep = flag();
        let x = num();
        let y = num();
        if ([rx, ry, rot, large, sweep, x, y].some(Number.isNaN)) return out;
        if (rel) {
          x += cx; y += cy;
        }
        out.push({ type: 'A', rx, ry, rot, large: large === 1, sweep: sweep === 1, x, y });
        cx = x; cy = y;
        lastCubic = lastQuad = false;
      }
      pair++;
    }
  }
  return out;
}
