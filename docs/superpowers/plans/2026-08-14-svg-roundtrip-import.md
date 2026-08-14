# SVG Round-Trip Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Animated-SVG exports embed the full project so the app can open them like `.savig` files; imported SVG assets keep safe SMIL so they play; opening a plain SVG wraps it as a new project.

**Architecture:** The emitter (`animatedSvg.ts`) inserts a `<metadata data-savig-source="project">` element carrying `stableJson({project, audio})`. A new sniffing loader (`loadProjectOrSvg`) dispatches zip → `loadSavig`, SVG-with-metadata → `migrateProject`, plain SVG → caller-side wrap. The sanitizer strips `<metadata>` but now keeps SMIL elements unless they animate a ref/id/style/handler attribute.

**Tech Stack:** TypeScript strict, Vitest (jsdom env for `packages/services` + `apps/react`), Playwright e2e, fflate, DOMParser/XMLSerializer.

**Spec:** `docs/superpowers/specs/2026-08-14-svg-roundtrip-import.md`

## Global Constraints

- Run tools directly from `node_modules/.bin/` (`node_modules/.bin/vitest`, `node_modules/.bin/tsc`, `node_modules/.bin/eslint`, `node_modules/.bin/playwright`) — `pnpm <script>` is broken for subagents (install gate). Never write to `pnpm-workspace.yaml`.
- Unit test command shape: `node_modules/.bin/vitest run <file> --reporter=basic`. Typecheck: `node_modules/.bin/tsc -b`. Lint: `node_modules/.bin/eslint <files>`.
- TS-strict; no `any` unless the file already uses that idiom (e.g. picker interop casts).
- Match existing comment density/idiom. Wrapper `<g>` firstElementChild-is-shape contract must hold (metadata goes on the ROOT `<svg>`, inserted before existing children — root has no shape contract).
- All existing tests must stay green; when a test's *expectation* changes by design (sanitizer keeps SMIL now), update that test in the same task.

---

### Task 1: Embed project metadata in the animated SVG exporter

**Files:**
- Modify: `packages/services/src/export/animatedSvg.ts` (imports at :6-14, `renderAnimatedSvgDocument` :247-404)
- Modify: `apps/react/src/ui/fileOps.ts:61-70` (`exportAnimatedSvg` passes binaries)
- Test: `packages/services/src/export/animatedSvg.test.ts` (append new describe block)

**Interfaces:**
- Consumes: `stableJson` from `../json`, `bytesToBase64` from `../bytes`, `AssetBinaries` from `./buildBundle` (all already exported from those modules).
- Produces: `renderAnimatedSvgDocument(project: Project, env?: DomEnv, binaries?: AssetBinaries): string` — third optional param; output always contains exactly one `metadata[data-savig-source="project"]` as the first child of `<svg>`, textContent = `stableJson({ audio, project })` where `audio: Record<string, string>` (assetId → base64, only ids present in `binaries` and referenced by `project.audioClips`). Zero-duration projects now ALSO parse+serialize (metadata embedded; still zero animation elements).

