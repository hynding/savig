# Browser Video Export (ffmpeg.wasm) — Design

**Date:** 2026-09-12 · **Status:** approved (scope Q&A 2026-09-12) · **Owner surface:** editor Export UI (v1)

## 1. Goal & scope

Export a project as a **video file, entirely in the browser**: deterministic frames rendered by
the existing shared frame pipeline, encoded and muxed by **ffmpeg.wasm (single-threaded core)**.

**In scope (v1)**

- Formats: **MP4 (H.264 + AAC)** and **WebM (VP9 + Opus)** — user picks per export.
- **Audio included**: the multitrack master mix (gain/mute/solo/pan/filter/fades) rendered
  offline and muxed into the file.
- Reachable from the **editor Export UI only** (palette command + options dialog with progress
  and cancel). No MCP tool in v1 (see §11).
- Single-threaded ffmpeg core: **zero hosting constraints** (no COOP/COEP, no
  SharedArrayBuffer); works on any static host and inside plain iframes.

**Out of scope (v1)** — see §12: multithreaded/WebCodecs acceleration, MCP `render_video`,
per-export transparency/alpha, codec/quality knobs beyond fps/width/format, backend encoding
(M10 note in §11).

## 2. Prior art & constraints

- The GIF exporter (`packages/core/src/node/gif.ts`) is **Node-only** (native resvg, jsdom) —
  it serves MCP agents and cannot run in the browser. Its INDEX row says "MP4 deferred (needs
  ffmpeg)"; the master spec's M8 row already named **ffmpeg.wasm** as the intended approach.
- Frame parity seam: `renderSvgDocument`/`renderProjectDocument` (services) build the export
  markup; **`applyProjectFrame(svgRoot, nodes, project, t)`** (`@savig/runtime/frame`) bakes any master
  time onto that DOM — the same pair the node rasterizer, the exported player, and the editor
  paint path use. Multi-scene **and crossfade/dip transitions come out correct by construction**
  (applyProjectFrame owns transition compositing).
- Audio parity seam: `createAudioEngine(ctx: AudioContextLike)` (`@savig/services`) builds the
  full mixer graph. **`OfflineAudioContext` satisfies `AudioContextLike`**, so the offline mix
  render reuses the exact live-playback graph — no new mix math.
- Client-only ethos: no CDN fetches. ffmpeg core assets resolve via **Vite `?url` imports of
  the `@ffmpeg/core` package files** (dev server and build both serve them; the ~31 MB wasm is
  *never* committed to git, no copy plugin needed) and are **lazy-loaded** on first video
  export (dynamic import — main bundle unaffected). Known Vite quirk: `@ffmpeg/ffmpeg` and
  `@ffmpeg/util` must be listed in `optimizeDeps.exclude` or the library's internal worker URL
  breaks under the dev server — verified in the slice-1 smoke task (§6).

## 3. Architecture

```
videoExport.ts  (orchestrator, apps/react/src/ui/export/)
 ├─ frames:  renderProjectDocument(project) → detached DOM (DOMParser, parsed ONCE),
 │           nodeMap = all [data-savig-object] elements (the node-raster recipe, render.ts:41)
 │           per frame i at t=i/fps: applyProjectFrame(svgRoot, nodeMap, project, t)
 │           (svgRoot is required — the dip-transition overlay rect is lazily created on it)
 │           → XMLSerializer → SVG blob URL → <img> → canvas(width×height, bg fill)
 │           → canvas.toBlob('image/jpeg', q) → ffmpeg FS  (frameNNNNN.jpg)
 ├─ audio:   renderMix.ts → createAudioEngine(new OfflineAudioContext(2, dur·sr, sr))
 │           → engine.start(clips, tracks, 0) → startRendering() → encodeWav() → mix.wav
 ├─ encode:  ffmpegClient.ts (lazy-loaded, one instance per run) — per SEGMENT (≈2 s of frames):
 │           exec(image2 → seg_k.<ext>, video-only), delete segment's jpegs
 │           then: concat demuxer (-c copy) + mix.wav mux → out.<ext>
 └─ save:    saveBytesToDisk(bytes, `${meta.name}.<ext>`, mime)   (existing fileOps path)
```

**Units** (each independently testable):

