# Savig Services Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the framework-agnostic services layer that bridges the pure engine to the browser — SVG/audio import, deterministic HTML5 export with a shared standalone runtime, `.savig` persistence with migrations + IndexedDB autosave, and a decoupled Web Audio playback engine.

**Architecture:** Services are pure or thin-wrapper modules over plain data and a small set of mockable browser APIs (`DOMParser`, `IndexedDB`, `AudioContext`). They consume the engine's pure sampling/transform/audio-timing functions (Plan 1) and never touch React. Export compiles the **same engine modules** into a standalone runtime so the exported bundle animates byte-for-byte like the editor preview. This is **Plan 2 of 3** for Milestone 1 (Engine → Services → UI).

**Tech Stack:** TypeScript (strict), Vitest (jsdom env for services), `fflate` (zip), `fake-indexeddb` (tests), `esbuild` (build-time runtime bundling), pnpm.

## Global Constraints

- Package manager: **pnpm** (v10+). Never invoke `npm`/`yarn`.
- Language: **TypeScript strict mode** (`"strict": true`, `noUnusedLocals`, `noUnusedParameters`).
- The `src/engine/**` directory keeps **zero imports of React or DOM APIs** — do not add DOM usage to it. DOM lives only in `src/services/**` and `src/runtime/**`.
- `src/runtime/**` imports **only** from `src/engine/**` (the shared core) and uses only browser globals available in an exported bundle — no Node, no React, no `src/services`.
- Methodology: **TDD** — write the failing test, see it fail, write minimal code, see it pass, commit. **One logical change per commit.**
- All pure service functions are **immutable**: they never mutate their `Project`/`Keyframe` arguments (DOM nodes built internally may be mutated).
- Export output (`index.html`) must be **byte-stable**: sorted ids, sorted object/asset iteration, rounded numbers (engine `fmt`), stable JSON key order, no timestamps/randomness — so golden-file tests don't flake.
- Content addressing: asset ids and SVG id-namespace prefixes are **content hashes** so re-importing an identical file dedupes.
- Every commit message ends with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## File Structure

```
savig/
├── package.json                         # +fflate dep; +fake-indexeddb,+esbuild dev; +build:runtime (Task 1)
├── vite.config.ts                       # services+runtime → jsdom test env (Task 1)
├── src/test-setup.ts                    # install fake-indexeddb for tests (Task 1)
├── scripts/
│   └── build-runtime.mjs                # esbuild bundles engine+player → committed JS string module (Task 11)
└── src/
    ├── services/
    │   ├── index.ts                     # barrel (Task 17)
    │   ├── index.test.ts                # end-to-end integration (Task 17)
    │   ├── hash.ts                      # hashContent (Task 2)
    │   ├── hash.test.ts                 # (Task 2)
    │   ├── bytes.ts                     # bytesToBase64 / base64ToBytes (Task 2)
    │   ├── bytes.test.ts                # (Task 2)
    │   ├── json.ts                      # stableJson (Task 2)
    │   ├── json.test.ts                 # (Task 2)
    │   ├── errors.ts                    # service error classes (Task 2)
    │   ├── import/
    │   │   ├── sanitizeSvg.ts           # strip script/SMIL/css-anim/foreignObject/handlers (Task 3)
    │   │   ├── sanitizeSvg.test.ts      # (Task 3)
    │   │   ├── namespaceIds.ts          # id + url(#)/href rewrite (Task 4)
    │   │   ├── namespaceIds.test.ts     # (Task 4)
    │   │   ├── importSvg.ts             # parse → sanitize → namespace → SvgAsset (Task 5)
    │   │   ├── importSvg.test.ts        # (Task 5)
    │   │   ├── importAudio.ts           # validate + hash → AudioAsset (Task 6)
    │   │   └── importAudio.test.ts      # (Task 6)
    │   ├── export/
    │   │   ├── renderDocument.ts        # inline <svg> with <defs>+<use> (Task 7)
    │   │   ├── renderDocument.test.ts   # golden (Task 7)
    │   │   ├── buildBundle.ts           # index.html + runtime ref + base64 audio (Task 8)
    │   │   ├── buildBundle.test.ts      # golden + missing-asset (Task 8)
    │   │   ├── zipBundle.ts             # fflate zip the files map (Task 9)
    │   │   ├── zipBundle.test.ts        # round-trip (Task 9)
    │   │   ├── exportProject.ts         # production export using real runtime (Task 11)
    │   │   └── exportProject.test.ts    # (Task 11)
    │   ├── persistence/
    │   │   ├── savig.ts                 # save/load .savig zip (Task 12)
    │   │   ├── savig.test.ts            # round-trip (Task 12)
    │   │   ├── migrate.ts               # migration registry + version guard (Task 13)
    │   │   ├── migrate.test.ts          # (Task 13)
    │   │   ├── autosave.ts              # IndexedDB autosave store (Task 14)
    │   │   ├── autosave.test.ts         # (Task 14)
    │   │   ├── fileAccess.ts            # File System Access + fallback (Task 15)
    │   │   └── fileAccess.test.ts       # (Task 15)
    │   └── audio/
    │       ├── audioEngine.ts           # Web Audio scheduling over AudioContextLike (Task 16)
    │       └── audioEngine.test.ts      # (Task 16)
    └── runtime/
        ├── index.ts                     # standalone player (engine + DOM glue + audio) (Task 10)
        ├── frame.ts                     # computeFrame(project,t) — shared by player + parity test (Task 10)
        ├── frame.test.ts                # runtime↔engine parity (Task 10)
        └── runtimeSource.generated.ts   # committed bundled-runtime string (Task 11, generated)
```

**Test running convention:** run a single file with `pnpm exec vitest run <file>`; a single named test with `pnpm exec vitest run <file> -t "<name>"`. Run everything with `pnpm test`. Typecheck with `pnpm typecheck`; lint with `pnpm lint`.

---

## Task 1: Services toolchain & test environment

**Files:**
- Modify: `package.json` (deps + script), `vite.config.ts` (test env globs), `src/test-setup.ts` (fake-indexeddb)
- Create: `src/services/env.test.ts` (smoke test)

**Interfaces:**
- Consumes: nothing.
- Produces: `fflate` available as a runtime dependency; `fake-indexeddb` + `esbuild` as dev deps; Vitest runs `src/services/**` and `src/runtime/**` under `jsdom`; `indexedDB` global present in tests; a `build:runtime` npm script placeholder.

- [ ] **Step 1: Add dependencies**

Run:
```bash
pnpm add fflate
pnpm add -D fake-indexeddb esbuild
```
Expected: `fflate` appears under `dependencies`; `fake-indexeddb` and `esbuild` under `devDependencies` in `package.json`.

- [ ] **Step 2: Add the `build:runtime` script**

In `package.json`, add to `"scripts"` (keep existing scripts):
```json
    "build:runtime": "node scripts/build-runtime.mjs",
```

- [ ] **Step 3: Route services + runtime tests to jsdom**

Replace the `environmentMatchGlobs` line in `vite.config.ts`:
```ts
    environmentMatchGlobs: [
      ['src/ui/**', 'jsdom'],
      ['src/services/**', 'jsdom'],
      ['src/runtime/**', 'jsdom'],
    ],
```

- [ ] **Step 4: Install fake-indexeddb for tests**

Append to `src/test-setup.ts`:
```ts
import 'fake-indexeddb/auto';
```

- [ ] **Step 5: Write the env smoke test**

Create `src/services/env.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

describe('services test environment', () => {
  it('provides DOMParser (jsdom)', () => {
    const doc = new DOMParser().parseFromString('<svg/>', 'image/svg+xml');
    expect(doc.documentElement.tagName).toBe('svg');
  });

  it('provides indexedDB (fake-indexeddb)', () => {
    expect(typeof indexedDB).toBe('object');
    expect(indexedDB).not.toBeNull();
  });

  it('round-trips bytes through fflate', () => {
    const zipped = zipSync({ 'a.txt': strToU8('hello') });
    const out = unzipSync(zipped);
    expect(strFromU8(out['a.txt'])).toBe('hello');
  });
});
```

- [ ] **Step 6: Run the smoke test**

Run: `pnpm exec vitest run src/services/env.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Verify the whole suite + typecheck still pass**

Run: `pnpm test && pnpm typecheck`
Expected: all engine + UI + new tests PASS; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml vite.config.ts src/test-setup.ts src/services/env.test.ts
git commit -m "chore(services): add fflate/fake-indexeddb/esbuild + jsdom test env

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Shared utilities — hashing, base64, stable JSON, errors

**Files:**
- Create: `src/services/hash.ts`, `src/services/hash.test.ts`, `src/services/bytes.ts`, `src/services/bytes.test.ts`, `src/services/json.ts`, `src/services/json.test.ts`, `src/services/errors.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `hashContent(data: string | Uint8Array): string` — 8-char lowercase hex, stable across runs.
  - `bytesToBase64(bytes: Uint8Array): string`, `base64ToBytes(b64: string): Uint8Array`.
  - `stableJson(value: unknown): string` — JSON with recursively sorted object keys.
  - Error classes `SvgImportError`, `AudioImportError`, `MissingAssetError`, `SavigLoadError`, `UnsupportedVersionError` (all extend `Error`, set `.name`).

- [ ] **Step 1: Write failing tests for hashing**

Create `src/services/hash.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { hashContent } from './hash';

describe('hashContent', () => {
  it('is deterministic and 8 hex chars', () => {
    const h = hashContent('hello world');
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(hashContent('hello world')).toBe(h);
  });

  it('differs for different content', () => {
    expect(hashContent('a')).not.toBe(hashContent('b'));
  });

  it('hashes strings and bytes equivalently for ASCII', () => {
    expect(hashContent('abc')).toBe(hashContent(new Uint8Array([97, 98, 99])));
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `pnpm exec vitest run src/services/hash.test.ts`
Expected: FAIL — cannot find module `./hash`.

- [ ] **Step 3: Implement `hash.ts`**

Create `src/services/hash.ts`:
```ts
// FNV-1a 32-bit content hash. Not cryptographic — used only for
// content-addressed dedupe and SVG id namespacing in M1.
export function hashContent(data: string | Uint8Array): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  // >>> 0 coerces to unsigned 32-bit; pad to a fixed 8-char hex string.
  return (hash >>> 0).toString(16).padStart(8, '0');
}
```

- [ ] **Step 4: Run hashing tests, verify pass**

Run: `pnpm exec vitest run src/services/hash.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write failing tests for bytes**

