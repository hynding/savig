# Template Gallery — Design (Help slice 2)

**Date:** 2026-07-03 · **Status:** Approved (autonomous), pre-implementation

## Problem
A gallery of complete example projects exists in `packages/core/src/templates.ts`
(`templates: Template[]` — bouncing-ball, fade-in-title, staggered-dots, pulsing-badge,
slide-and-spin), but it is reachable only via MCP. The React app has no "New from template" UI, so
new users start from a blank artboard with nothing to learn from.

## Goal
Let the user browse the templates and load one into the editor, discoverable both from the toolbar
and the command palette.

## Design
- A **Template gallery overlay** (modal, same pattern as the command palette / shortcuts sheet):
  a scrollable list of cards, each showing the template **title + description**. Clicking a card
  loads it (`setProject(template.build())`) and closes the overlay.
- **Opened two ways** (discoverability):
  - a **"Templates…" button** in the `FileToolbar` (next to New), via an `onOpenTemplates` prop.
  - a **command** `file.templates` ("New from template…", File category, no chord) → `host.openTemplates()`.
- **v1 = text cards** (title + description). Rendered thumbnails are out of scope: the only
  static-frame renderer (`renderFrameSvg`) is JSDOM-based (node-only), so a browser thumbnail would
  require re-deriving the frame render in-DOM — deferred as a follow-up.
- **No new package coupling:** the `TemplateGallery` React component imports `templates` from
  `@savig/core` directly and calls `useEditor.getState().setProject(...)`. Neither `ui-core` nor
  `editor-state` gains a `@savig/core` dependency.

## Components
- `CommandHost.openTemplates(): void` (neutral interface, `packages/ui-core/src/commands/types.ts`).
- Registry command `file.templates` (`registry.ts`) → `ctx.host.openTemplates()`.
- `apps/react/src/ui/components/TemplateGallery/TemplateGallery.tsx` (+ css) — the overlay.
- `App.tsx` — overlay union gains `'templates'`; `host.openTemplates` → `setOverlay('templates')`;
  mounts `<TemplateGallery>`; passes `onOpenTemplates` to `FileToolbar`.
- `FileToolbar.tsx` — a "Templates…" button calling `onOpenTemplates`.
- Stub `CommandHost`s in existing tests gain the `openTemplates` no-op.

## Data flow
`Templates… button / palette "New from template"` → `host.openTemplates()` → overlay opens →
click a card → `setProject(template.build())` + close.

## Testing
- Component: gallery renders a card per template (title + description); clicking one replaces the
  project (`meta.name` becomes the template's) and calls `onClose`; Escape closes.
- Registry: `file.templates` command exists and calls `host.openTemplates`.
- e2e: open the gallery from the Templates button, click "Bouncing ball", assert the Stage shows the
  loaded object(s) and the artboard resized to the template's dimensions.

## Out of scope / follow-ups
Rendered (static or animated) thumbnails; template categories/search; user-saved templates.