| Unit | Home | Responsibility |
|---|---|---|
| `ffmpegClient.ts` | `apps/react/src/ui/export/` | Load `@ffmpeg/ffmpeg` + single-thread core (assets via Vite `?url`, §2); expose `writeFile/exec/readFile/deleteFile/terminate` + progress events. **One instance per export run** (clean cancel/FS lifecycle; the wasm bytes themselves stay in the browser HTTP cache); `terminate()` on cancel. |
| `frameRaster.ts` | `apps/react/src/ui/export/` | Parse export markup once; `rasterizeFrame(t) → Blob` via applyProjectFrame + canvas. Owns the `<img>` decode round-trip and background fill. |
| `renderMix.ts` | `apps/react/src/ui/audio/` | Offline master-mix render via `createAudioEngine(OfflineAudioContext)`; returns `AudioBuffer`. |
| `encodeWav.ts` | `packages/services/src/audio/` | Pure: `Float32Array` channels → 16-bit PCM WAV bytes. (Services-level: reusable by a future backend path's tests.) |
| `videoArgs.ts` | `packages/services/src/export/` | Pure: format/fps/width/segment plan → ffmpeg argv arrays (segment encode, concat, mux). The SAME argv builder a future native/backend path reuses (§11). |
| `videoExport.ts` | `apps/react/src/ui/export/` | Orchestrates the above; progress callback (phase + fraction); AbortSignal-driven cancel; cleanup. |
| `ExportVideoDialog.tsx` | `apps/react/src/ui/components/` | Options (format MP4/WebM, fps default `meta.fps`, width default artboard) + progress bar + cancel. Overlay following the TemplateGallery pattern; palette command opens it. |

## 4. Frame pipeline

- Master-timeline sampling: frame `i` at `t = i / fps`, `frameCount = max(1, round(duration·fps))`
  with `duration = computeProjectDuration(project)` (master; audio tails included).
- Markup parsed **once**; per-frame work is `applyProjectFrame` + serialize + `<img>` decode +
  `drawImage`. Canvas is `width × round(width·H/W)` (both forced even — yuv420p requires it);
  background filled first (default `white`, matching the GIF exporter) because JPEG has no alpha.
- JPEG intermediates (q≈0.92) over PNG: ~5–10× smaller in the wasm FS — the memory ceiling is
  the in-memory FS, not encode speed.
- Caveat (documented, not discovered): SVG loaded through `<img>` never fetches external
  subresources, so an imported asset referencing an external URL renders without it — the SAME
  behavior as the node resvg raster (which doesn't fetch either). System fonts render normally.
  Native SVG filters (e.g. the per-instance tint) DO rasterize here — better than resvg.

## 5. Audio pipeline

- `OfflineAudioContext(2, ceil(duration·sampleRate), 44100)`; decode clips via the engine's own
  `decode()` (bytes from `store.binaries`), `start(clips, tracks, 0)`, `startRendering()`.
- Fades/pan/filter/mute/solo come from the shared engine graph — zero new formula code.
- `encodeWav()` → `mix.wav` in ffmpeg FS; ffmpeg encodes it to AAC (MP4) / Opus (WebM).
- A project with **no audio clips skips the audio phase entirely** (no silent track: `-an`).

## 6. ffmpeg invocation & segmenting

- Per segment k (SEGMENT_SECONDS = 2, so `fps·2` frames), **numbering restarts at 0 per
  segment** (each segment's JPEGs are deleted after its encode, so there is no global
  `frame%05d` ceiling and no `-start_number` bookkeeping):
  `-framerate <fps> -i frame%05d.jpg -frames:v <n> <codec args> seg_k.<ext>`
  then delete the segment's JPEGs — **wasm FS memory stays bounded** regardless of duration.
- Codec args: MP4 `-c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p`; WebM
  `-c:v libvpx-vp9 -crf 32 -b:v 0 -deadline good -cpu-used 5 -pix_fmt yuv420p`.
- Final pass: concat demuxer + audio mux with **per-stream** codec flags (a bare `-c copy`
  would claim the audio stream too):
  `-f concat -safe 0 -i list.txt -i mix.wav -c:v copy -c:a aac -b:a 192k` (MP4, plus
  `-movflags +faststart` so shared files start playing before fully downloaded) /
  `-c:v copy -c:a libopus -b:a 128k` (WebM), `-shortest` → `out.<ext>`. No-audio projects drop
  the second input and the `-c:a` flags entirely.
- **Slice-1 smoke task verifies the three least-proven links** against the real vendored core
  before anything is built on them: (a) codec availability (`-codecs`; stock `@ffmpeg/core`
  0.12 ships libx264/libvpx/native-aac — if Opus is absent, WebM audio falls back to
  `libvorbis` and this spec is amended), (b) **`-c copy` concat of VP9/WebM segments** (the
  weakest link — if stream-copy concat proves unreliable for a format, that format falls back
  to a SINGLE-PASS encode behind a frame cap, and the cap is stated in the dialog), and
  (c) worker/core loading under the Vite dev server and production build (§2 quirk).

**AMENDMENT (2026-09-13, slice-1 probe result):** the vendored `@ffmpeg/core@0.12.10`
single-threaded build wasm-traps (`memory access out of bounds`) when one FFmpeg instance runs
a SECOND `libvpx-vp9` exec — a harder failure than the anticipated graceful concat failure, in
the same reliability class. Per this section's named fallback, **WebM uses a SINGLE-PASS
encode** (one exec: all frames + optional `mix.wav` → `out.webm`, `-c:a libopus` in the same
invocation) **behind a cap of `WEBM_MAX_FRAMES = 1800`** (60 s at 30 fps; all JPEGs sit in the
wasm FS at once, ~270 MB at 1080p), with the cap stated in the dialog when exceeded. **MP4
keeps the segmented pipeline** — the probe verified multi-exec libx264 + `-c:v copy` concat
clean. The generic segment/concat argv builders RETAIN their WebM variants: the constraint is
wasm-core-specific, and the M10 native-ffmpeg backend (§11) can run segmented WebM. **Shipped
shape (Task 8):** the single-pass exec (`singlePassArgs`) is VIDEO-ONLY, writing `mid.webm`;
when the project has audio, a second vp9-free exec (`singlePassMuxArgs`, `-c:v copy` stream-copy
remux against `mix.wav`) produces the final `out.webm` — the fix for the `-frames:v`
between-inputs argv-parse bug found in real-browser e2e, keeping the vp9 exec's argv audio-free.

**AMENDMENT 2 (2026-09-14, Task 8 e2e result):** real rasterized frame content wasm-traps the
vendored core's libvpx-vp9 at every usable width (both good/5 and realtime/8 deadline args; with
audio even at width 16), while MP4 is unaffected — so v1 ships with the WebM option DISABLED in
the dialog (visible, with an honest explanation). All WebM argv builders, the single-pass path,
and WEBM_MAX_FRAMES stay implemented and tested for the M10 native-ffmpeg backend (§11), where
the same invocations run on real ffmpeg. Backlog: retry newer @ffmpeg/core releases as they
appear.

## 7. UI

Palette command **"Export Video…"** opens `ExportVideoDialog`: format (MP4 default / WebM), fps
(default `meta.fps`, clamp 1–60), width (default artboard, clamp 16–3840, forced even), duration
+ estimated frame count shown. Export button → phase-labelled progress (`rendering frames…`,
`mixing audio…`, `encoding…`, `finalizing…`) with a real fraction (frames = per-frame; encode =
ffmpeg progress events scaled by segment). Cancel always visible. On success: existing
`saveBytesToDisk` picker. Dialog suppresses the global keymap like other overlays.

## 8. Error handling & cancel

- **Snapshot semantics:** the orchestrator captures `project` + `binaries` once at
  dialog-confirm; the whole export (frames, mix, encode) reads only that snapshot, so edits
  made while a long export runs can never tear the output.

- Core load failure (offline, blocked wasm): toast + dialog stays open for retry.
- Hygiene: every per-frame SVG object URL is revoked after its `<img>` decode (a long export
  would otherwise leak hundreds of blob URLs).
- Cancel: `AbortSignal` checked between frames/segments; `ffmpeg.terminate()` kills the worker
  mid-exec; FS is per-run so cleanup = drop the instance. No partial file is saved.
- Any exec failure: toast with the phase name; instance discarded (next export loads fresh).
- Guards: 0-duration project → toast "nothing to export"; locked/hidden objects render exactly
  as the shared frame pipeline dictates (no special cases).

## 9. Performance & caps

- Single-thread x264 ≈ 2–6 fps encode at 1080p, VP9 slower — acceptable for shorts behind a
  progress bar; the frame-raster phase (img decode) typically dominates.
- No hard duration cap in v1 (progress + cancel instead); soft toast warning above ~60 s.
- ffmpeg core assets lazy-fetched once per session (browser HTTP cache thereafter).

## 10. Testing

- **Pure units**: `videoArgs` (argv snapshots incl. segment/concat/mux, both formats, no-audio),
  `encodeWav` (RIFF header, PCM round-trip), segment planner math (frame counts, start numbers,
  even-dimension forcing).
- **jsdom integration**: `videoExport` orchestrator against a **fake ffmpegClient** + fake
  raster (jsdom has no canvas/Image decode): phase ordering, per-segment delete calls, cancel at
  each phase, no-audio path, error propagation. `renderMix` against the existing
  `AudioContextLike` fake harness (graph reuse is already covered by audioEngine tests).
- **e2e (real Chromium)**: author a ~2 s two-scene project with one audio clip; export MP4 and
  WebM through the dialog; assert saved bytes start with `ftyp` (MP4) / EBML `0x1A45DFA3`
  (WebM) and are non-trivially sized. `test.slow()`; single-thread wasm needs no special
  headers under Playwright. Stubbed `showSaveFilePicker` captures bytes (established idiom).

## 11. Backend option — M10 note (explicitly recorded)

When M10 (cloud projects & accounts) lands a backend, add a **server-side encode path**: native
ffmpeg reusing the **same `videoArgs` argv builder** and the same frame/WAV artifacts (rendered
headlessly via the existing node raster path), exposed as an MCP `render_video` tool and as a
"fast export" option in the editor. The browser wasm path stays as the universal, zero-backend
fallback. → Tracked in INDEX "What's next / backlog".

## 12. Deferred / non-goals (v1)

- Multithreaded core (COOP/COEP) and WebCodecs `VideoEncoder` acceleration — layer onto the same
  orchestrator later; detection-based runtime upgrades.
- Transparency (VP9 alpha / ProRes), custom bitrate/CRF/preset UI, GIF-via-ffmpeg unification.
- MCP `render_video` (needs backend or native ffmpeg — M10).
- Per-scene export ranges / in-out points.
