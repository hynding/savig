# Getting-Started Checklist — Design (Help slice 3)

**Date:** 2026-07-03 · **Status:** Approved (autonomous), pre-implementation

## Problem
New users land on a blank artboard with no guidance on the core loop (draw → animate → reuse).
The brainstorm's slice 3 was "first-run tour + getting-started checklist."

## Scope decision
Deliver the **auto-progressing checklist** (robust, high-value, testable). Defer the coach-mark
**tour** — positioned tooltips are coordinate-fragile (cf. slice 2's toolbar-overflow lesson) and
lower value than a persistent, self-checking task list. Noted as a follow-up.

## Design
A small **non-modal corner card** ("Getting started") listing a few starter milestones that check
themselves off **live** as the user works (the card reads the store reactively). Being non-modal, it
never blocks the canvas and does not suppress keyboard shortcuts.

Milestones (all derivable from `history.present`, so detection is pure + reactive):
1. **Draw a shape** — a root object exists.
2. **Animate it** — some object has at least one keyframe on any track.
3. **Add a second shape** — ≥ 2 root objects.
4. **Group or make a symbol** — a group container exists, or a symbol asset exists.

When all are done the card shows a brief "You've got the basics 🎉" and a Dismiss.

## Visibility / persistence
- Shows on **first run only**: App initializes `showGettingStarted` from
  `!localStorage.getItem('savig.gettingStarted.dismissed')`.
- **Dismiss** (×) hides it and sets that localStorage flag (so it stays gone across sessions).
- Re-openable on demand via a command **`help.gettingStarted`** ("Getting started", View category) →
  `host.openGettingStarted()` → `setShowGettingStarted(true)` (does not clear the dismissed flag —
  re-showing is per-session; it won't auto-appear next launch).

## Components
- **Neutral VM** `packages/ui-core/src/viewmodels/gettingStarted.ts`:
  `gettingStartedViewModel(s): { items: { id: string; label: string; done: boolean }[]; doneCount: number; total: number; allDone: boolean }`.
- `CommandHost.openGettingStarted(): void`; registry command `help.gettingStarted`.
- **React** `apps/react/src/ui/components/GettingStarted/GettingStarted.tsx` (+ css) — corner card
  reading `useEditorVM(gettingStartedViewModel)`; `onDismiss` prop.
- `App.tsx` — `showGettingStarted` state (localStorage-seeded), renders the card, wires
  `host.openGettingStarted`.
- Stub `CommandHost`s in existing tests gain the `openGettingStarted` no-op.

## Testing
- VM unit: each milestone flips done as the store changes (draw → item 1; setProperty keyframe →
  item 2; 2 objects → item 3; group → item 4); `allDone`/counts correct.
- Component: renders items with done/undone state reflecting the store; Dismiss calls `onDismiss`;
  all-done shows the congrats.
- e2e: on first load the card is visible; drawing a shape checks "Draw a shape"; Dismiss hides it;
  after a reload it stays hidden (localStorage).

## Out of scope / follow-ups
The coach-mark tour; richer milestones (export/preview detection — those are transient/hard to
observe); i18n.
