# AssetPanel Vector-Asset Filter Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop per-shape `vector` assets from appearing in (and mis-routing clicks within) the
AssetPanel library list.

**Architecture:** Change the AssetPanel top-list filter from a symbol-blacklist
(`kind !== 'symbol'`) to a reusable-kind whitelist (`kind === 'svg' || kind === 'audio'`). UI-only;
no engine/store/serialization change.

**Tech Stack:** React 18 + TS strict, Zustand store, Vitest + RTL.

## Global Constraints

- preview == export parity is non-negotiable (trivially preserved here: UI-list-only change).
- TS strict; no `any`. Follow existing AssetPanel patterns.

---

### Task 1: Whitelist reusable kinds in the AssetPanel list

**Files:**
- Modify: `src/ui/components/AssetPanel/AssetPanel.tsx:45` (the `nonSymbols` filter) and its usage at
  `:70` (the `.map`).
- Test: `src/ui/components/AssetPanel/AssetPanel.test.tsx` (update one test, add one).

**Interfaces:**
- Consumes: `assets: Asset[]` (already subscribed at `AssetPanel.tsx:14`); `Asset.kind` is
  `'svg' | 'audio' | 'vector' | 'symbol'`.
- Produces: no new exports — internal rename `nonSymbols` → `libraryAssets`.

- [ ] **Step 1: Update the existing vector-row RTL test to expect NO row (red)**

In `src/ui/components/AssetPanel/AssetPanel.test.tsx`, replace the body of
`it('a per-shape vector asset row has no rename/delete controls (47d)', ...)` with an assertion that
the vector asset renders no row, alongside an svg asset that does:

```tsx
it('a per-shape vector asset is not listed in the library (47d)', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addAsset(createVectorAsset('rect', { id: 'v', name: 'Rectangle', shapeType: 'rect' }));
  s.addAsset({ kind: 'svg', id: 'a', name: 'box.svg', viewBox: '0 0 10 10', markup: '<rect/>' });
  render(<AssetPanel />);
  expect(screen.queryByTestId('asset-v')).not.toBeInTheDocument(); // per-shape geometry, not a library item
  expect(screen.getByTestId('asset-a')).toBeInTheDocument(); // reusable svg still listed
});
```

(Use the exact `svg` asset shape the other tests in this file already use for `id: 'a'` — copy it
from the rename/delete test above so the fields match `SvgAsset`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/ui/components/AssetPanel/AssetPanel.test.tsx -t "not listed in the library"`
Expected: FAIL — `asset-v` is currently in the document.

- [ ] **Step 3: Change the filter to a whitelist**

In `src/ui/components/AssetPanel/AssetPanel.tsx`, replace:

```tsx
const symbols = assets.filter((a) => a.kind === 'symbol');
const nonSymbols = assets.filter((a) => a.kind !== 'symbol');
```

with:

```tsx
const symbols = assets.filter((a) => a.kind === 'symbol');
// Only reusable library imports get a row; per-shape `vector` assets are 1:1 with their object
// (not library items) and `symbol` assets have their own section below. (47d)
const libraryAssets = assets.filter((a) => a.kind === 'svg' || a.kind === 'audio');
```

Then update the map at `:70` from `nonSymbols.map(...)` to `libraryAssets.map(...)`.

- [ ] **Step 4: Run the updated/added tests to verify they pass**

Run: `npx vitest run src/ui/components/AssetPanel/AssetPanel.test.tsx`
Expected: PASS (all AssetPanel tests).

- [ ] **Step 5: Add a mis-route regression test**

Append to `AssetPanel.test.tsx`:

```tsx
it('clicking an audio row adds an audio clip while a sibling vector asset stays unlisted (47d)', async () => {
  const s = useEditor.getState();
  s.newProject();
  s.addAsset(createVectorAsset('rect', { id: 'v', name: 'Rectangle', shapeType: 'rect' }));
  s.addAsset({ kind: 'audio', id: 'snd', name: 'beep.wav', mime: 'audio/wav', duration: 1, byteLength: 4 });
  render(<AssetPanel />);
  expect(screen.queryByTestId('asset-v')).not.toBeInTheDocument();
  await userEvent.click(screen.getByTestId('asset-snd'));
  // an audio clip was added (a timeline clip referencing the audio asset)
  expect(useEditor.getState().history.present.audio.clips.some((c) => c.assetId === 'snd')).toBe(true);
});
```

NOTE: verify the exact `AudioAsset` shape (fields + names) and the audio-clips location
(`history.present.audio.clips` vs other) against `src/engine/types.ts` and the store before running;
adjust the literal and the assertion path to match. If the audio-clip assertion is awkward, fall back
to asserting the audio row is present and the vector row is absent (the core of this slice).

- [ ] **Step 6: Run AssetPanel tests + typecheck**

Run: `npx vitest run src/ui/components/AssetPanel/AssetPanel.test.tsx && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/ui/components/AssetPanel/AssetPanel.tsx src/ui/components/AssetPanel/AssetPanel.test.tsx
git commit -m "fix(assetpanel): list only reusable svg/audio assets, not per-shape vectors (47d)"
```

---

## Self-Review

- **Spec coverage:** filter change (Task 1 Step 3), updated vector test (Step 1), mis-route
  regression (Step 5) — all spec items covered.
- **Placeholder scan:** the two test literals (`svg`/`audio` asset shapes, audio-clips path) are
  flagged to verify against `types.ts`/store before running — this is a real verification step, not a
  placeholder; the fallback assertion is specified.
- **Type consistency:** `libraryAssets` replaces `nonSymbols` at both its definition and its single
  use site; no other references.
