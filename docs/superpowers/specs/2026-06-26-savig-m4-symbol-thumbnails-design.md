# Savig M4 — Symbol Library Thumbnails (47d polish)

**Date:** 2026-06-26
**Milestone:** M4 (grouping, layers & nested symbols)
**Status:** design — the first slice47d polish item. The in-symbol editing surface is fully closed;
this adds a rendered thumbnail per symbol in the AssetPanel "Symbols" library section.

---

## 1. Motivation

The AssetPanel "Symbols" section lists each symbol as `Name (count)` text only — there is no visual
preview of what a symbol looks like. A rendered thumbnail (a small SVG snapshot of the symbol's content)
makes the library browsable at a glance, matching how other authoring tools present reusable clips.

## 2. Architecture

Reuse the canonical project→SVG renderer so the thumbnail looks identical to preview/export, with no
duplicated rendering logic.

### 2.1 `renderSvgDocument` viewBox override (export-path, parity-safe)

`renderSvgDocument(project)` returns a self-contained `<svg viewBox="0 0 W H">…</svg>` fragment where
`W`/`H` are `project.meta.width`/`height`. A symbol's members keep their AUTHORED artboard coordinates
(createSymbol does not normalize to origin), so a thumbnail must frame the content's actual bounds, not
`0 0 W H`. Add an optional second argument:

```ts
export function renderSvgDocument(project: Project, opts?: { viewBox?: string }): string
```

When `opts.viewBox` is provided it replaces the default `0 0 W H`; when absent the output is
BYTE-IDENTICAL to today (the export path passes no opts). This is the only change to the export module
and is covered by a regression test (`renderSvgDocument(project)` unchanged) plus a new test
(`{ viewBox }` honored).

### 2.2 Thumbnail render helper (UI)

New `src/ui/components/AssetPanel/symbolThumbnail.ts`:

```ts
// The SVG string for a symbol's content thumbnail, framed to its content bounds at t=0, or null
// when the symbol has no drawable content (caller renders a placeholder).
export function symbolThumbnailSvg(project: Project, symbol: SymbolAsset): string | null {
  const box = sceneContentAABB(symbol.objects, project.assets, 0);
  if (!box) return null; // empty symbol -> placeholder
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  if (w <= 0 || h <= 0) return null; // degenerate -> placeholder
  const viewBox = `${box.minX} ${box.minY} ${w} ${h}`;
  return renderSvgDocument({ ...project, objects: symbol.objects }, { viewBox });
}
```

- `sceneContentAABB(objects, assets, 0)` (Stage/snapping) returns the content bounds at t=0 (or null);
  it already handles groups + nested instances (cycle-guarded). A nested-instance symbol renders
  correctly because `renderSvgDocument` → `flattenInstances` expands instances.
- The synthetic project is `{ ...project, objects: symbol.objects }` — the symbol's content as the root
  scene, with the GLOBAL assets and meta. No mutation of the real project.

### 2.3 `<SymbolThumbnail>` component + AssetPanel wiring

New `src/ui/components/AssetPanel/SymbolThumbnail.tsx`:

```tsx
export function SymbolThumbnail({ project, symbol }: { project: Project; symbol: SymbolAsset }) {
  const svg = useMemo(() => symbolThumbnailSvg(project, symbol), [project, symbol]);
  if (!svg) return <div className={styles.thumbEmpty} data-testid="symbol-thumb-empty" aria-hidden />;
  return <div className={styles.thumb} data-testid="symbol-thumb" aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />;
}
```

- `useMemo` keyed on `[project, symbol]` recomputes only when the symbol's content (its asset ref) or the
  project changes — AssetPanel already subscribes narrowly to `objects`/`assets`, so editing a symbol
  swaps its asset ref and refreshes its thumbnail; other symbols' thumbnails are reused.
- `dangerouslySetInnerHTML` is safe here: the SVG is produced by our own `renderSvgDocument` from
  in-memory project data (the same sanitized output the export bundle ships), not external HTML.
- AssetPanel renders `<SymbolThumbnail>` inside each symbol `<button>` row, above the existing
  `{name} ({count})` label. The button keeps its click-to-place + cyclic-disabled behaviour.

The AssetPanel passes the project: it reads `meta` non-reactively (`useEditor.getState().history.present.meta`)
combined with its subscribed `objects`/`assets`, or subscribes to `history.present` for the symbol rows;
to keep the narrow subscription, build the project for the helper from the subscribed `objects`/`assets`
plus a one-time `meta` read (meta width/height are unused under the viewBox override; only the Project
shape is needed).

## 3. Parity, perf, safety

- **Export parity (preview == export)** is untouched: `renderSvgDocument` with no opts is byte-identical;
  the thumbnail is a NEW, separate consumer that never affects the export bundle.
- **Perf:** thumbnails are memoized per symbol; a symbol re-renders only when its content changes. The
  AssetPanel already re-renders only on `objects`/`assets` change.
- **Empty / degenerate symbols:** `sceneContentAABB` null or non-positive size → a placeholder box (no
  crash).
- **No store/engine-render change beyond the optional viewBox arg.**

## 4. Scope (this slice) vs deferred

**In:** the `renderSvgDocument` viewBox override; `symbolThumbnailSvg` helper; `<SymbolThumbnail>`
component; AssetPanel wiring; CSS for the thumbnail box; tests (export + helper + RTL + e2e).

**Deferred (separate 47d slices):** drag-to-place an instance from the library with a drop point;
recompute the instance anchor on `swapSymbol`; rename / delete-symbol management in the library.

## 5. Risks / tradeoffs

- **`renderSvgDocument` is on the export path:** the change is an additive optional argument with a
  defaulted value; a regression test pins the no-opts output. This is the minimal, DRY way to reuse the
  canonical renderer (the alternative — a parallel thumbnail renderer — would duplicate the body/defs
  generation and risk drifting from export).
- **Authored-coordinate framing:** the viewBox is the content AABB (`minX minY w h`), correct because
  symbol members keep authored coords; verified against `createSymbol`'s width/height semantics.
- **DOMParser/XMLSerializer** used by `renderSvgDocument` for svg-asset defs run in the browser and in
  jsdom (tests), so the thumbnail renders in both.

## 6. Testing strategy

- `renderDocument.test.ts`: `renderSvgDocument(project)` (no opts) is unchanged (existing tests); a new
  test asserts `renderSvgDocument(project, { viewBox: 'a b c d' })` emits `viewBox="a b c d"`.
- `symbolThumbnail.test.ts`: for a symbol with content offset from origin, `symbolThumbnailSvg` returns an
  `<svg>` whose `viewBox` equals the content AABB and whose body contains the content's drawn element; an
  EMPTY symbol returns `null`.
- RTL (`AssetPanel.test.tsx`): a symbol row renders a `symbol-thumb` element (the thumbnail svg) AND still
  shows `{name} ({count})`; an empty symbol shows `symbol-thumb-empty`.
- e2e (`symbols.spec.ts`): create a symbol from a drawn rect → its library row shows a thumbnail `<svg>`.