Create `src/services/bytes.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64 } from './bytes';

describe('base64 round-trip', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255, 128, 127]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('encodes empty input as empty string', () => {
    expect(bytesToBase64(new Uint8Array([]))).toBe('');
    expect(base64ToBytes('')).toEqual(new Uint8Array([]));
  });
});
```

- [ ] **Step 6: Run it, verify failure**

Run: `pnpm exec vitest run src/services/bytes.test.ts`
Expected: FAIL — cannot find module `./bytes`.

- [ ] **Step 7: Implement `bytes.ts`**

Create `src/services/bytes.ts`:
```ts
// Chunked to avoid blowing the argument limit of String.fromCharCode on
// large audio buffers. Uses btoa/atob (present in jsdom and browsers).
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
```

- [ ] **Step 8: Run bytes tests, verify pass**

Run: `pnpm exec vitest run src/services/bytes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Write failing tests for stable JSON**

Create `src/services/json.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { stableJson } from './json';

describe('stableJson', () => {
  it('sorts object keys recursively', () => {
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('preserves array order', () => {
    expect(stableJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('produces identical output regardless of key insertion order', () => {
    expect(stableJson({ x: 1, y: 2 })).toBe(stableJson({ y: 2, x: 1 }));
  });
});
```

- [ ] **Step 10: Run it, verify failure**

Run: `pnpm exec vitest run src/services/json.test.ts`
Expected: FAIL — cannot find module `./json`.

- [ ] **Step 11: Implement `json.ts`**

Create `src/services/json.ts`:
```ts
// Deterministic JSON: object keys sorted recursively so exported markup and
// .savig payloads are byte-stable across runs and machines.
export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
```

- [ ] **Step 12: Run json tests, verify pass**

Run: `pnpm exec vitest run src/services/json.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 13: Implement the error classes**

Create `src/services/errors.ts`:
```ts
// Distinct error types so callers (UI toasts in Plan 3) can branch on cause.
export class SvgImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SvgImportError';
  }
}

export class AudioImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudioImportError';
  }
}

export class MissingAssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingAssetError';
  }
}

export class SavigLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SavigLoadError';
  }
}

export class UnsupportedVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedVersionError';
  }
}
```

- [ ] **Step 14: Typecheck and commit**

Run: `pnpm exec vitest run src/services/hash.test.ts src/services/bytes.test.ts src/services/json.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean.
```bash
git add src/services/hash.ts src/services/hash.test.ts src/services/bytes.ts src/services/bytes.test.ts src/services/json.ts src/services/json.test.ts src/services/errors.ts
git commit -m "feat(services): add hash, base64, stable JSON, and error utilities

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: SVG sanitization

**Files:**
- Create: `src/services/import/sanitizeSvg.ts`, `src/services/import/sanitizeSvg.test.ts`

**Interfaces:**
- Consumes: nothing (operates on a DOM `Element`).
- Produces: `sanitizeSvgElement(svg: Element): string[]` — mutates `svg` in place to remove unsafe/animated content; returns human-readable warning strings (e.g. for stripped `<foreignObject>`).

- [ ] **Step 1: Write the failing tests**

Create `src/services/import/sanitizeSvg.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { sanitizeSvgElement } from './sanitizeSvg';

function parse(svg: string): Element {
  return new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
}

describe('sanitizeSvgElement', () => {
  it('removes <script> elements', () => {
    const el = parse('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>');
    sanitizeSvgElement(el);
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('rect')).not.toBeNull();
  });

  it('removes SMIL animation elements', () => {
    const el = parse('<svg xmlns="http://www.w3.org/2000/svg"><rect><animate attributeName="x"/></rect><animateTransform/></svg>');
    sanitizeSvgElement(el);
    expect(el.querySelector('animate')).toBeNull();
    expect(el.querySelector('animateTransform')).toBeNull();
  });

  it('removes inline event handler attributes', () => {
    const el = parse('<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="x()" onload="y()"/></svg>');
    sanitizeSvgElement(el);
    const rect = el.querySelector('rect')!;
    expect(rect.hasAttribute('onclick')).toBe(false);
    expect(rect.hasAttribute('onload')).toBe(false);
  });

  it('strips external http(s) href/xlink:href but keeps internal #refs', () => {
    const el = parse('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="https://evil.example/x.svg"/><use href="#local"/></svg>');
    sanitizeSvgElement(el);
    const uses = el.querySelectorAll('use');
    expect(uses[0].hasAttribute('xlink:href')).toBe(false);
    expect(uses[1].getAttribute('href')).toBe('#local');
  });

  it('removes <foreignObject> and warns', () => {
    const el = parse('<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>');
    const warnings = sanitizeSvgElement(el);
    expect(el.querySelector('foreignObject')).toBeNull();
    expect(warnings.some((w) => /foreignObject/i.test(w))).toBe(true);
  });

  it('strips @keyframes and animation declarations from <style>', () => {
    const el = parse('<svg xmlns="http://www.w3.org/2000/svg"><style>@keyframes spin{from{}to{}} .a{fill:red;animation:spin 1s;}</style></svg>');
    sanitizeSvgElement(el);
    const css = el.querySelector('style')!.textContent ?? '';
    expect(css).not.toMatch(/@keyframes/);
    expect(css).not.toMatch(/animation/);
    expect(css).toMatch(/fill:\s*red/);
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `pnpm exec vitest run src/services/import/sanitizeSvg.test.ts`
Expected: FAIL — cannot find module `./sanitizeSvg`.

- [ ] **Step 3: Implement `sanitizeSvg.ts`**

Create `src/services/import/sanitizeSvg.ts`:
```ts
const FORBIDDEN_TAGS = ['script', 'foreignObject'];
const SMIL_TAGS = ['animate', 'animateTransform', 'animateMotion', 'set', 'mpath'];
const REF_ATTRS = ['href', 'xlink:href', 'src'];

// Remove animation/handler/script content and external references so the
// SVG is safe to inline into one document. Mutates `svg`; returns warnings.
export function sanitizeSvgElement(svg: Element): string[] {
  const warnings: string[] = [];

  for (const tag of [...FORBIDDEN_TAGS, ...SMIL_TAGS]) {
    const matches = svg.querySelectorAll(tag);
    if (matches.length > 0 && tag === 'foreignObject') {
      warnings.push(`Removed unsupported <foreignObject> (${matches.length}).`);
    }
    matches.forEach((node) => node.remove());
  }

  const all = [svg, ...Array.from(svg.querySelectorAll('*'))];
  for (const el of all) {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (REF_ATTRS.includes(attr.name) && /^\s*(https?:|\/\/)/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  }

  for (const style of Array.from(svg.querySelectorAll('style'))) {
    style.textContent = stripCssAnimations(style.textContent ?? '');
  }

  return warnings;
}

function stripCssAnimations(css: string): string {
  // Drop @keyframes blocks and any `animation`/`animation-*` declarations.
  let out = css.replace(/@(-\w+-)?keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gi, '');
  out = out.replace(/(^|[;{])\s*animation(-[\w-]+)?\s*:[^;}]*;?/gi, '$1');
  return out.trim();
}
```

- [ ] **Step 4: Run the tests, verify pass**

Run: `pnpm exec vitest run src/services/import/sanitizeSvg.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/import/sanitizeSvg.ts src/services/import/sanitizeSvg.test.ts
git commit -m "feat(services): sanitize imported SVG (scripts, SMIL, handlers, CSS anim)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: SVG id namespacing

**Files:**
- Create: `src/services/import/namespaceIds.ts`, `src/services/import/namespaceIds.test.ts`

**Interfaces:**
- Consumes: nothing (operates on a DOM `Element`).
- Produces: `namespaceIds(svg: Element, prefix: string): void` — mutates `svg`: rewrites every `id` to `${prefix}__${id}` and updates all references (`url(#id)` in any attribute or inline style, and `href`/`xlink:href="#id"`).

- [ ] **Step 1: Write the failing tests**

Create `src/services/import/namespaceIds.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { namespaceIds } from './namespaceIds';

function parse(svg: string): Element {
  return new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
}

describe('namespaceIds', () => {
  it('prefixes id attributes', () => {
    const el = parse('<svg xmlns="http://www.w3.org/2000/svg"><linearGradient id="g1"/></svg>');
    namespaceIds(el, 'a3f2');
    expect(el.querySelector('linearGradient')!.getAttribute('id')).toBe('a3f2__g1');
  });

  it('rewrites url(#id) references in attributes', () => {
    const el = parse('<svg xmlns="http://www.w3.org/2000/svg"><linearGradient id="g1"/><rect fill="url(#g1)"/></svg>');
    namespaceIds(el, 'a3f2');
    expect(el.querySelector('rect')!.getAttribute('fill')).toBe('url(#a3f2__g1)');
  });

  it('rewrites url(#id) inside inline style', () => {
    const el = parse('<svg xmlns="http://www.w3.org/2000/svg"><clipPath id="c"/><rect style="clip-path:url(#c)"/></svg>');
    namespaceIds(el, 'a3f2');
    expect(el.querySelector('rect')!.getAttribute('style')).toContain('url(#a3f2__c)');
  });

  it('rewrites href and xlink:href hash references', () => {
    const el = parse('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><rect id="r"/><use href="#r"/><use xlink:href="#r"/></svg>');
    namespaceIds(el, 'a3f2');
    const uses = el.querySelectorAll('use');
    expect(uses[0].getAttribute('href')).toBe('#a3f2__r');
    expect(uses[1].getAttribute('xlink:href')).toBe('#a3f2__r');
  });

  it('does not touch unrelated attributes', () => {
    const el = parse('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="red"/></svg>');
    namespaceIds(el, 'a3f2');
    expect(el.querySelector('rect')!.getAttribute('fill')).toBe('red');
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `pnpm exec vitest run src/services/import/namespaceIds.test.ts`
Expected: FAIL — cannot find module `./namespaceIds`.

- [ ] **Step 3: Implement `namespaceIds.ts`**

Create `src/services/import/namespaceIds.ts`:
```ts
// Inlining multiple SVGs into one document collides their internal ids,
// silently corrupting gradients/filters/clip-paths/<use>. Namespacing every
// id by a per-asset prefix and rewriting all references fixes this.
export function namespaceIds(svg: Element, prefix: string): void {
  const all = [svg, ...Array.from(svg.querySelectorAll('*'))];

  const idMap = new Map<string, string>();
  for (const el of all) {
    const id = el.getAttribute('id');
    if (id) {
      const next = `${prefix}__${id}`;
      idMap.set(id, next);
      el.setAttribute('id', next);
    }
  }
  if (idMap.size === 0) return;

  const rewrite = (value: string): string =>
    value
      .replace(/url\(\s*#([^)\s]+)\s*\)/g, (m, id) =>
        idMap.has(id) ? `url(#${idMap.get(id)})` : m,
      )
      .replace(/^#([^\s]+)$/, (m, id) => (idMap.has(id) ? `#${idMap.get(id)}` : m));

  for (const el of all) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name === 'id') continue;
      const next = rewrite(attr.value);
      if (next !== attr.value) el.setAttribute(attr.name, next);
    }
  }
}
```

- [ ] **Step 4: Run the tests, verify pass**

Run: `pnpm exec vitest run src/services/import/namespaceIds.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/import/namespaceIds.ts src/services/import/namespaceIds.test.ts
git commit -m "feat(services): namespace SVG ids and rewrite references

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: SVG import pipeline

**Files:**
- Create: `src/services/import/importSvg.ts`, `src/services/import/importSvg.test.ts`

**Interfaces:**
- Consumes: `hashContent` (Task 2), `SvgImportError` (Task 2), `sanitizeSvgElement` (Task 3), `namespaceIds` (Task 4); `SvgAsset` type (engine).
- Produces:
  - `interface SvgImportResult { asset: SvgAsset; warnings: string[] }`
  - `importSvg(source: string, name: string): SvgImportResult` — parses, sanitizes, namespaces (prefix = content hash), captures `viewBox`/`width`/`height`, serializes to `normalizedContent`; throws `SvgImportError` on malformed input.

- [ ] **Step 1: Write the failing tests**

Create `src/services/import/importSvg.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { SvgImportError } from '../errors';
import { importSvg } from './importSvg';

describe('importSvg', () => {
  it('produces a content-addressed asset with namespaced ids', () => {
    const { asset } = importSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 20"><linearGradient id="g"/><rect fill="url(#g)"/></svg>',
      'logo.svg',
    );
    expect(asset.kind).toBe('svg');
    expect(asset.name).toBe('logo.svg');
    expect(asset.viewBox).toBe('0 0 10 20');
    expect(asset.id).toMatch(/^[0-9a-f]{8}$/);
    expect(asset.normalizedContent).toContain(`${asset.id}__g`);
    expect(asset.normalizedContent).toContain(`url(#${asset.id}__g)`);
  });

  it('dedupes identical content to the same id', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect/></svg>';
    expect(importSvg(svg, 'a.svg').asset.id).toBe(importSvg(svg, 'b.svg').asset.id);
  });

  it('derives width/height from viewBox when missing', () => {
    const { asset } = importSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 40"><rect/></svg>', 'x.svg');
    expect(asset.width).toBe(30);
    expect(asset.height).toBe(40);
  });

  it('synthesizes a viewBox from width/height when absent', () => {
    const { asset } = importSvg('<svg xmlns="http://www.w3.org/2000/svg" width="50" height="60"><rect/></svg>', 'x.svg');
    expect(asset.viewBox).toBe('0 0 50 60');
    expect(asset.width).toBe(50);
    expect(asset.height).toBe(60);
  });

  it('strips scripts during import', () => {
    const { asset } = importSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>x()</script><rect/></svg>', 'x.svg');
    expect(asset.normalizedContent).not.toContain('<script');
  });

  it('throws SvgImportError on malformed input', () => {
    expect(() => importSvg('not an svg at all <<<', 'bad.svg')).toThrow(SvgImportError);
  });

  it('throws SvgImportError when root element is not <svg>', () => {
    expect(() => importSvg('<html xmlns="http://www.w3.org/1999/xhtml"></html>', 'bad.svg')).toThrow(SvgImportError);
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `pnpm exec vitest run src/services/import/importSvg.test.ts`
Expected: FAIL — cannot find module `./importSvg`.

- [ ] **Step 3: Implement `importSvg.ts`**

Create `src/services/import/importSvg.ts`:
```ts
import type { SvgAsset } from '../../engine';
import { SvgImportError } from '../errors';
import { hashContent } from '../hash';
import { namespaceIds } from './namespaceIds';
import { sanitizeSvgElement } from './sanitizeSvg';

export interface SvgImportResult {
  asset: SvgAsset;
  warnings: string[];
}

export function importSvg(source: string, name: string): SvgImportResult {
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (doc.querySelector('parsererror')) {
    throw new SvgImportError(`Could not parse "${name}" as SVG.`);
  }
  const svg = doc.documentElement;
  if (svg.tagName.toLowerCase() !== 'svg') {
    throw new SvgImportError(`"${name}" is not an SVG document.`);
  }

  const id = hashContent(source);
  const warnings = sanitizeSvgElement(svg);
  namespaceIds(svg, id);

  const { viewBox, width, height } = resolveDimensions(svg);
  svg.setAttribute('viewBox', viewBox);

  const normalizedContent = new XMLSerializer().serializeToString(svg);

  return {
    asset: { id, kind: 'svg', name, normalizedContent, viewBox, width, height },
    warnings,
  };
}

function resolveDimensions(svg: Element): { viewBox: string; width: number; height: number } {
  const vb = svg.getAttribute('viewBox');
  const widthAttr = parseFloat(svg.getAttribute('width') ?? '');
  const heightAttr = parseFloat(svg.getAttribute('height') ?? '');

  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      const width = Number.isFinite(widthAttr) ? widthAttr : parts[2];
      const height = Number.isFinite(heightAttr) ? heightAttr : parts[3];
      return { viewBox: vb.trim(), width, height };
    }
  }

  const width = Number.isFinite(widthAttr) && widthAttr > 0 ? widthAttr : 100;
  const height = Number.isFinite(heightAttr) && heightAttr > 0 ? heightAttr : 100;
  return { viewBox: `0 0 ${width} ${height}`, width, height };
}
```

- [ ] **Step 4: Run the tests, verify pass**

Run: `pnpm exec vitest run src/services/import/importSvg.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/import/importSvg.ts src/services/import/importSvg.test.ts
git commit -m "feat(services): SVG import pipeline (parse, sanitize, namespace, normalize)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Audio import

**Files:**
- Create: `src/services/import/importAudio.ts`, `src/services/import/importAudio.test.ts`

**Interfaces:**
- Consumes: `hashContent` (Task 2), `AudioImportError` (Task 2); `AudioAsset` type (engine).
- Produces:
  - `const ALLOWED_AUDIO_TYPES: readonly string[]`, `const MAX_AUDIO_BYTES: number`.
  - `interface AudioImportResult { asset: AudioAsset; bytes: Uint8Array }`
  - `importAudio(name: string, bytes: Uint8Array, mimeType: string): AudioImportResult` — validates type + size (throws `AudioImportError`), content-addresses to `asset.id`.

- [ ] **Step 1: Write the failing tests**

Create `src/services/import/importAudio.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { AudioImportError } from '../errors';
import { importAudio, MAX_AUDIO_BYTES } from './importAudio';

const bytes = new Uint8Array([1, 2, 3, 4]);

describe('importAudio', () => {
  it('creates a content-addressed audio asset', () => {
    const { asset } = importAudio('clip.mp3', bytes, 'audio/mpeg');
    expect(asset.kind).toBe('audio');
    expect(asset.name).toBe('clip.mp3');
    expect(asset.mimeType).toBe('audio/mpeg');
    expect(asset.id).toMatch(/^[0-9a-f]{8}$/);
  });

  it('returns the original bytes for separate storage', () => {
    expect(importAudio('clip.wav', bytes, 'audio/wav').bytes).toBe(bytes);
  });

  it('rejects unsupported mime types', () => {
    expect(() => importAudio('clip.txt', bytes, 'text/plain')).toThrow(AudioImportError);
  });

  it('rejects oversized files', () => {
    const big = new Uint8Array(MAX_AUDIO_BYTES + 1);
    expect(() => importAudio('big.mp3', big, 'audio/mpeg')).toThrow(AudioImportError);
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `pnpm exec vitest run src/services/import/importAudio.test.ts`
Expected: FAIL — cannot find module `./importAudio`.

- [ ] **Step 3: Implement `importAudio.ts`**

Create `src/services/import/importAudio.ts`:
```ts
import type { AudioAsset } from '../../engine';
import { AudioImportError } from '../errors';
import { hashContent } from '../hash';

export const ALLOWED_AUDIO_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/webm',
  'audio/aac',
] as const;

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB

export interface AudioImportResult {
  asset: AudioAsset;
  bytes: Uint8Array;
}

export function importAudio(name: string, bytes: Uint8Array, mimeType: string): AudioImportResult {
  if (!ALLOWED_AUDIO_TYPES.includes(mimeType as (typeof ALLOWED_AUDIO_TYPES)[number])) {
    throw new AudioImportError(`Unsupported audio type "${mimeType}" for "${name}".`);
  }
  if (bytes.length > MAX_AUDIO_BYTES) {
    throw new AudioImportError(`"${name}" exceeds the ${MAX_AUDIO_BYTES} byte limit.`);
  }
  const id = hashContent(bytes);
  return { asset: { id, kind: 'audio', name, mimeType }, bytes };
}
```

- [ ] **Step 4: Run the tests, verify pass**

Run: `pnpm exec vitest run src/services/import/importAudio.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/import/importAudio.ts src/services/import/importAudio.test.ts
git commit -m "feat(services): audio import with type/size validation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Export — render inline SVG document

**Files:**
- Create: `src/services/export/renderDocument.ts`, `src/services/export/renderDocument.test.ts`

**Interfaces:**
- Consumes: `Project`, `SvgAsset` types, `sampleProject`, `buildTransform`, `fmt` (engine); `MissingAssetError` (Task 2).
- Produces: `renderSvgDocument(project: Project): string` — a deterministic root `<svg>` whose `<defs>` holds one nested `<svg id="savig-asset-<assetId>">` per **used** asset (sorted by id) and whose body is one `<use data-savig-object="<objectId>" href="#savig-asset-<assetId>" transform=… opacity=…/>` per object (in `sampleProject` z-order). Throws `MissingAssetError` if an object references an unknown asset.

- [ ] **Step 1: Write the failing tests**

Create `src/services/export/renderDocument.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  createProject,
  createSceneObject,
  type Project,
  type SvgAsset,
} from '../../engine';
import { MissingAssetError } from '../errors';
import { renderSvgDocument } from './renderDocument';

function fixture(): Project {
  const asset: SvgAsset = {
    id: 'aaaa1111',
    kind: 'svg',
    name: 'box.svg',
    normalizedContent:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
    viewBox: '0 0 10 10',
    width: 10,
    height: 10,
  };
  const project = createProject({ width: 100, height: 80 });
  project.assets.push(asset);
  project.objects.push(
    createSceneObject('aaaa1111', { id: 'obj1', zOrder: 0, base: { x: 5, y: 6, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } }),
  );
  return project;
}

describe('renderSvgDocument', () => {
  it('emits a root svg sized to the project', () => {
    const out = renderSvgDocument(fixture());
    expect(out).toContain('viewBox="0 0 100 80"');
    expect(out.startsWith('<svg')).toBe(true);
  });

  it('defines each used asset once in <defs>', () => {
    const out = renderSvgDocument(fixture());
    expect(out).toContain('id="savig-asset-aaaa1111"');
    expect((out.match(/savig-asset-aaaa1111"/g) ?? []).length).toBe(2); // defs id + use href
  });

  it('emits a <use> with object id, transform, and opacity', () => {
    const out = renderSvgDocument(fixture());
    expect(out).toContain('data-savig-object="obj1"');
    expect(out).toContain('href="#savig-asset-aaaa1111"');
    expect(out).toContain('translate(5, 6)');
  });

  it('is deterministic across calls', () => {
    expect(renderSvgDocument(fixture())).toBe(renderSvgDocument(fixture()));
  });

  it('throws MissingAssetError for an unknown asset reference', () => {
    const project = fixture();
    project.objects[0] = createSceneObject('nope9999', { id: 'obj1' });
    expect(() => renderSvgDocument(project)).toThrow(MissingAssetError);
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `pnpm exec vitest run src/services/export/renderDocument.test.ts`
Expected: FAIL — cannot find module `./renderDocument`.

- [ ] **Step 3: Implement `renderDocument.ts`**

Create `src/services/export/renderDocument.ts`:
```ts
import { buildTransform, fmt, sampleProject } from '../../engine';
import type { Project, SvgAsset } from '../../engine';
import { MissingAssetError } from '../errors';

// Each asset is defined once in <defs> and instanced via <use>, so multiple
// instances never duplicate (already-namespaced) internal ids. The <use>
// carries the per-instance transform + opacity and a data id the runtime maps.
export function renderSvgDocument(project: Project): string {
  const assetsById = new Map(project.assets.map((a) => [a.id, a] as const));

  const usedIds = Array.from(new Set(project.objects.map((o) => o.assetId))).sort();
  const defs = usedIds
    .map((assetId) => {
      const asset = assetsById.get(assetId);
      if (!asset || asset.kind !== 'svg') {
        throw new MissingAssetError(`Missing SVG asset "${assetId}" referenced by an object.`);
      }
      return defineSymbol(asset);
    })
    .join('');

  const objectsById = new Map(project.objects.map((o) => [o.id, o] as const));
  const body = sampleProject(project, 0)
    .map((state) => {
      const obj = objectsById.get(state.objectId)!;
      if (!assetsById.has(obj.assetId)) {
        throw new MissingAssetError(`Missing SVG asset "${obj.assetId}" referenced by object "${obj.id}".`);
      }
      const transform = buildTransform(state, obj.anchorX, obj.anchorY);
      return `<use data-savig-object="${obj.id}" href="#savig-asset-${obj.assetId}" transform="${transform}" opacity="${fmt(state.opacity)}"/>`;
    })
    .join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(project.meta.width)} ${fmt(project.meta.height)}">` +
    `<defs>${defs}</defs>${body}</svg>`
  );
}

function defineSymbol(asset: SvgAsset): string {
  // Wrap the asset's own root svg in an identified nested <svg> so its
  // intrinsic viewBox is preserved when referenced by <use>.
  const inner = innerMarkup(asset.normalizedContent);
  return (
    `<svg id="savig-asset-${asset.id}" viewBox="${asset.viewBox}" width="${fmt(asset.width)}" height="${fmt(asset.height)}" overflow="visible">` +
    `${inner}</svg>`
  );
}

function innerMarkup(svgMarkup: string): string {
  const doc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
  return Array.from(doc.documentElement.childNodes)
    .map((node) => new XMLSerializer().serializeToString(node))
    .join('');
}
```

- [ ] **Step 4: Run the tests, verify pass**

Run: `pnpm exec vitest run src/services/export/renderDocument.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/export/renderDocument.ts src/services/export/renderDocument.test.ts
git commit -m "feat(services): render deterministic inline SVG export document

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Export — assemble bundle files

**Files:**
- Create: `src/services/export/buildBundle.ts`, `src/services/export/buildBundle.test.ts`

**Interfaces:**
- Consumes: `Project` type (engine); `renderSvgDocument` (Task 7); `stableJson` (Task 2), `bytesToBase64` (Task 2), `MissingAssetError` (Task 2).
- Produces:
  - `type AssetBinaries = Record<string, Uint8Array>` (audio asset id → bytes).
  - `interface ExportFiles { 'index.html': string; 'savig-runtime.js': string }`
  - `buildExportBundle(project: Project, binaries: AssetBinaries, runtimeJs: string): ExportFiles` — builds a self-contained `index.html` (inline SVG + JSON project + base64 audio + runtime `<script src>` + bootstrap) and writes `runtimeJs` to `savig-runtime.js`. Throws `MissingAssetError` if any audio clip's asset binary is absent.

- [ ] **Step 1: Write the failing tests**

Create `src/services/export/buildBundle.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createProject, type Project, type SvgAsset } from '../../engine';
import { MissingAssetError } from '../errors';
import { buildExportBundle, type AssetBinaries } from './buildBundle';

function svgProject(): Project {
  const asset: SvgAsset = {
    id: 'aaaa1111',
    kind: 'svg',
    name: 'box.svg',
    normalizedContent: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect/></svg>',
    viewBox: '0 0 10 10',
    width: 10,
    height: 10,
  };
  const project = createProject({ name: 'Demo' });
  project.assets.push(asset);
  return project;
}

describe('buildExportBundle', () => {
  it('writes the runtime js verbatim', () => {
    const files = buildExportBundle(svgProject(), {}, 'console.log("rt");');
    expect(files['savig-runtime.js']).toBe('console.log("rt");');
  });

  it('references the runtime and embeds project JSON', () => {
    const files = buildExportBundle(svgProject(), {}, 'X');
    expect(files['index.html']).toContain('<script src="savig-runtime.js"></script>');
    expect(files['index.html']).toContain('id="savig-project"');
    expect(files['index.html']).toContain('"name":"Demo"');
  });

  it('embeds audio as base64 keyed by asset id', () => {
    const project = svgProject();
    project.assets.push({ id: 'b0b0b0b0', kind: 'audio', name: 'a.mp3', mimeType: 'audio/mpeg' });
    project.audioClips.push({ id: 'clip1', assetId: 'b0b0b0b0', startTime: 0, inPoint: 0, outPoint: 1, volume: 1 });
    const binaries: AssetBinaries = { b0b0b0b0: new Uint8Array([1, 2, 3]) };
    const files = buildExportBundle(project, binaries, 'X');
    expect(files['index.html']).toContain('id="savig-audio"');
    expect(files['index.html']).toContain('"b0b0b0b0":"AQID"'); // base64 of [1,2,3]
  });

  it('throws MissingAssetError when audio binary is absent', () => {
    const project = svgProject();
    project.assets.push({ id: 'b0b0b0b0', kind: 'audio', name: 'a.mp3', mimeType: 'audio/mpeg' });
    project.audioClips.push({ id: 'clip1', assetId: 'b0b0b0b0', startTime: 0, inPoint: 0, outPoint: 1, volume: 1 });
    expect(() => buildExportBundle(project, {}, 'X')).toThrow(MissingAssetError);
  });

  it('is byte-stable across calls (golden)', () => {
    const a = buildExportBundle(svgProject(), {}, 'X')['index.html'];
    const b = buildExportBundle(svgProject(), {}, 'X')['index.html'];
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `pnpm exec vitest run src/services/export/buildBundle.test.ts`
Expected: FAIL — cannot find module `./buildBundle`.

- [ ] **Step 3: Implement `buildBundle.ts`**

Create `src/services/export/buildBundle.ts`:
```ts
import type { Project } from '../../engine';
import { bytesToBase64 } from '../bytes';
import { MissingAssetError } from '../errors';
import { stableJson } from '../json';
import { renderSvgDocument } from './renderDocument';

export type AssetBinaries = Record<string, Uint8Array>;

export interface ExportFiles {
  'index.html': string;
  'savig-runtime.js': string;
}

export function buildExportBundle(
  project: Project,
  binaries: AssetBinaries,
  runtimeJs: string,
): ExportFiles {
  const svg = renderSvgDocument(project);

  // Collect base64 audio for every asset referenced by a clip (sorted for
  // byte-stability). Base64 inlining keeps the bundle openable via file://.
  const audioIds = Array.from(new Set(project.audioClips.map((c) => c.assetId))).sort();
  const audio: Record<string, string> = {};
  for (const id of audioIds) {
    const bytes = binaries[id];
    if (!bytes) throw new MissingAssetError(`Missing audio binary for asset "${id}".`);
    audio[id] = bytesToBase64(bytes);
  }

  const html =
    `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8"/>\n` +
    `<title>${escapeHtml(project.meta.name)}</title>\n` +
    `<style>html,body{margin:0;height:100%;background:#111}svg{display:block;width:100%;height:100%}</style>\n` +
    `</head>\n<body>\n${svg}\n` +
    `<script id="savig-project" type="application/json">${stableJson(project)}</script>\n` +
    `<script id="savig-audio" type="application/json">${stableJson(audio)}</script>\n` +
    `<script src="savig-runtime.js"></script>\n` +
    `<script>SavigRuntime.create({\n` +
    `  svg: document.querySelector('svg'),\n` +
    `  project: JSON.parse(document.getElementById('savig-project').textContent),\n` +
    `  audio: JSON.parse(document.getElementById('savig-audio').textContent)\n` +
    `});</script>\n</body>\n</html>\n`;

  return { 'index.html': html, 'savig-runtime.js': runtimeJs };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
```

- [ ] **Step 4: Run the tests, verify pass**

Run: `pnpm exec vitest run src/services/export/buildBundle.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/export/buildBundle.ts src/services/export/buildBundle.test.ts
git commit -m "feat(services): assemble self-contained HTML export bundle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Export — zip the bundle

**Files:**
- Create: `src/services/export/zipBundle.ts`, `src/services/export/zipBundle.test.ts`

**Interfaces:**
- Consumes: `ExportFiles` (Task 8); `fflate` `zipSync`/`strToU8`.
- Produces: `zipBundle(files: ExportFiles): Uint8Array` — a zip archive of the bundle files.

- [ ] **Step 1: Write the failing test**

Create `src/services/export/zipBundle.test.ts`:
```ts
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { zipBundle } from './zipBundle';

describe('zipBundle', () => {
  it('zips the files and round-trips their contents', () => {
    const zipped = zipBundle({ 'index.html': '<html></html>', 'savig-runtime.js': 'RT();' });
    const out = unzipSync(zipped);
    expect(strFromU8(out['index.html'])).toBe('<html></html>');
    expect(strFromU8(out['savig-runtime.js'])).toBe('RT();');
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `pnpm exec vitest run src/services/export/zipBundle.test.ts`
Expected: FAIL — cannot find module `./zipBundle`.

- [ ] **Step 3: Implement `zipBundle.ts`**

Create `src/services/export/zipBundle.ts`:
```ts
import { strToU8, zipSync } from 'fflate';
import type { ExportFiles } from './buildBundle';

export function zipBundle(files: ExportFiles): Uint8Array {
  return zipSync({
    'index.html': strToU8(files['index.html']),
    'savig-runtime.js': strToU8(files['savig-runtime.js']),
  });
}
```

- [ ] **Step 4: Run the test, verify pass**

Run: `pnpm exec vitest run src/services/export/zipBundle.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/services/export/zipBundle.ts src/services/export/zipBundle.test.ts
git commit -m "feat(services): zip the export bundle with fflate

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Export runtime player + parity

**Files:**
- Create: `src/runtime/frame.ts`, `src/runtime/frame.test.ts`, `src/runtime/index.ts`

**Interfaces:**
- Consumes: `Project`, `sampleProject`, `buildTransform`, `fmt`, `createClock`, `play`, `advance`, `computeProjectDuration` (engine).
- Produces:
  - `interface FrameItem { objectId: string; transform: string; opacity: string }`
  - `computeFrame(project: Project, time: number): FrameItem[]` — the single source of truth mapping sampled state → SVG attribute strings, used by both the runtime player and the parity test.
  - `runtime/index.ts` exposes a global `SavigRuntime.create({ svg, project, audio })` (bundled in Task 11). Only `computeFrame` is unit-tested here; `create` is exercised end-to-end in Plan 3.

- [ ] **Step 1: Write the failing parity test**

Create `src/runtime/frame.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  buildTransform,
  createKeyframe,
  createProject,
  createSceneObject,
  fmt,
  sampleProject,
  type Project,
} from '../engine';
import { computeFrame } from './frame';

function animated(): Project {
  const project = createProject();
  project.assets.push({
    id: 'aaaa1111', kind: 'svg', name: 'x', normalizedContent: '<svg/>', viewBox: '0 0 1 1', width: 1, height: 1,
  });
  const obj = createSceneObject('aaaa1111', { id: 'o1', anchorX: 5, anchorY: 5 });
  obj.tracks.x = [createKeyframe(0, 0), createKeyframe(1, 100)];
  project.objects.push(obj);
  return project;
}

describe('computeFrame parity with engine sampling', () => {
  it('matches sampleProject + buildTransform at multiple times', () => {
    const project = animated();
    for (const t of [0, 0.25, 0.5, 1]) {
      const expected = sampleProject(project, t).map((state) => {
        const obj = project.objects.find((o) => o.id === state.objectId)!;
        return {
          objectId: state.objectId,
          transform: buildTransform(state, obj.anchorX, obj.anchorY),
          opacity: fmt(state.opacity),
        };
      });
      expect(computeFrame(project, t)).toEqual(expected);
    }
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `pnpm exec vitest run src/runtime/frame.test.ts`
Expected: FAIL — cannot find module `./frame`.

- [ ] **Step 3: Implement `frame.ts`**

Create `src/runtime/frame.ts`:
```ts
import { buildTransform, fmt, sampleProject } from '../engine';
import type { Project } from '../engine';

export interface FrameItem {
  objectId: string;
  transform: string;
  opacity: string;
}

// Single definition of "sampled state -> SVG attributes", shared by the
// editor Stage (Plan 3) and the export runtime. The parity test locks these
// two consumers to identical output, guaranteeing preview == export.
export function computeFrame(project: Project, time: number): FrameItem[] {
  const objectsById = new Map(project.objects.map((o) => [o.id, o] as const));
  return sampleProject(project, time).map((state) => {
    const obj = objectsById.get(state.objectId)!;
    return {
      objectId: state.objectId,
      transform: buildTransform(state, obj.anchorX, obj.anchorY),
      opacity: fmt(state.opacity),
    };
  });
}
```

- [ ] **Step 4: Run the parity test, verify pass**

Run: `pnpm exec vitest run src/runtime/frame.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Implement the standalone player**

Create `src/runtime/index.ts`:
```ts
import {
  advance,
  computeProjectDuration,
  createClock,
  play,
  resolveActiveClips,
} from '../engine';
import type { AudioClip, Project } from '../engine';
import { computeFrame } from './frame';

interface CreateOptions {
  svg: SVGSVGElement;
  project: Project;
  audio: Record<string, string>; // assetId -> base64
}

// Self-contained player bundled into savig-runtime.js. Drives the SVG
// imperatively from the shared engine core and schedules audio via Web Audio.
function create(options: CreateOptions): void {
  const { svg, project, audio } = options;
  const duration = computeProjectDuration(project);
  const nodes = new Map<string, Element>();
  svg.querySelectorAll('[data-savig-object]').forEach((node) => {
    const id = node.getAttribute('data-savig-object');
    if (id) nodes.set(id, node);
  });

  const apply = (time: number): void => {
    for (const item of computeFrame(project, time)) {
      const node = nodes.get(item.objectId);
      if (!node) continue;
      node.setAttribute('transform', item.transform);
      node.setAttribute('opacity', item.opacity);
    }
  };

  let clock = createClock();
  const loop = (timestamp: number): void => {
    clock = advance(clock, timestamp / 1000, duration, project.meta.loop);
    apply(clock.time);
    if (clock.playing) requestAnimationFrame(loop);
  };

  const startAudio = createAudioStarter(project.audioClips, audio);
  apply(0);
  clock = play(clock, performance.now() / 1000);
  startAudio();
  requestAnimationFrame(loop);
}

function createAudioStarter(clips: AudioClip[], audio: Record<string, string>): () => void {
  return () => {
    if (clips.length === 0) return;
    const Ctx = (window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)!;
    const ctx = new Ctx();
    const decoded = new Map<string, AudioBuffer>();
    const decodeAll = clips.map(async (clip) => {
      if (decoded.has(clip.assetId) || !audio[clip.assetId]) return;
      const bytes = Uint8Array.from(atob(audio[clip.assetId]), (c) => c.charCodeAt(0));
      decoded.set(clip.assetId, await ctx.decodeAudioData(bytes.buffer));
    });
    void Promise.all(decodeAll).then(() => {
      for (const { clip } of resolveActiveClips(clips, 0)) schedule(ctx, decoded, clip);
      for (const clip of clips) if (clip.startTime > 0) schedule(ctx, decoded, clip);
    });
  };
}

function schedule(ctx: AudioContext, decoded: Map<string, AudioBuffer>, clip: AudioClip): void {
  const buffer = decoded.get(clip.assetId);
  if (!buffer) return;
  const gain = ctx.createGain();
  gain.gain.value = clip.volume;
  gain.connect(ctx.destination);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(gain);
  source.start(ctx.currentTime + Math.max(0, clip.startTime), clip.inPoint, clip.outPoint - clip.inPoint);
}

(globalThis as unknown as { SavigRuntime: { create: typeof create } }).SavigRuntime = { create };
```

- [ ] **Step 6: Typecheck and run runtime tests**

Run: `pnpm exec vitest run src/runtime && pnpm typecheck`
Expected: parity test PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/runtime/frame.ts src/runtime/frame.test.ts src/runtime/index.ts
git commit -m "feat(runtime): standalone player with engine-parity frame computation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Build the runtime bundle + production export

**Files:**
- Create: `scripts/build-runtime.mjs`, `src/runtime/runtimeSource.generated.ts` (generated, committed), `src/services/export/exportProject.ts`, `src/services/export/exportProject.test.ts`

**Interfaces:**
- Consumes: `build:runtime` script (Task 1); `buildExportBundle`, `AssetBinaries` (Task 8); `zipBundle` (Task 9).
- Produces:
  - `scripts/build-runtime.mjs` — esbuild bundles `src/runtime/index.ts` (IIFE, global `SavigRuntime`) and writes `export const RUNTIME_JS = "…";` to `runtimeSource.generated.ts`.
  - `RUNTIME_JS: string` (the bundled runtime).
  - `exportProject(project: Project, binaries: AssetBinaries): Uint8Array` — production one-call export (real runtime + zip).

- [ ] **Step 1: Write the esbuild build script**

Create `scripts/build-runtime.mjs`:
```js
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';

const result = await build({
  entryPoints: ['src/runtime/index.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'SavigRuntimeBundle',
  target: 'es2020',
  minify: false,
  legalComments: 'none',
  write: false,
});

const js = result.outputFiles[0].text;
const module = `// GENERATED by scripts/build-runtime.mjs — do not edit by hand.\n` +
  `export const RUNTIME_JS = ${JSON.stringify(js)};\n`;
writeFileSync('src/runtime/runtimeSource.generated.ts', module);
console.log(`Wrote runtimeSource.generated.ts (${js.length} bytes of runtime).`);
```

- [ ] **Step 2: Generate the runtime module**

Run: `pnpm build:runtime`
Expected: prints "Wrote runtimeSource.generated.ts (… bytes)"; `src/runtime/runtimeSource.generated.ts` now exists exporting a non-empty `RUNTIME_JS`.

- [ ] **Step 3: Write the failing export test**

Create `src/services/export/exportProject.test.ts`:
```ts
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createProject, type Project, type SvgAsset } from '../../engine';
import { RUNTIME_JS } from '../../runtime/runtimeSource.generated';
import { exportProject } from './exportProject';

function project(): Project {
  const asset: SvgAsset = {
    id: 'aaaa1111', kind: 'svg', name: 'box.svg',
    normalizedContent: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect/></svg>',
    viewBox: '0 0 10 10', width: 10, height: 10,
  };
  const p = createProject({ name: 'Demo' });
  p.assets.push(asset);
  return p;
}

describe('exportProject', () => {
  it('produces a zip with index.html and the real runtime', () => {
    const zip = unzipSync(exportProject(project(), {}));
    expect(strFromU8(zip['index.html'])).toContain('SavigRuntime.create');
    expect(strFromU8(zip['savig-runtime.js'])).toBe(RUNTIME_JS);
  });

  it('bundled runtime exposes the SavigRuntime global', () => {
    expect(RUNTIME_JS).toContain('SavigRuntime');
    expect(RUNTIME_JS.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Run it, verify failure**

Run: `pnpm exec vitest run src/services/export/exportProject.test.ts`
Expected: FAIL — cannot find module `./exportProject`.

- [ ] **Step 5: Implement `exportProject.ts`**

Create `src/services/export/exportProject.ts`:
```ts
import type { Project } from '../../engine';
import { RUNTIME_JS } from '../../runtime/runtimeSource.generated';
import { buildExportBundle, type AssetBinaries } from './buildBundle';
import { zipBundle } from './zipBundle';

// One-call production export: real bundled runtime + deterministic bundle + zip.
export function exportProject(project: Project, binaries: AssetBinaries): Uint8Array {
  return zipBundle(buildExportBundle(project, binaries, RUNTIME_JS));
}
```

- [ ] **Step 6: Run the test + full typecheck, verify pass**

Run: `pnpm exec vitest run src/services/export/exportProject.test.ts && pnpm typecheck`
Expected: PASS (2 tests); typecheck clean (the generated module resolves).

- [ ] **Step 7: Commit (including the generated runtime)**

```bash
git add scripts/build-runtime.mjs src/runtime/runtimeSource.generated.ts src/services/export/exportProject.ts src/services/export/exportProject.test.ts
git commit -m "feat(services): build standalone runtime bundle and wire production export

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: Persistence — `.savig` save/load

**Files:**
- Create: `src/services/persistence/savig.ts`, `src/services/persistence/savig.test.ts`

**Interfaces:**
- Consumes: `Project` type (engine); `stableJson` (Task 2), `SavigLoadError` (Task 2); `AssetBinaries` (Task 8); `fflate` `zipSync`/`unzipSync`/`strToU8`/`strFromU8`; `migrateProject` is added in Task 13 (this task parses JSON directly; Task 13 inserts migration).
- Produces:
  - `interface SavigFile { project: Project; binaries: AssetBinaries }`
  - `saveSavig(file: SavigFile): Uint8Array` — zip of `project.json` + `assets/<id>` per binary.
  - `loadSavig(bytes: Uint8Array): SavigFile` — inverse; throws `SavigLoadError` if `project.json` is missing/unparseable.

- [ ] **Step 1: Write the failing tests**

Create `src/services/persistence/savig.test.ts`:
```ts
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createProject, type Project } from '../../engine';
import { SavigLoadError } from '../errors';
import { loadSavig, saveSavig } from './savig';

function file(): { project: Project; binaries: Record<string, Uint8Array> } {
  const project = createProject({ name: 'Persisted' });
  project.assets.push({ id: 'b0b0b0b0', kind: 'audio', name: 'a.mp3', mimeType: 'audio/mpeg' });
  return { project, binaries: { b0b0b0b0: new Uint8Array([9, 8, 7]) } };
}

describe('savig persistence', () => {
  it('round-trips a project and its binaries', () => {
    const loaded = loadSavig(saveSavig(file()));
    expect(loaded.project.meta.name).toBe('Persisted');
    expect(loaded.binaries.b0b0b0b0).toEqual(new Uint8Array([9, 8, 7]));
  });

  it('preserves assets and clips', () => {
    const original = file();
    original.project.audioClips.push({ id: 'c1', assetId: 'b0b0b0b0', startTime: 1, inPoint: 0, outPoint: 2, volume: 0.5 });
    const loaded = loadSavig(saveSavig(original));
    expect(loaded.project.audioClips).toHaveLength(1);
    expect(loaded.project.audioClips[0].volume).toBe(0.5);
  });

  it('throws SavigLoadError when project.json is missing', () => {
    const bogus = zipSync({ 'notes.txt': strToU8('hi') });
    expect(() => loadSavig(bogus)).toThrow(SavigLoadError);
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `pnpm exec vitest run src/services/persistence/savig.test.ts`
Expected: FAIL — cannot find module `./savig`.

- [ ] **Step 3: Implement `savig.ts`**

Create `src/services/persistence/savig.ts`:
```ts
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Project } from '../../engine';
import { SavigLoadError } from '../errors';
import { stableJson } from '../json';
import type { AssetBinaries } from '../export/buildBundle';

export interface SavigFile {
  project: Project;
  binaries: AssetBinaries;
}

const PROJECT_ENTRY = 'project.json';
const ASSET_PREFIX = 'assets/';

export function saveSavig(file: SavigFile): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    [PROJECT_ENTRY]: strToU8(stableJson(file.project)),
  };
  for (const id of Object.keys(file.binaries).sort()) {
    entries[`${ASSET_PREFIX}${id}`] = file.binaries[id];
  }
  return zipSync(entries);
}

export function loadSavig(bytes: Uint8Array): SavigFile {
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes);
  } catch {
    throw new SavigLoadError('File is not a valid .savig archive.');
  }

  const projectEntry = unzipped[PROJECT_ENTRY];
  if (!projectEntry) throw new SavigLoadError('Archive is missing project.json.');

  let project: Project;
  try {
    project = JSON.parse(strFromU8(projectEntry)) as Project;
  } catch {
    throw new SavigLoadError('project.json is corrupt.');
  }

  const binaries: AssetBinaries = {};
  for (const path of Object.keys(unzipped)) {
    if (path.startsWith(ASSET_PREFIX)) binaries[path.slice(ASSET_PREFIX.length)] = unzipped[path];
  }

  return { project, binaries };
}
```

- [ ] **Step 4: Run the tests, verify pass**

Run: `pnpm exec vitest run src/services/persistence/savig.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/persistence/savig.ts src/services/persistence/savig.test.ts
git commit -m "feat(services): .savig zip save/load round-trip

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 13: Persistence — migration registry

**Files:**
- Create: `src/services/persistence/migrate.ts`, `src/services/persistence/migrate.test.ts`
- Modify: `src/services/persistence/savig.ts` (run `migrateProject` on load)

**Interfaces:**
- Consumes: `Project` type (engine); `SavigLoadError`, `UnsupportedVersionError` (Task 2).
- Produces:
  - `const CURRENT_VERSION = 1`
  - `migrateProject(doc: unknown): Project` — validates shape, applies sequential migrations from `doc.meta.version` up to `CURRENT_VERSION`, throws `UnsupportedVersionError` for newer versions and `SavigLoadError` for unshaped input.
  - `const migrations: Record<number, (doc: Project) => Project>` — keyed by source version (scaffolded, empty for v1).

- [ ] **Step 1: Write the failing tests**

Create `src/services/persistence/migrate.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createProject } from '../../engine';
import { SavigLoadError, UnsupportedVersionError } from '../errors';
import { CURRENT_VERSION, migrateProject } from './migrate';

describe('migrateProject', () => {
  it('passes through a current-version project', () => {
    const project = createProject();
    expect(migrateProject(project).meta.version).toBe(CURRENT_VERSION);
  });

  it('throws UnsupportedVersionError for a newer file', () => {
    const future = createProject();
    future.meta.version = CURRENT_VERSION + 1;
    expect(() => migrateProject(future)).toThrow(UnsupportedVersionError);
  });

  it('throws SavigLoadError for non-project input', () => {
    expect(() => migrateProject({ nope: true })).toThrow(SavigLoadError);
    expect(() => migrateProject(null)).toThrow(SavigLoadError);
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `pnpm exec vitest run src/services/persistence/migrate.test.ts`
Expected: FAIL — cannot find module `./migrate`.

- [ ] **Step 3: Implement `migrate.ts`**

Create `src/services/persistence/migrate.ts`:
```ts
import type { Project } from '../../engine';
import { SavigLoadError, UnsupportedVersionError } from '../errors';

export const CURRENT_VERSION = 1;

// Keyed by the version being upgraded FROM. Empty at v1; future format
// changes register a function here so old files upgrade on load.
export const migrations: Record<number, (doc: Project) => Project> = {};

export function migrateProject(doc: unknown): Project {
  if (!isProjectShape(doc)) {
    throw new SavigLoadError('File does not contain a Savig project.');
  }
  let version = doc.meta.version;
  if (version > CURRENT_VERSION) {
    throw new UnsupportedVersionError(
      `Project version ${version} is newer than supported (${CURRENT_VERSION}). Update Savig to open it.`,
    );
  }
  let project = doc;
  while (version < CURRENT_VERSION) {
    const migrate = migrations[version];
    if (!migrate) throw new SavigLoadError(`No migration from version ${version}.`);
    project = migrate(project);
    version += 1;
  }
  return project;
}

function isProjectShape(doc: unknown): doc is Project {
  return (
    typeof doc === 'object' &&
    doc !== null &&
    'meta' in doc &&
    typeof (doc as Project).meta?.version === 'number' &&
    Array.isArray((doc as Project).objects)
  );
}
```

- [ ] **Step 4: Run the tests, verify pass**

Run: `pnpm exec vitest run src/services/persistence/migrate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire migration into `loadSavig`**

In `src/services/persistence/savig.ts`, add the import near the other imports:
```ts
import { migrateProject } from './migrate';
```
Then replace the parse block so the parsed JSON flows through migration. Guard
**only** the `JSON.parse` so that `migrateProject`'s own errors
(`SavigLoadError`, `UnsupportedVersionError`) propagate unwrapped and callers
can distinguish them:
```ts
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(projectEntry));
  } catch {
    throw new SavigLoadError('project.json is corrupt.');
  }
  const project = migrateProject(raw);
```
(Remove the previous `JSON.parse(...) as Project` block. The local is now
`raw: unknown` → `project` via migration, so the `import type { Project }` in
this file is still used by the `SavigFile` interface.)

- [ ] **Step 6: Run persistence tests + typecheck, verify pass**

Run: `pnpm exec vitest run src/services/persistence && pnpm typecheck`
Expected: PASS (savig + migrate tests); typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/services/persistence/migrate.ts src/services/persistence/migrate.test.ts src/services/persistence/savig.ts
git commit -m "feat(services): migration registry with version guard on load

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 14: Persistence — IndexedDB autosave

**Files:**
- Create: `src/services/persistence/autosave.ts`, `src/services/persistence/autosave.test.ts`

**Interfaces:**
- Consumes: `indexedDB` global (real in browser; fake-indexeddb in tests).
- Produces:
  - `interface AutosaveStore { save(bytes: Uint8Array): Promise<void>; load(): Promise<Uint8Array | null>; clear(): Promise<void> }`
  - `createAutosaveStore(factory?: IDBFactory): AutosaveStore` — single-record store (DB `savig-autosave`, store `state`, key `current`). All methods **degrade gracefully**: failures resolve (save/clear become no-ops; load resolves `null`).

- [ ] **Step 1: Write the failing tests**

Create `src/services/persistence/autosave.test.ts`:
```ts
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAutosaveStore } from './autosave';

describe('autosave store', () => {
  let factory: IDBFactory;
  beforeEach(() => {
    factory = new IDBFactory(); // isolated db per test
  });

  it('returns null when nothing is saved', async () => {
    const store = createAutosaveStore(factory);
    expect(await store.load()).toBeNull();
  });

  it('saves and loads bytes', async () => {
    const store = createAutosaveStore(factory);
    await store.save(new Uint8Array([1, 2, 3]));
    expect(await store.load()).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('overwrites the previous autosave', async () => {
    const store = createAutosaveStore(factory);
    await store.save(new Uint8Array([1]));
    await store.save(new Uint8Array([2, 2]));
    expect(await store.load()).toEqual(new Uint8Array([2, 2]));
  });

  it('clears the autosave', async () => {
    const store = createAutosaveStore(factory);
    await store.save(new Uint8Array([1]));
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it('degrades to null load when indexedDB is unavailable', async () => {
    const store = createAutosaveStore(undefined as unknown as IDBFactory);
    await expect(store.save(new Uint8Array([1]))).resolves.toBeUndefined();
    expect(await store.load()).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `pnpm exec vitest run src/services/persistence/autosave.test.ts`
Expected: FAIL — cannot find module `./autosave`.

- [ ] **Step 3: Implement `autosave.ts`**

Create `src/services/persistence/autosave.ts`:
```ts
const DB_NAME = 'savig-autosave';
const STORE = 'state';
const KEY = 'current';

export interface AutosaveStore {
  save(bytes: Uint8Array): Promise<void>;
  load(): Promise<Uint8Array | null>;
  clear(): Promise<void>;
}

// Autosave must never break the editor: every operation catches and degrades
// (save/clear no-op, load -> null) so a failing IndexedDB just means "no
// recovered draft", not a crash.
export function createAutosaveStore(factory: IDBFactory = indexedDB): AutosaveStore {
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      if (!factory) {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      const request = factory.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

  const run = <T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
    open().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const tx = db.transaction(STORE, mode);
          const request = op(tx.objectStore(STORE));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
          tx.oncomplete = () => db.close();
        }),
    );

  return {
    async save(bytes) {
      try {
        await run('readwrite', (store) => store.put(bytes, KEY));
      } catch {
        /* degrade: autosave is best-effort */
      }
    },
    async load() {
      try {
        const value = await run<unknown>('readonly', (store) => store.get(KEY));
        return value instanceof Uint8Array ? value : null;
      } catch {
        return null;
      }
    },
    async clear() {
      try {
        await run('readwrite', (store) => store.delete(KEY));
      } catch {
        /* degrade */
      }
    },
  };
}
```

- [ ] **Step 4: Run the tests, verify pass**

Run: `pnpm exec vitest run src/services/persistence/autosave.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/persistence/autosave.ts src/services/persistence/autosave.test.ts
git commit -m "feat(services): IndexedDB autosave store with graceful degradation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 15: Persistence — File System Access wrapper

**Files:**
- Create: `src/services/persistence/fileAccess.ts`, `src/services/persistence/fileAccess.test.ts`

**Interfaces:**
- Consumes: browser `window.showSaveFilePicker` / `showOpenFilePicker` (optional), `Blob`/`URL`/anchor fallback.
- Produces:
  - `saveBytesToDisk(bytes: Uint8Array, suggestedName: string, mimeType?: string): Promise<void>` — File System Access picker when available, else triggers a download.
  - `openBytesFromDisk(accept?: string): Promise<{ name: string; bytes: Uint8Array } | null>` — picker when available, else an `<input type=file>` fallback; resolves `null` if the user cancels.

- [ ] **Step 1: Write the failing tests**

Create `src/services/persistence/fileAccess.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openBytesFromDisk, saveBytesToDisk } from './fileAccess';

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'showSaveFilePicker');
  Reflect.deleteProperty(window, 'showOpenFilePicker');
});

describe('saveBytesToDisk', () => {
  it('uses showSaveFilePicker when available', async () => {
    const write = vi.fn();
    const close = vi.fn();
    const createWritable = vi.fn().mockResolvedValue({ write, close });
    const picker = vi.fn().mockResolvedValue({ createWritable });
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = picker;

    await saveBytesToDisk(new Uint8Array([1, 2]), 'out.savig');

    expect(picker).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('falls back to an anchor download when picker is absent', async () => {
    const click = vi.fn();
    const anchor = document.createElement('a');
    anchor.click = click;
    vi.spyOn(document, 'createElement').mockReturnValue(anchor);
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() });

    await saveBytesToDisk(new Uint8Array([1]), 'out.savig');

    expect(click).toHaveBeenCalledOnce();
  });
});

describe('openBytesFromDisk', () => {
  it('reads bytes via showOpenFilePicker when available', async () => {
    const file = new File([new Uint8Array([5, 6, 7])], 'in.savig');
    const handle = { getFile: vi.fn().mockResolvedValue(file) };
    (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi
      .fn()
      .mockResolvedValue([handle]);

    const result = await openBytesFromDisk();

    expect(result?.name).toBe('in.savig');
    expect(result?.bytes).toEqual(new Uint8Array([5, 6, 7]));
  });

  it('resolves null when the picker is cancelled (AbortError)', async () => {
    (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('cancel'), { name: 'AbortError' }));

    expect(await openBytesFromDisk()).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `pnpm exec vitest run src/services/persistence/fileAccess.test.ts`
Expected: FAIL — cannot find module `./fileAccess`.

- [ ] **Step 3: Implement `fileAccess.ts`**

Create `src/services/persistence/fileAccess.ts`:
```ts
interface SaveFilePicker {
  (options?: { suggestedName?: string }): Promise<{
    createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }>;
  }>;
}
interface OpenFilePicker {
  (): Promise<Array<{ getFile(): Promise<File> }>>;
}

export async function saveBytesToDisk(
  bytes: Uint8Array,
  suggestedName: string,
  mimeType = 'application/octet-stream',
): Promise<void> {
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({ suggestedName });
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      return;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      // Fall through to the download fallback on any non-cancel failure.
    }
  }
  downloadBytes(bytes, suggestedName, mimeType);
}

export async function openBytesFromDisk(
  accept = '.savig',
): Promise<{ name: string; bytes: Uint8Array } | null> {
  const picker = (window as unknown as { showOpenFilePicker?: OpenFilePicker }).showOpenFilePicker;
  if (picker) {
    try {
      const [handle] = await picker();
      const file = await handle.getFile();
      return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
    } catch (err) {
      if ((err as Error).name === 'AbortError') return null;
      // Fall through to the input fallback.
    }
  }
  return openViaInput(accept);
}

function downloadBytes(bytes: Uint8Array, filename: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function openViaInput(accept: string): Promise<{ name: string; bytes: Uint8Array } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      resolve({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    };
    input.click();
  });
}
```

- [ ] **Step 4: Run the tests, verify pass**

Run: `pnpm exec vitest run src/services/persistence/fileAccess.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/persistence/fileAccess.ts src/services/persistence/fileAccess.test.ts
git commit -m "feat(services): File System Access save/open with download fallback

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 16: Audio playback engine (decoupled)

**Files:**
- Create: `src/services/audio/audioEngine.ts`, `src/services/audio/audioEngine.test.ts`

**Interfaces:**
- Consumes: `AudioClip` type (engine).
- Produces:
  - Minimal mockable interfaces `AudioContextLike`, `AudioBufferLike`, `AudioBufferSourceLike`, `GainLike`, `AudioNodeLike`.
  - `interface AudioEngine { decode(assetId: string, bytes: Uint8Array): Promise<void>; start(clips: AudioClip[], fromTime: number): void; stop(): void; readonly currentTime: number }`
  - `createAudioEngine(ctx: AudioContextLike): AudioEngine` — schedules decoded buffers for clips, honoring `startTime`/`inPoint`/`outPoint`/`volume`, offsetting by `fromTime`. RAF/clock wiring lives in Plan 3.

- [ ] **Step 1: Write the failing tests**

Create `src/services/audio/audioEngine.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import type { AudioClip } from '../../engine';
import { createAudioEngine, type AudioContextLike } from './audioEngine';

function fakeCtx(currentTime = 10) {
  const started: Array<{ when: number; offset: number; duration: number; gain: number }> = [];
  let pendingGain = 1;
  const ctx: AudioContextLike = {
    currentTime,
    destination: {},
    decodeAudioData: vi.fn().mockResolvedValue({ duration: 5 }),
    createGain: () => ({ gain: { set value(v: number) { pendingGain = v; } }, connect: vi.fn() }),
    createBufferSource: () => ({
      buffer: null,
      connect: vi.fn(),
      start: (when: number, offset: number, duration: number) =>
        started.push({ when, offset, duration, gain: pendingGain }),
      stop: vi.fn(),
    }),
  };
  return { ctx, started };
}

const clip = (over: Partial<AudioClip>): AudioClip => ({
  id: 'c', assetId: 'a1', startTime: 0, inPoint: 0, outPoint: 5, volume: 1, ...over,
});

describe('audioEngine', () => {
  it('schedules a clip that starts in the future relative to fromTime', async () => {
    const { ctx, started } = fakeCtx(10);
    const engine = createAudioEngine(ctx);
    await engine.decode('a1', new Uint8Array([1]));
    engine.start([clip({ startTime: 2 })], 0);
    expect(started).toHaveLength(1);
    expect(started[0].when).toBeCloseTo(12); // ctx.currentTime(10) + (startTime 2 - fromTime 0)
    expect(started[0].offset).toBeCloseTo(0);
    expect(started[0].duration).toBeCloseTo(5);
  });

  it('offsets into a clip already playing at fromTime', async () => {
    const { ctx, started } = fakeCtx(10);
    const engine = createAudioEngine(ctx);
    await engine.decode('a1', new Uint8Array([1]));
    engine.start([clip({ startTime: 0, inPoint: 0, outPoint: 5 })], 2);
    expect(started[0].when).toBeCloseTo(10); // already playing -> now
    expect(started[0].offset).toBeCloseTo(2); // 2s into the source
    expect(started[0].duration).toBeCloseTo(3); // 5 - 2 remaining
  });

  it('applies clip volume to the gain node', async () => {
    const { ctx, started } = fakeCtx();
    const engine = createAudioEngine(ctx);
    await engine.decode('a1', new Uint8Array([1]));
    engine.start([clip({ volume: 0.25 })], 0);
    expect(started[0].gain).toBeCloseTo(0.25);
  });

  it('skips clips whose asset is not decoded', async () => {
    const { ctx, started } = fakeCtx();
    const engine = createAudioEngine(ctx);
    engine.start([clip({ assetId: 'missing' })], 0);
    expect(started).toHaveLength(0);
  });

  it('skips clips that have already finished before fromTime', async () => {
    const { ctx, started } = fakeCtx();
    const engine = createAudioEngine(ctx);
    await engine.decode('a1', new Uint8Array([1]));
    engine.start([clip({ startTime: 0, outPoint: 5 })], 6); // ended at t=5, fromTime=6
    expect(started).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `pnpm exec vitest run src/services/audio/audioEngine.test.ts`
Expected: FAIL — cannot find module `./audioEngine`.

- [ ] **Step 3: Implement `audioEngine.ts`**

Create `src/services/audio/audioEngine.ts`:
```ts
import type { AudioClip } from '../../engine';

export interface AudioNodeLike {
  connect(destination: unknown): void;
}
export interface GainLike extends AudioNodeLike {
  gain: { value: number };
}
export interface AudioBufferLike {
  duration: number;
}
export interface AudioBufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  start(when: number, offset: number, duration: number): void;
  stop(): void;
}
export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: unknown;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>;
  createGain(): GainLike;
  createBufferSource(): AudioBufferSourceLike;
}

export interface AudioEngine {
  decode(assetId: string, bytes: Uint8Array): Promise<void>;
  start(clips: AudioClip[], fromTime: number): void;
  stop(): void;
  readonly currentTime: number;
}

// Framework-agnostic Web Audio scheduler. Pure timing math (start time,
// source offset, trimmed duration) is unit-tested via a fake AudioContext;
// RAF/transport wiring belongs to Plan 3.
export function createAudioEngine(ctx: AudioContextLike): AudioEngine {
  const buffers = new Map<string, AudioBufferLike>();
  let active: AudioBufferSourceLike[] = [];

  return {
    get currentTime() {
      return ctx.currentTime;
    },
    async decode(assetId, bytes) {
      // Copy into a standalone ArrayBuffer for decodeAudioData.
      const copy = bytes.slice().buffer;
      buffers.set(assetId, await ctx.decodeAudioData(copy));
    },
    start(clips, fromTime) {
      for (const clip of clips) {
        const buffer = buffers.get(clip.assetId);
        if (!buffer) continue;

        const clipDuration = clip.outPoint - clip.inPoint;
        const clipEnd = clip.startTime + clipDuration;
        if (clipEnd <= fromTime) continue; // already finished

        const startedBefore = clip.startTime <= fromTime;
        const when = ctx.currentTime + (startedBefore ? 0 : clip.startTime - fromTime);
        const offset = clip.inPoint + (startedBefore ? fromTime - clip.startTime : 0);
        const duration = clip.outPoint - offset;

        const gain = ctx.createGain();
        gain.gain.value = clip.volume;
        gain.connect(ctx.destination);

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(gain);
        source.start(when, offset, duration);
        active.push(source);
      }
    },
    stop() {
      for (const source of active) source.stop();
      active = [];
    },
  };
}
```

- [ ] **Step 4: Run the tests, verify pass**

Run: `pnpm exec vitest run src/services/audio/audioEngine.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/audio/audioEngine.ts src/services/audio/audioEngine.test.ts
git commit -m "feat(services): decoupled Web Audio playback engine

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 17: Services barrel + end-to-end integration

**Files:**
- Create: `src/services/index.ts`, `src/services/index.test.ts`

**Interfaces:**
- Consumes: every public service symbol created above.
- Produces: `src/services/index.ts` re-exporting the services public API; an integration test proving import → build project → export → unzip, and a `.savig` round-trip, work together over the engine.

- [ ] **Step 1: Write the barrel**

Create `src/services/index.ts`:
```ts
export * from './errors';
export * from './hash';
export * from './bytes';
export * from './json';
export * from './import/importSvg';
export * from './import/importAudio';
export * from './export/renderDocument';
export * from './export/buildBundle';
export * from './export/zipBundle';
export * from './export/exportProject';
export * from './persistence/savig';
export * from './persistence/migrate';
export * from './persistence/autosave';
export * from './persistence/fileAccess';
export * from './audio/audioEngine';
```

- [ ] **Step 2: Write the failing integration test**

Create `src/services/index.test.ts`:
```ts
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createProject, createSceneObject } from '../engine';
import {
  exportProject,
  importAudio,
  importSvg,
  loadSavig,
  saveSavig,
  type AssetBinaries,
} from './index';

function buildProject() {
  const { asset: svg } = importSvg(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
    'box.svg',
  );
  const { asset: audio, bytes } = importAudio('beat.mp3', new Uint8Array([1, 2, 3, 4]), 'audio/mpeg');

  const project = createProject({ name: 'Integration' });
  project.assets.push(svg, audio);
  project.objects.push(createSceneObject(svg.id, { id: 'o1' }));
  project.audioClips.push({ id: 'c1', assetId: audio.id, startTime: 0, inPoint: 0, outPoint: 1, volume: 1 });

  const binaries: AssetBinaries = { [audio.id]: bytes };
  return { project, binaries };
}

describe('services integration', () => {
  it('imports, exports, and unzips a runnable bundle', () => {
    const { project, binaries } = buildProject();
    const zip = unzipSync(exportProject(project, binaries));
    const html = strFromU8(zip['index.html']);
    expect(html).toContain('data-savig-object="o1"');
    expect(html).toContain('SavigRuntime.create');
    expect(strFromU8(zip['savig-runtime.js']).length).toBeGreaterThan(0);
  });

  it('round-trips a project through .savig', () => {
    const { project, binaries } = buildProject();
    const loaded = loadSavig(saveSavig({ project, binaries }));
    expect(loaded.project.meta.name).toBe('Integration');
    expect(loaded.project.objects).toHaveLength(1);
    expect(Object.keys(loaded.binaries)).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run it, verify failure then pass**

Run: `pnpm exec vitest run src/services/index.test.ts`
Expected: FAIL first if the barrel is incomplete; once `src/services/index.ts` exports everything, PASS (2 tests). Fix any missing re-export and re-run until green.

- [ ] **Step 4: Full verification**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: entire suite PASS (engine + UI + all services + runtime); typecheck clean; lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/services/index.ts src/services/index.test.ts
git commit -m "feat(services): public barrel and end-to-end integration test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

After all tasks:

- [ ] Run `pnpm test` — all suites pass.
- [ ] Run `pnpm typecheck` — no type errors (including the generated runtime module).
- [ ] Run `pnpm lint` — clean.
- [ ] Run `pnpm build:runtime` once more and confirm `git status` shows no change to `src/runtime/runtimeSource.generated.ts` (deterministic bundle).
- [ ] Announce: "I'm using the finishing-a-development-branch skill to complete this work." Then use **superpowers:finishing-a-development-branch**.

## Spec coverage map

| Spec section | Task(s) |
|---|---|
| §2 SVG id namespacing | 4, 5 |
| §2 content-addressed assets | 2 (hash), 5, 6 |
| §2 per-instance transform wrapper (`buildTransform`) | 7 (reuses engine) |
| §3 shared tween core in runtime | 10, 11 |
| §4 Web Audio playback & sync | 16 (engine), 10 (runtime audio) |
| §5 SVG import (parse/sanitize/namespace) | 3, 4, 5 |
| §5 audio import (validate/store) | 6 |
| §5 HTML5 export (inline svg + runtime + base64 audio) | 7, 8, 9, 11 |
| §5 deterministic output / golden-file | 7, 8 |
| §5 missing-asset failure | 7, 8 |
| §7 `.savig` zip round-trip | 12 |
| §7 IndexedDB autosave + graceful degradation | 14 |
| §7 versioning & migration registry | 13 |
| §7 File System Access + fallback | 15 |
| §9 runtime parity test | 10 |
| §9 services golden-file tests | 7, 8 |

**Deferred to Plan 3 (UI):** Playwright e2e smoke test (needs UI to drive import/keyframe); wiring AudioEngine + runtime to the editor's RAF clock/transport; scrubbing-silence behavior; autoplay gesture handling in the editor.
```