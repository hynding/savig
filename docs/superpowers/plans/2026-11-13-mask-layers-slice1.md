# Mask Layers — Slice 1 (Model + Engine + Render Seam) Implementation Plan

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax for tracking; boxes are left
> unchecked in-file by convention (see INDEX).

**Goal:** Masks exist in the model and render correctly everywhere that goes through the shared
seam: Stage preview, exported runtime, SMIL export, raster/GIF/video, MCP `render_frame`. No new
editor UI in this slice; masks are authored by setting `isMask` / `maskedBy` (hand-written JSON or
engine helpers).

**Spec:** `docs/superpowers/specs/2026-11-13-mask-layers-design.md` §Model, §Engine, §Render &
export, §Persistence.

## Global constraints

- **Parity:** no `isMask`/`maskedBy` anywhere ⇒ byte-identical output (no new leaf fields, no
  mask defs, no wrappers).
- **One walker:** mask content is still emitted by `flattenInstances` as ordinary leaves (flagged
  `maskOf`) so `computeFrame` animates them with zero new runtime code.
- `mask-type="alpha"` as an attribute, not `style` (resvg ignores the style form).
- Rebuild `packages/runtime/src/runtimeSource.generated.ts` (`pnpm build:runtime`) — the runtime
  bundle embeds the engine walker.

---

### Task 1: Model + helpers
- [ ] `SceneObject.isMask?`, `SceneObject.maskedBy?` (`packages/engine/src/types.ts`).
- [ ] `packages/engine/src/mask.ts`: `resolveMaskTarget`, `maskContentRoot`, `maskChainFor`,
      `maskDefId`, `maskedObjectIds`, `symbolUsesMasks`; exported from the engine index.

### Task 2: Walker
- [ ] `InstanceLeaf.maskChain?` (drawn leaves, outermost first) and `InstanceLeaf.maskOf?`
      (mask content). Inherited through symbol instances; mask content ignores clip/tint.
- [ ] Tests: honour rules, group masks, stacked masks, frame-layer mask exposure, instance-scoped
      def ids, instance-as-mask, parity.

### Task 3: Export seam
- [ ] `renderSceneBody`: `<mask>` defs from `maskOf` leaves; `MaskWrapperStack` opens/closes
      `<g mask>` wrappers; clip/tint runs also split on mask-chain changes.
- [ ] Static-symbol `<use>` optimization skips masks, masked instances, mask-using symbols.
- [ ] Multi-scene prefixes `maskOf` / `maskChain` ids.
- [ ] Tests: markup, nesting, non-contiguous targets, parity, escaping, runtime animation,
      SMIL inside `<mask>`, multi-scene; resvg pixel test in `core/node/render.test.ts`.

### Task 4: Stage preview
- [ ] Same `<mask>` defs (JSX) + wrapper stack in `Stage.tsx`; mask content stays registered
      with the painter.
- [ ] Stage tests: structure, hidden mask ⇒ unmasked.

### Task 5: Validate + persistence
- [ ] `validate`: `mask-dangling`, `mask-target-not-mask`, `mask-self` warnings (scenes + symbols).
- [ ] Format v9 (stamp-only migration), `sanitizeMasks` drops malformed fields at load.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint`, full Playwright suite.
