# Savig M4 — AssetPanel Vector-Asset Filter (47d cleanup)

**Date:** 2026-06-26
**Milestone:** M4 (grouping, layers & nested symbols)
**Status:** design — a focused 47d library-panel correctness fix.

---

## 1. Motivation

The `Asset` union has four kinds:

- `svg` and `audio` — **reusable library imports**: imported once, placed many times
  (`addObject(assetId)` / `addAudioClip(assetId)`).
- `vector` — **per-object geometry**: drawing a shape creates one `VectorAsset` bound 1:1 to its
  `SceneObject` (and `duplicate.ts` clones the asset per copy). It is an implementation detail of a
  drawn object, not a library item.
- `symbol` — rendered in its own "Symbols" section.

The AssetPanel top list is built with a **blacklist**: `assets.filter((a) => a.kind !== 'symbol')`.
That accidentally includes every per-shape `vector` asset. Two concrete problems:

1. **Visual noise:** every drawn rectangle/ellipse/path adds a junk row to the "library" list.
2. **Mis-routing:** the row's onClick is `a.kind === 'svg' ? addObject(a.id) : addAudioClip(a.id)`.
   A `vector` asset is not `svg`, so clicking its row calls **`addAudioClip(vectorId)`** — adding a
   bogus audio clip referencing a vector asset.

## 2. Approach

Replace the symbol-blacklist with a **reusable-kind whitelist**. The top list shows only the kinds
that are genuinely placeable-from-library:

```ts
const libraryAssets = assets.filter((a) => a.kind === 'svg' || a.kind === 'audio');
```

`vector` assets simply never render a row (symbols keep their dedicated section). This is the same
allow-list already used one line below for the `manageable` (rename/delete) flag, so the two now
agree: a row exists iff it is svg/audio.

Because only `svg` and `audio` rows remain, the onClick binary (`svg ? addObject : addAudioClip`) can
no longer mis-route — `addAudioClip` is now reachable only for actual audio assets.

### Why whitelist over blacklist

A whitelist is future-proof: any new non-reusable asset kind is excluded by default rather than
leaking into the library until someone remembers to blacklist it. The list's identity is "things you
can place from the library," which is exactly svg + audio.

## 3. Scope

**In:** change the AssetPanel top-list filter from `kind !== 'symbol'` to the svg/audio whitelist;
rename the local from `nonSymbols` to `libraryAssets` for clarity; update the existing RTL test that
asserted a vector row renders.

**Out / unaffected:**
- Symbols section, rename/delete, drag-to-place, thumbnails — untouched.
- The engine, store, and serialization — untouched (vector assets still exist on the project; they
  are just not listed as library items).
- No change to how drawing/duplication creates vector assets.

## 4. Regression-safety

- No render-pipeline change → preview == export parity trivially preserved (this is UI-list-only).
- The only behavioral change is which rows the panel renders; svg/audio rows are byte-identical.

## 5. Testing strategy

- **RTL (`AssetPanel.test.tsx`):**
  - UPDATE the existing `'a per-shape vector asset row has no rename/delete controls (47d)'` test:
    a vector asset now renders **no row at all** — assert `screen.queryByTestId('asset-v')` is
    `null` (and, for good measure, that an svg asset in the same project still renders its row).
  - ADD a regression test: a project with one `vector` asset and one `audio` asset renders only the
    audio row; clicking it calls `addAudioClip` (not the vector). Simplest faithful assertion: the
    audio row is present and the vector row is absent.
- Full unit suite + typecheck + e2e remain green (no e2e change expected; drawn-shape flows do not
  assert vector rows in the panel — to be verified during implementation).