- [ ] **Step 1: Write the failing tests** (append to `animatedSvg.test.ts`, reusing that file's existing project-builder helpers — read its head first and build projects the same way):

```ts
describe('embedded project metadata', () => {
  it('embeds the full project as the first <svg> child and round-trips exactly', () => {
    const project = /* animated project via this file's existing builder */;
    const markup = renderAnimatedSvgDocument(project);
    const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
    const meta = doc.querySelectorAll('metadata[data-savig-source="project"]');
    expect(meta.length).toBe(1);
    expect(doc.documentElement.firstElementChild).toBe(meta[0]);
    const payload = JSON.parse(meta[0].textContent ?? '');
    expect(payload.project).toEqual(JSON.parse(JSON.stringify(project)));
    expect(payload.audio).toEqual({});
  });

  it('embeds metadata on a zero-duration project too (static passthrough removed)', () => {
    const project = /* static project via existing builder, duration 0 */;
    const markup = renderAnimatedSvgDocument(project);
    const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
    expect(doc.querySelector('metadata[data-savig-source="project"]')).not.toBeNull();
    expect(doc.querySelectorAll('animate, animateTransform').length).toBe(0);
  });

  it('embeds referenced audio binaries as base64', () => {
    const project = /* builder */;
    project.audioClips = [{ id: 'clip1', assetId: 'aud1', start: 0 } as never];
    const bytes = new Uint8Array([1, 2, 250, 255]);
    const markup = renderAnimatedSvgDocument(project, undefined, { aud1: bytes, unrelated: new Uint8Array([9]) });
    const meta = new DOMParser().parseFromString(markup, 'image/svg+xml')
      .querySelector('metadata[data-savig-source="project"]');
    const payload = JSON.parse(meta!.textContent ?? '');
    expect(Object.keys(payload.audio)).toEqual(['aud1']);
    expect(Array.from(base64ToBytes(payload.audio.aud1))).toEqual([1, 2, 250, 255]);
  });

  it('markup-looking strings in the project stay escaped text (no element leakage)', () => {
    const project = /* builder */;
    project.meta.name = '</metadata><script>alert(1)</script>';
    const markup = renderAnimatedSvgDocument(project);
    const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.querySelector('script')).toBeNull();
    const payload = JSON.parse(doc.querySelector('metadata[data-savig-source="project"]')!.textContent ?? '');
    expect(payload.project.meta.name).toBe('</metadata><script>alert(1)</script>');
  });
});
```

Check the `audioClips` element type in `packages/engine/src/types.ts` (~:419, field `assetId`) and use its real shape instead of the `as never` sketch if it is small.

- [ ] **Step 2: Run to verify failure**

Run: `node_modules/.bin/vitest run packages/services/src/export/animatedSvg.test.ts --reporter=basic`
Expected: new tests FAIL (no metadata element; zero-duration returns raw markup).

- [ ] **Step 3: Implement**

In `animatedSvg.ts`:

```ts
import { stableJson } from '../json';
import { bytesToBase64 } from '../bytes';
import type { AssetBinaries } from './buildBundle';

/** Embed the editable source (full project JSON + referenced audio binaries) as the root's
 *  first child. textContent assignment makes XMLSerializer entity-escape the JSON, so this
 *  survives any string content and decodes transparently on DOMParser read (open path). */
function embedProjectMetadata(doc: Document, project: Project, binaries?: AssetBinaries): void {
  const audio: Record<string, string> = {};
  for (const clip of project.audioClips) {
    const bytes = binaries?.[clip.assetId];
    if (bytes) audio[clip.assetId] = bytesToBase64(bytes);
  }
  const meta = doc.createElementNS(SVG_NS, 'metadata');
  meta.setAttribute('data-savig-source', 'project');
  meta.textContent = stableJson({ audio, project });
  doc.documentElement.insertBefore(meta, doc.documentElement.firstChild);
}
```

Restructure `renderAnimatedSvgDocument` so the parse happens unconditionally (delete the `if (!sampled) return markup;` early return at :252; keep the camera-attr fixup as-is), call `embedProjectMetadata(doc, project, binaries)` right after parsing, and wrap the existing animation-appending body (everything from `const timing = timingAttrs(sampled)` through `appendCameraAndSceneAnims`) in `if (sampled) { ... }`. Signature: `export function renderAnimatedSvgDocument(project: Project, env?: DomEnv, binaries?: AssetBinaries): string`.

In `fileOps.ts` `exportAnimatedSvg`, change the render call to `renderAnimatedSvgDocument(project, undefined, useEditor.getState().binaries)` (grab `binaries` from the same `getState()` snapshot used for `project` — read once).

- [ ] **Step 4: Run the full impacted test set**

Run: `node_modules/.bin/vitest run packages/services packages/core packages/mcp apps/react/src/ui --reporter=basic`
Expected: PASS. If an existing test asserted the zero-duration raw-markup passthrough or exact element counts/snapshots (MCP `export_svg` tests included), update those expectations — the delta must be exactly the one `<metadata>` element and `data-savig-camera=""` normalization on the zero-duration path, nothing else.

- [ ] **Step 5: Typecheck + lint + commit**

Run: `node_modules/.bin/tsc -b && node_modules/.bin/eslint packages/services/src/export/animatedSvg.ts apps/react/src/ui/fileOps.ts`

```bash
git add packages/services/src/export/animatedSvg.ts packages/services/src/export/animatedSvg.test.ts apps/react/src/ui/fileOps.ts
git commit -m "feat(export): embed project JSON + audio metadata in animated SVG for round-trip open"
```

---

### Task 2: `loadProjectOrSvg` sniffing loader

**Files:**
- Create: `packages/services/src/persistence/openFile.ts`
- Modify: `packages/services/src/index.ts` (add `export * from './persistence/openFile';` after the savig line)
- Test: `packages/services/src/persistence/openFile.test.ts`

**Interfaces:**
- Consumes: `loadSavig`/`SavigFile` from `./savig`, `saveSavig` (tests), `migrateProject` from `./migrate`, `SavigLoadError` from `../errors`, `base64ToBytes` from `../bytes`, `strFromU8` from `fflate`, `renderAnimatedSvgDocument` (tests, Task 1 signature), `AssetBinaries` from `../export/buildBundle`.
- Produces:
  ```ts
  export type OpenedFile =
    | { kind: 'project'; file: SavigFile }
    | { kind: 'plain-svg'; source: string };
  export function loadProjectOrSvg(bytes: Uint8Array): OpenedFile;
  ```
  Throws `SavigLoadError` (bad file / corrupt embedded JSON) and lets `migrateProject`'s errors (`SavigLoadError`, `UnsupportedVersionError`) propagate.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { strToU8 } from 'fflate';
import { createProject } from '@savig/engine';
import { renderAnimatedSvgDocument } from '../export/animatedSvg';
import { SavigLoadError, UnsupportedVersionError } from '../errors';
import { saveSavig } from './savig';
import { loadProjectOrSvg } from './openFile';

// Build a small real project the same way savig.test.ts does (read that file's builder
// and reuse its approach; createProject() + one rect object is enough).

describe('loadProjectOrSvg', () => {
  it('opens a .savig zip (PK sniff) exactly like loadSavig', () => {
    const project = createProject({ name: 'Zip' });
    const opened = loadProjectOrSvg(saveSavig({ project, binaries: {} }));
    expect(opened.kind).toBe('project');
    if (opened.kind === 'project') expect(opened.file.project).toEqual(project);
  });

  it('opens an exported animated SVG back into the identical project', () => {
    const project = /* animated project builder */;
    const bytes = strToU8(renderAnimatedSvgDocument(project));
    const opened = loadProjectOrSvg(bytes);
    expect(opened.kind).toBe('project');
    if (opened.kind === 'project')
      expect(opened.file.project).toEqual(JSON.parse(JSON.stringify(project)));
  });

  it('restores embedded audio binaries byte-identically', () => {
    const project = createProject({ name: 'Aud' });
    project.audioClips = [/* real AudioClip shape, assetId 'a1' */];
    const bytes = strToU8(renderAnimatedSvgDocument(project, undefined, { a1: new Uint8Array([7, 8, 9]) }));
    const opened = loadProjectOrSvg(bytes);
    if (opened.kind === 'project') expect(Array.from(opened.file.binaries.a1)).toEqual([7, 8, 9]);
  });

  it('classifies a valid SVG without savig metadata as plain-svg with the source text', () => {
    const src = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5"/></svg>';
    expect(loadProjectOrSvg(strToU8(src))).toEqual({ kind: 'plain-svg', source: src });
  });

  it('rejects bytes that are neither zip nor SVG', () => {
    expect(() => loadProjectOrSvg(strToU8('hello'))).toThrow(SavigLoadError);
  });

  it('rejects corrupt embedded JSON', () => {
    const src = '<svg xmlns="http://www.w3.org/2000/svg"><metadata data-savig-source="project">{nope</metadata></svg>';
    expect(() => loadProjectOrSvg(strToU8(src))).toThrow(SavigLoadError);
  });

  it('gates embedded projects on version like .savig (newer version rejected)', () => {
    const project = createProject({ name: 'Future' });
    project.meta.version = 99;
    const bytes = strToU8(renderAnimatedSvgDocument(project));
    expect(() => loadProjectOrSvg(bytes)).toThrow(UnsupportedVersionError);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node_modules/.bin/vitest run packages/services/src/persistence/openFile.test.ts --reporter=basic`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `openFile.ts`**

```ts
import { strFromU8 } from 'fflate';
import { SavigLoadError } from '../errors';
import { base64ToBytes } from '../bytes';
import type { AssetBinaries } from '../export/buildBundle';
import { loadSavig, type SavigFile } from './savig';
import { migrateProject } from './migrate';

export type OpenedFile =
  | { kind: 'project'; file: SavigFile }
  | { kind: 'plain-svg'; source: string };

/** Sniff open-dialog bytes: .savig zip, an SVG with an embedded savig project (round-trip
 *  export), or a plain SVG the caller may wrap as an asset. Version gating for embedded
 *  projects is migrateProject — identical to the .savig path. */
export function loadProjectOrSvg(bytes: Uint8Array): OpenedFile {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return { kind: 'project', file: loadSavig(bytes) };

  const source = strFromU8(bytes);
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (doc.querySelector('parsererror') || doc.documentElement.tagName.toLowerCase() !== 'svg') {
    throw new SavigLoadError('File is neither a .savig archive nor an SVG document.');
  }

  const meta = doc.querySelector('metadata[data-savig-source="project"]');
  if (!meta) return { kind: 'plain-svg', source };

  let payload: { project?: unknown; audio?: Record<string, string> };
  try {
    payload = JSON.parse(meta.textContent ?? '');
  } catch {
    throw new SavigLoadError('Embedded Savig project data is corrupt.');
  }
  const project = migrateProject(payload.project);
  const binaries: AssetBinaries = {};
  for (const [id, b64] of Object.entries(payload.audio ?? {})) binaries[id] = base64ToBytes(b64);
  return { kind: 'project', file: { project, binaries } };
}
```

Add the index export line.

- [ ] **Step 4: Run tests**

Run: `node_modules/.bin/vitest run packages/services --reporter=basic`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint + commit**

```bash
node_modules/.bin/tsc -b && node_modules/.bin/eslint packages/services/src/persistence/openFile.ts
git add packages/services/src/persistence/openFile.ts packages/services/src/persistence/openFile.test.ts packages/services/src/index.ts
git commit -m "feat(persistence): loadProjectOrSvg — open .savig zips and round-trip SVGs from one sniffing loader"
```

---

### Task 3: `openProject` accepts `.svg` (embedded project or wrap-as-asset)

**Files:**
- Modify: `apps/react/src/ui/fileOps.ts:24-33` (`openProject`)
- Test: create `apps/react/src/ui/fileOps.test.ts`

**Interfaces:**
- Consumes: `loadProjectOrSvg`/`OpenedFile` + `importSvg` from `@savig/services`; `createProject`, `createSceneObject` from `@savig/engine`; existing `openBytesFromDisk`, `useEditor`.
- Produces: unchanged export `openProject(): Promise<void>`; picker accept list `'.savig,.svg'`.

- [ ] **Step 1: Write the failing tests** — drive through a stubbed `window.showOpenFilePicker` (jsdom env; `fileAccess` prefers the picker, so no input fallback fires). Read `apps/react/src/ui/store/store.ts` usage in neighboring tests (e.g. `CommandPalette.test.tsx`) for how to reset/read `useEditor` state.

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { strToU8 } from 'fflate';
import { createProject } from '@savig/engine';
import { renderAnimatedSvgDocument, saveSavig } from '@savig/services';
import { openProject } from './fileOps';
import { useEditor } from './store/store';

function stubPicker(name: string, bytes: Uint8Array): void {
  (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker = vi.fn(async () => [
    { getFile: async () => new File([bytes as unknown as BlobPart], name) },
  ]);
}
afterEach(() => {
  delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
});

describe('openProject', () => {
  it('opens an exported animated SVG as the full project', async () => {
    const project = createProject({ name: 'RoundTrip' });
    stubPicker('roundtrip.svg', strToU8(renderAnimatedSvgDocument(project)));
    await openProject();
    expect(useEditor.getState().history.present.meta.name).toBe('RoundTrip');
  });

  it('still opens .savig zips', async () => {
    const project = createProject({ name: 'ZipOpen' });
    stubPicker('p.savig', saveSavig({ project, binaries: {} }));
    await openProject();
    expect(useEditor.getState().history.present.meta.name).toBe('ZipOpen');
  });

  it('wraps a plain SVG as a new project with one svg-asset object', async () => {
    const src = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200"><rect width="10" height="10"/></svg>';
    stubPicker('drawing.svg', strToU8(src));
    await openProject();
    const p = useEditor.getState().history.present;
    expect(p.meta.name).toBe('drawing');
    expect(p.meta.width).toBe(320);
    expect(p.meta.height).toBe(200);
    expect(p.assets).toHaveLength(1);
    expect(p.assets[0].kind).toBe('svg');
    expect(p.objects).toHaveLength(1);
    expect(p.objects[0].assetId).toBe(p.assets[0].id);
  });

  it('surfaces unreadable files as an error toast, project untouched', async () => {
    const before = useEditor.getState().history.present;
    stubPicker('junk.bin', strToU8('not an svg'));
    await openProject();
    expect(useEditor.getState().history.present).toBe(before);
    const toasts = useEditor.getState().toasts; // adjust to the store's real toast field
    expect(toasts.some((t) => t.level === 'error')).toBe(true);
  });
});
```

Adjust the toast-field read to the store's actual shape (grep `pushToast` in `packages/editor-state/src/store.ts`) — assert on whatever list the store keeps.

- [ ] **Step 2: Run to verify failure**

Run: `node_modules/.bin/vitest run apps/react/src/ui/fileOps.test.ts --reporter=basic`
Expected: FAIL — wrap path missing (plain-svg test), possibly accept-list test differences.

- [ ] **Step 3: Implement**

```ts
export async function openProject(): Promise<void> {
  try {
    const picked = await openBytesFromDisk('.savig,.svg');
    if (!picked) return;
    const opened = loadProjectOrSvg(picked.bytes);
    if (opened.kind === 'project') {
      useEditor.getState().setProject(opened.file.project, opened.file.binaries);
      return;
    }
    // Plain SVG: wrap as a new single-asset project (spec goal 3). The asset keeps any
    // safe SMIL (sanitizer), so an animated SVG plays as a black box immediately.
    const { asset, warnings } = importSvg(opened.source, picked.name);
    const project = createProject({
      name: picked.name.replace(/\.svg$/i, ''),
      width: Math.round(asset.width),
      height: Math.round(asset.height),
    });
    project.assets.push(asset);
    project.objects.push(createSceneObject(asset.id, { name: asset.name }));
    useEditor.getState().setProject(project, {});
    const s = useEditor.getState();
    warnings.forEach((w) => s.pushToast('info', w));
  } catch (err) {
    useEditor.getState().pushToast('error', (err as Error).message);
  }
}
```

Imports: add `importSvg`, `loadProjectOrSvg` to the `@savig/services` import; add `import { createProject, createSceneObject } from '@savig/engine';`.

- [ ] **Step 4: Run tests**

Run: `node_modules/.bin/vitest run apps/react/src/ui --reporter=basic`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint + commit**

```bash
node_modules/.bin/tsc -b && node_modules/.bin/eslint apps/react/src/ui/fileOps.ts apps/react/src/ui/fileOps.test.ts
git add apps/react/src/ui/fileOps.ts apps/react/src/ui/fileOps.test.ts
git commit -m "feat(editor): Open accepts .svg — embedded savig project round-trips; plain SVG wraps as a new asset project"
```

---

### Task 4: Sanitizer — strip `<metadata>`, keep safe SMIL

**Files:**
- Modify: `packages/services/src/import/sanitizeSvg.ts`
- Test: `packages/services/src/import/sanitizeSvg.test.ts` (update SMIL-strip expectations + add cases), `packages/services/src/import/importSvg.test.ts` (update if it asserts SMIL removal)

**Interfaces:**
- Consumes: nothing new.
- Produces: same export `sanitizeSvgElement(svg: Element): string[]`. New behavior: `metadata` elements always removed; SMIL elements kept unless `attributeName` is unsafe (then removed with a warning naming the tag and attribute).

- [ ] **Step 1: Update/write the failing tests.** First read `sanitizeSvg.test.ts` fully. Flip existing "removes SMIL" assertions to the new contract and add:

```ts
it('removes <metadata> (embedded savig project data must not enter assets)', () => {
  const svg = parse('<svg xmlns="http://www.w3.org/2000/svg"><metadata data-savig-source="project">{}</metadata><rect/></svg>');
  sanitizeSvgElement(svg);
  expect(svg.querySelector('metadata')).toBeNull();
});

it('keeps safe SMIL animation elements', () => {
  const svg = parse(`<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10">
    <animate attributeName="width" values="10;20;10" dur="1s" repeatCount="indefinite"/>
    <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="2s"/>
  </rect><path d="M0 0 L10 10" id="p"/><circle r="2"><animateMotion dur="3s"><mpath href="#p"/></animateMotion></circle></svg>`);
  const warnings = sanitizeSvgElement(svg);
  expect(svg.querySelectorAll('animate, animateTransform, animateMotion, mpath').length).toBe(4);
  expect(warnings).toEqual([]);
});

it.each([
  ['href', '<set attributeName="href" to="javascript:alert(1)"/>'],
  ['xlink:href', '<animate attributeName="xlink:href" values="javascript:x"/>'],
  ['style', '<animate attributeName="style" values="fill:red"/>'],
  ['id', '<set attributeName="id" to="savig-asset-x"/>'],
  ['class', '<set attributeName="class" to="toolbar"/>'],
  ['data-savig-object', '<set attributeName="data-savig-object" to="torso"/>'],
  ['onclick', '<set attributeName="onclick" to="x"/>'],
  ['HREF', '<set attributeName="HREF" to="javascript:x"/>'],
])('removes SMIL animating unsafe attribute %s (with warning)', (_name, smil) => {
  const svg = parse(`<svg xmlns="http://www.w3.org/2000/svg"><a>${smil}</a></svg>`);
  const warnings = sanitizeSvgElement(svg);
  expect(svg.querySelectorAll('set, animate').length).toBe(0);
  expect(warnings.length).toBe(1);
});

it('still strips unsafe refs and on* attributes ON SMIL elements it keeps', () => {
  const svg = parse('<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"><animateMotion dur="1s" onend="alert(1)"><mpath href="https://evil.example/x#p"/></animateMotion></circle></svg>');
  sanitizeSvgElement(svg);
  const motion = svg.querySelector('animateMotion')!;
  expect(motion.hasAttribute('onend')).toBe(false);
  expect(svg.querySelector('mpath')!.hasAttribute('href')).toBe(false);
});
```

(`parse` = whatever helper the existing test file uses for building an `Element` — reuse it.)

- [ ] **Step 2: Run to verify failure**

Run: `node_modules/.bin/vitest run packages/services/src/import/sanitizeSvg.test.ts --reporter=basic`
Expected: new cases FAIL (SMIL currently always removed; metadata currently kept).

- [ ] **Step 3: Implement**

```ts
const FORBIDDEN_TAGS = ['script', 'foreignObject', 'metadata'];
const SMIL_TAGS = ['animate', 'animateTransform', 'animateMotion', 'set', 'mpath'];
const REF_ATTRS = ['href', 'xlink:href', 'src'];
// SMIL may not animate reference/identity/handler channels: refs would bypass isSafeRef,
// style is a string-injection channel, id/class break namespaceIds + app-CSS isolation,
// data-savig-* are the editor/runtime node-lookup contract.
const UNSAFE_ANIMATED_ATTRS = new Set(['href', 'xlink:href', 'src', 'style', 'id', 'class']);
```

Replace the removal loop: `FORBIDDEN_TAGS` removed as today (keep the `foreignObject` warning). Then a SMIL pass:

```ts
for (const tag of SMIL_TAGS) {
  for (const el of Array.from(svg.querySelectorAll(tag))) {
    const target = (el.getAttribute('attributeName') ?? '').trim().toLowerCase();
    if (UNSAFE_ANIMATED_ATTRS.has(target) || /^on/.test(target) || target.startsWith('data-savig')) {
      warnings.push(`Removed <${el.tagName}> animating "${target}".`);
      el.remove();
    }
  }
}
```

The existing attribute pass (on* strip + REF_ATTRS allowlist) already runs over every element including kept SMIL — leave it, and update the file-head comment (it currently says animations are removed).

- [ ] **Step 4: Run the wider set** (renderDocument re-sanitizes assets; importSvg warnings surface)

Run: `node_modules/.bin/vitest run packages/services apps/react/src/ui --reporter=basic`
Expected: PASS after flipping any test that asserted SMIL removal (importSvg.test.ts, renderDocument.test.ts security cases if any).

- [ ] **Step 5: Typecheck + lint + commit**

```bash
node_modules/.bin/tsc -b && node_modules/.bin/eslint packages/services/src/import/sanitizeSvg.ts
git add packages/services/src/import/sanitizeSvg.ts packages/services/src/import/sanitizeSvg.test.ts packages/services/src/import/importSvg.test.ts
git commit -m "feat(import): keep safe SMIL in imported SVG assets; strip <metadata> and unsafe animation targets"
```

---

### Task 5: e2e — round-trip open + plain animated SVG, real Chromium

**Files:**
- Create: `e2e/open-svg-roundtrip.spec.ts`
- Reference for patterns: `e2e/animated-svg-export.spec.ts` (export + picker stubbing), `e2e/svg-export.spec.ts`, `e2e/getting-started.spec.ts` (app boot + Stage selectors)

**Interfaces:**
- Consumes: FileToolbar's `aria-label="Open"` button (`FileToolbar.tsx:21`); Stage objects render as `section[aria-label="Stage"] [data-savig-object]` (ALWAYS scope to the Stage section — AssetPanel thumbnails also emit `data-savig-object`, the known symbols.spec collision).
- Produces: e2e proof that (a) an exported animated SVG reopens as an editable project and (b) a plain SMIL SVG opens as a playing asset.

- [ ] **Step 1: Read the reference specs**, then write `e2e/open-svg-roundtrip.spec.ts`. Follow the repo's exact existing helpers/boot pattern (do not invent new ones). Shape:

```ts
import { expect, test } from '@playwright/test';
// reuse the repo's app-boot helper exactly as animated-svg-export.spec.ts does

test('exported animated SVG reopens as the full editable project', async ({ page }) => {
  // 1. Boot app; load a template with animation (e.g. via the template the export spec uses).
  // 2. Capture the animated export markup the same way animated-svg-export.spec.ts does
  //    (stubbed showSaveFilePicker collecting bytes).
  // 3. Stub window.showOpenFilePicker to return a File made from those bytes, then click
  //    the toolbar button [aria-label="Open"].
  // 4. Assert: Stage objects match the pre-export object ids —
  //    const ids = page.locator('section[aria-label="Stage"] [data-savig-object]');
  //    and the timeline shows the project (e.g. an object row exists / project name shown).
  // 5. Editability: click an object on the Stage, expect selection UI (existing pattern).
});

test('plain SMIL SVG opens as a new project with a playing asset', async ({ page }) => {
  // Stub the open picker with a hand-written SMIL SVG string:
  //   <svg xmlns="..." viewBox="0 0 100 100"><rect width="20" height="20">
  //     <animate attributeName="x" values="0;80;0" dur="1s" repeatCount="indefinite"/></rect></svg>
  // Click Open. Assert exactly one Stage object exists and the inlined asset def still
  // contains an <animate> element (view-only playback retained through the sanitizer):
  //   expect(await page.locator('section[aria-label="Stage"] animate').count()).toBeGreaterThan(0);
});
```

The comments above are the required behaviors; the implementing engineer writes the real code by copying the boot/stub idioms from the two reference specs (they contain working `showSaveFilePicker` stubs and template-loading flows — mirror them; the File constructor works inside `page.evaluate`/`addInitScript` contexts used there).

- [ ] **Step 2: Kill stale vite, run the new spec**

Run: `pkill -f vite; node_modules/.bin/playwright test e2e/open-svg-roundtrip.spec.ts`
Expected: PASS (2 tests). If the Open click path can't see the stub, install it via `page.addInitScript` BEFORE the click (picker is read from `window` at call time, so a plain `page.evaluate` before clicking also works).

- [ ] **Step 3: Commit**

```bash
git add e2e/open-svg-roundtrip.spec.ts
git commit -m "test(e2e): open exported animated SVG round-trip + plain SMIL svg wrap"
```

---

### Task 6: Full verification sweep

- [ ] Run all unit tests: `node_modules/.bin/vitest run --reporter=basic` — expect ~2630+ passing, 0 failures.
- [ ] Typecheck: `node_modules/.bin/tsc -b`. Lint: `node_modules/.bin/eslint .` (or the repo's configured include set).
- [ ] Full e2e: `pkill -f vite; node_modules/.bin/playwright test` — expect 145+ passing (compare against a main-run baseline A/B if anything fails; never accept "pre-existing" without the A/B).
- [ ] Commit any stragglers; leave the branch clean.
