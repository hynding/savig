# Interactivity & Scripting (M9) — Design Spec

**Date:** 2026-09-08
**Milestone:** master spec §10 "M9 — Interactivity / scripting: click handlers, simple scripting on objects (games territory)"
**Status:** approved design, pre-implementation

## 1. Goal & scope

Make Savig shorts interactive: objects respond to pointer events, projects respond to keyboard
and timeline events, and a tiny sandboxed expression language ("SavigScript") supplies guards,
computed action arguments, and mutable variables — enough for buttons, menus, and simple games.

- **Events:** per-object pointer (`click`, `pointerdown`, `pointerup`, `hoverEnter`, `hoverLeave`);
  project-level `keydown`/`keyup` (by `KeyboardEvent.key`), `sceneStart`/`sceneEnd`, and a
  playback-gated `tick`.
- **Actions:** playback (`play`/`pause`/`stop`/`seek`/`gotoScene`), state (`setVar`), and
  runtime object overrides (`show`/`hide`/`setOpacity`/`setPosition`/`setText`) that never
  mutate the document.
- **Expressions:** SavigScript — literals, variables, built-ins, arithmetic/comparison/logic,
  ternary; no loops, no user functions, no member access. Termination and sandboxing by
  construction.
- **Runs in:** an editor **interactive-preview mode** (toggle) and the exported runtime bundle.
- **Full agent parity:** DSL section, core builders, describe/validate, MCP tools.

**Non-goals (v1):** spawn/despawn of runtime instances, collision queries, audio-trigger
actions (play a clip on click), SMIL-level interactivity in the pure-SMIL static export
(stays non-interactive — documented caveat), expression access to object properties
(read-only built-ins only), behaviors on symbol *internals* (the instance is the targetable
unit), tick while paused (pointer/key handlers still work when paused, which covers menus),
per-behavior enable/disable UI toggles.

## 2. Current state (grounding)

- Objects render as leaves keyed by `data-savig-object` renderIds; groups and symbol instances
  have **no DOM node** (transforms compose at compute time — `flattenInstances`).
- The runtime bundle (`packages/runtime/src/index.ts`) drives frames imperatively via
  `applyProjectFrame(svg, nodes, project, time)` in a RAF loop; no event handling exists.
- `resolveTimeline(project)` (engine/scenes.ts) yields `SceneSpan[]` with master-time starts;
  `sceneAtTime` gives the current scene + local time.
- The editor Stage's pointer interactions live in per-gesture hooks behind a single
  dispatch; symbol-edit mode already gates tool behavior — the same gating pattern serves
  preview mode.
- Persistence: `migrateProject` (v6) is the single seam for `.savig` and SVG round-trip loads;
  `sanitizeAudio.ts` shows the sanitizer pattern (clamp/strip, `===` no-op parity).
- Security posture: no user string ever reaches markup unescaped; the exported SVG embeds
  project JSON via `textContent` (XML-escaped).

## 3. Model (engine types) — additive, parity-safe

```ts
export type PointerEventKind = 'click' | 'pointerdown' | 'pointerup' | 'hoverEnter' | 'hoverLeave';
export type GlobalEventKind = 'keydown' | 'keyup' | 'sceneStart' | 'sceneEnd' | 'tick';

export interface BehaviorAction {
  kind: 'play' | 'pause' | 'stop' | 'seek' | 'gotoScene' | 'setVar'
      | 'show' | 'hide' | 'setOpacity' | 'setPosition' | 'setText';
  /** Literal args: gotoScene.sceneId (scene id), setVar.name, targetId (object id).
   *  Expression args (SavigScript source strings, evaluated at fire time):
   *  seek.time, setVar.value, setOpacity.value, setPosition.dx/.dy, setText.value.
   *  targetId absent ⇒ the behavior's own object; project-level handlers MUST name one
   *  for object actions. */
  args?: Record<string, string>;
  /** Guard expression; absent = always. Non-boolean or errored guard ⇒ action skipped. */
  if?: string;
}

export interface Behavior {
  id: string;
  event: PointerEventKind | GlobalEventKind;
  /** keydown/keyup: exact `KeyboardEvent.key` match ('ArrowLeft', ' ', 'a'). Auto-repeat
   *  (`event.repeat`) is ignored. */
  key?: string;
  /** sceneStart/sceneEnd: scene id; absent = every scene. */
  sceneId?: string;
  actions: BehaviorAction[];
}

export interface InteractionModel {
  /** Declared upfront so reset semantics and validation are well-defined. Variables are
   *  DYNAMICALLY typed at runtime — `initial` defines only the reset value (a `setVar` may
   *  store a different type; validate does not attempt static type-checking). */
  variables?: Array<{ name: string; initial: number | string | boolean }>;
  /** Global handlers (keydown/keyup/sceneStart/sceneEnd/tick only). */
  handlers?: Behavior[];
}
// SceneObject += behaviors?: Behavior[]   (pointer events only)
// Project     += interactions?: InteractionModel
```

Absent fields ⇒ zero interactivity, byte-identical behavior, zero armed listeners (parity).
Pointer behaviors are valid on any object incl. groups and symbol instances (see §5 event
resolution); ALL global kinds (`keydown`/`keyup`/`sceneStart`/`sceneEnd`/`tick`) are rejected
on objects by validate (project-level only), and pointer kinds are rejected on project handlers.

## 4. SavigScript (engine `src/script/` — the formula owner)

`tokenize.ts` → `parse.ts` (Pratt) → `evaluate.ts`. One implementation shared by editor
preview, validate, and the export runtime (the `audio-mix.ts` pattern).

**Values:** `number | string | boolean`.
**Grammar:** number/string(single or double quoted, `\\`-escapes)/`true`/`false` literals;
identifiers (variables and built-ins); unary `-` `!`; binary `+ - * / %`,
`== != < <= > >=`, `&& ||` (short-circuit); ternary `cond ? a : b`; parentheses; the single
call form `random()`. **No** loops, user functions, member/index access, or assignment.

**Precedence** (low→high): ternary · `||` · `&&` · equality · relational · additive ·
multiplicative · unary · primary.

**Built-ins (read-only):** `time` (master seconds), `sceneIndex` (0-based),
`sceneTime` (seconds into the current scene), `random()` (host-injected, seedable for tests).
During a scene transition overlap, `sceneIndex`/`sceneTime` follow `sceneAtTime`'s PRIMARY scene.

**Variables at runtime:** reading a variable that has never been set is an eval error
(validate warns statically about undeclared names). `setVar` may create names not declared
in `interactions.variables` (dynamic). `reset()` restores declared variables to their
`initial` values and DELETES dynamically-created ones.

**String escapes:** `\\` `\'` `\"` `\n` `\t`; any other escape sequence is a parse error.

**Typing & coercion (complete table):**
- `+`: number+number = add; if either operand is a string, both coerce to string and
  concatenate; boolean operands in `+` are an eval error.
- `- * / %`: numbers only; anything else is an eval error. Division by zero yields an eval
  error (not Infinity).
- `== !=`: same-type scalar comparison; mixed types ⇒ `==` is `false`, `!=` is `true`.
- `< <= > >=`: numbers only (strings/booleans ⇒ eval error).
- `! && || ?:` conditions: require boolean; non-boolean ⇒ eval error.
- `setText.value`: numbers/booleans stringify (`String(v)`); `setOpacity.value`/`seek.time`/
  `setPosition.dx/dy`: must evaluate to a number, clamped (opacity 0..1, seek ≥ 0 — the
  HOST clamps seek's upper bound to project duration, as the editor's seek already does).

**Errors never throw.** `parse(src)` returns `{ok:true, ast} | {ok:false, message, pos}`;
`evaluate(ast, env)` returns `{ok:true, value} | {ok:false, message}`. An errored guard or
argument skips that ACTION only (remaining actions in the behavior still run); preview logs a
`console.warn` once per distinct error per session. `validate` surfaces parse errors and
static warnings (undeclared variables) at author time.

**Abuse caps:** source ≤ 500 chars; AST depth ≤ 32; both enforced by the parser (cap breach =
parse error). The evaluator is a pure tree-walk over a finite AST — termination guaranteed.

## 5. Interactive session (engine `src/script/session.ts`) — one seam, two consumers

```ts
createSession(project: Project, host: SessionHost) → InteractiveSession
/** Explicit values, never deleted once set (see Overrides below). */
export interface ObjectOverride {
  hidden?: boolean;
  opacity?: number;   // 0..1
  dx?: number; dy?: number;
  text?: string;
}
interface SessionHost {
  play(): void; pause(): void; seek(t: number): void;   // stop = pause + seek(0), session-side
  now(): number;              // master time (for built-ins)
  random(): number;           // seeded in tests
  warn(message: string): void;
}
// HOST CONTRACT: seek(t) preserves the current playing state — if playing, playback continues
// from t (the editor restarts its audio transport at the new position; the runtime re-anchors
// its clock). gotoScene therefore never pauses a running game.
interface InteractiveSession {
  /** chain = authored ancestor ids, leaf-first (see event resolution below). */
  firePointer(kind: PointerEventKind, chain: string[]): void;
  fireKey(kind: 'keydown' | 'keyup', key: string): void;
  pointerAt(authoredChain: string[] | null): void;  // hover tracking, see below
  /** Consumers call on EVERY applied frame and on ANY seek — scene-identity events
   *  therefore fire when scrubbing/jumping while paused too. */
  tickTo(masterTime: number, playing: boolean): void;
  overrides(): ReadonlyMap<string, ObjectOverride>;
  vars(): ReadonlyMap<string, number | string | boolean>;
  /** Fires after any handled event or tick that changed vars or overrides — consumers re-apply. */
  onChange(cb: () => void): () => void;
  reset(): void;
}
```

A new engine helper `resolveAuthoredChain(project, renderId): string[]` owns the
renderId → authored-ancestor mapping. Concretely (per `flattenInstances`' scheme,
`symbol.ts`): strip a trailing `@k` repeater suffix; split on `/`; the FIRST segment is
the targetable authored object (the outermost symbol instance for namespaced leaves —
symbol internals collapse to the instance — or the leaf itself for plain ids); the chain
is that object followed by its `parentId` walk within its containing scene, leaf-first.
It lives in engine because the namespacing scheme is engine knowledge; both consumers use it.

- **Playback actions** call the injected host (editor: transport intents; runtime: its clock).
  The session never touches DOM or WebAudio. `stop` = `host.pause()` + `host.seek(0)`;
  variables and overrides are NOT reset by `stop` (a game-over screen can still read the
  score) — only `reset()` (preview entry/restart) clears them.
- **`gotoScene`** = `host.seek(span.start)` from `resolveTimeline` — no new timeline concept.
- **Event resolution through groups/symbols:** DOM events land on leaf nodes (groups and
  instances have no DOM node). The consumer maps the event target's `data-savig-object`
  renderId through `resolveAuthoredChain` and passes the chain. `firePointer` walks it
  nearest-first, firing every matching behavior. Behaviors within one object fire in array
  order; actions within a behavior in array order.
- **Hover via chain diffing** (pointerenter/leave don't bubble, and a group's leaves would
  produce spurious enter/leave pairs): the consumer listens to bubbling `pointerover`/
  `pointerout` on the SVG root (leaf-transition events; no `pointermove` needed), resolves
  the current authored chain, and calls `pointerAt(chain)` (null = pointer left the stage).
  The session diffs the previous and current chains and emits `hoverEnter`/`hoverLeave` per
  authored object exactly once.
- **Scene events use scene-IDENTITY-change semantics:** `tickTo` compares the containing
  scene of the previous and new master time; when it changes — via playback, loop wrap,
  `seek`, or `gotoScene` — it fires `sceneEnd(left)` then `sceneStart(entered)`. On session
  start and after `reset()`, `sceneStart` fires for whichever scene contains the current
  playhead (uniform for single- and multi-scene projects).
- **`tick`** fires at most once per `tickTo` call and only while `playing`.
- **Overrides:** last-write-wins per field per object, stored as EXPLICIT values that are
  never deleted (`show` ⇒ `hidden: false`, not entry removal) — the apply pass covers every
  mapped object on every frame, so a flipped override can't leave a stale attribute behind.
  A group/instance override expands to all descendant LEAVES at apply time. `setText` on a
  non-text target is a validate error AND a runtime no-op (defense in depth). Only `reset()`
  clears the map; in the editor, preview-exit additionally forces a normal re-render, which
  rebuilds every attribute and text node from the document.
- **Apply seam (both consumers):** ownership split mirrors the existing frame path —
  EXPANSION is engine-pure (`expandOverrides(project, overrides): Map<leafRenderId,
  ObjectOverride>`, walking groups/instances the way `flattenInstances` does), while DOM
  application is a small per-consumer post-pass (the editor injects its apply just as it
  injects `applyFrame`; the runtime applies in its RAF loop). Immediately after the normal
  imperative frame pass, the post-pass sets `display` (`none`/``), `opacity`, prepends
  `translate(dx dy)` to the freshly-written `transform` attribute (same synchronous pass ⇒
  reapplied from scratch each frame, no double-prepend), and sets `textContent` (plain text —
  inherits escaped-render guarantees; never markup).

## 6. Editor: preview mode + authoring UI

- **Preview toggle:** transient store flag `previewMode` + `enterPreview()`/`exitPreview()`
  (Esc exits; toolbar button beside the transport). Entering: clears selection, creates a
  session (host = existing playback/seek intents), seeds `random`, focuses the Stage container.
  One `previewMode` gate at the top of the Stage pointer dispatch (the symbol-edit gating
  pattern) disables ALL editing gestures; pointer events instead resolve leaf→authored-chain
  and drive the session. The app's editor keyboard-shortcut handler
  (`apps/react/src/ui/hooks/useKeyboard.ts`) gets the same gate so Delete/Cmd+Z etc. don't
  fire; Stage-scoped key listeners drive `fireKey` (auto-repeat ignored). Timeline transport (play/pause/seek/scrub) stays usable in preview. Exiting resets
  the session and restores editing. Normal Play WITHOUT preview is exactly today's behavior —
  zero interactivity cost outside preview.
- **React-commit interplay (critical):** during playback the editor paints frames
  imperatively, but a pause/seek commits time to the store and React re-renders the Stage —
  clobbering `textContent`/`display` overrides with nothing running to restore them while
  paused. A Stage preview effect therefore re-applies the current frame + overrides after
  EVERY React commit while `previewMode`, and subscribes to `session.onChange` so
  var/override changes repaint immediately even when paused.
- **Authoring UI:** Inspector "Behaviors" section on the selected object — behavior list
  (event dropdown; key capture field for keydown/keyup), per-behavior action list (kind
  dropdown + per-kind arg inputs; expression fields live-validate through the parser and show
  `message@pos` inline). A project-level "Interactions" panel (Inspector when nothing is
  selected) manages variables (name/initial with type inferred from the initial literal) and
  global handlers (same behavior editor, global event kinds only).
- **Store:** `interactionsSlice` mirroring `audioSlice`: `addBehavior(objectId|null, …)`,
  `updateBehavior`, `removeBehavior`, `addVariable`, `updateVariable`, `removeVariable` —
  all undoable via `commit`; `previewMode`/`enterPreview`/`exitPreview` transient.

## 7. Export & round-trip

- **Runtime bundle:** `SavigRuntime.create` builds the same session (host = its own
  clock/loop controls), wires `click`/`pointerdown`/`pointerup` + `pointerover`/`pointerout`
  listeners on the SVG root with leaf→chain resolution, key listeners on the SVG's
  `ownerDocument`, and calls `tickTo` + `applyOverrides` in its RAF loop after
  `applyProjectFrame`. Projects with no `interactions`/`behaviors` arm ZERO listeners
  (parity). ⚠ rerun `build:runtime`.
- **Round-trip/sanitizer:** new fields ride the embedded JSON. New
  `persistence/sanitizeInteractions.ts` at the same `migrateProject` seam (pattern of
  `sanitizeAudio.ts`, incl. `===` no-op parity): non-array/malformed shapes dropped; unknown
  event/action kinds dropped; expression strings type-checked and length-capped (≤ 500);
  `args` record capped (≤ 8 entries, keys ≤ 32 chars, values ≤ 500 chars; keys not in the
  action kind's known-arg set dropped); `key` ≤ 32 chars; variable names ≤ 64 chars,
  count ≤ 64; behaviors per object ≤ 64; global handlers ≤ 256; actions per behavior ≤ 32;
  non-scalar variable initials dropped.
  Version bump v6→v7 (stamp-only migration; engine `createProject` stamps 7).
- **Pure-SMIL static SVG:** unchanged, non-interactive (documented caveat).

## 8. Agent parity

- **Core builders:** `addBehavior(project, objectId | null, behavior)` → `{project, id}`
  (null = project-level handler), `updateBehavior`, `removeBehavior`, `setVariable(project,
  name, initial)`, `removeVariable`. Pure, no clamping — validate reports.
- **describe:** an "Interactions" block — variable list (name = initial), per-object behavior
  summaries (`click → 2 action(s)`), global handler summaries.
- **validate:** expression parse errors (with `pos`), undeclared-variable warnings, dangling
  `targetId`/`sceneId`, `setText` target not a text object, pointer kinds on project handlers
  (and vice versa), duplicate variable names, `key` missing on key events, object actions on
  project handlers without `targetId`.
- **DSL:** `ShortDoc.interactions?` mirroring `InteractionModel`; `ShortObject.behaviors?`;
  ids optional in, always emitted out; conditional-spread; compile/decompile round-trip
  (id-stable; same order caveat class as audio applies to none — arrays are single-owner).
- **MCP tools:** `add_behavior`, `set_behavior`, `remove_behavior`, `set_variable`,
  `remove_variable` — descriptions carry a SavigScript cheat-sheet (grammar, built-ins,
  coercion rules) since tool descriptions are the agent's manual. `validate` (existing tool)
  covers the check loop.

## 9. Testing

- **Unit:** tokenizer/parser (precedence table, error positions, caps), evaluator (full
  coercion table incl. every eval-error row; short-circuit; ternary), session (guard gating,
  chain-walk firing order, hover chain-diff enter/leave incl. the shared-group-leaves case,
  scene-identity events under play/seek/loop/gotoScene, override merge + group expansion +
  last-write-wins, stop-vs-reset semantics incl. dynamic-variable deletion on reset,
  undeclared-variable read = eval error, seek/gotoScene preserving play state via the fake
  host, fake host call recording), store slice (undo,
  preview transient), sanitizer accept/reject tables, DSL round-trip, validate table,
  `applyOverrides` transform-prepend idempotence (jsdom).
- **E2e (real Chromium):** author click→`setVar`+`setText` counter → preview → click →
  text updates; keydown moves an object (dx override); `gotoScene` on click jumps scenes
  (sceneStart fires on the target); hover enter/leave toggles opacity; preview exit restores
  selection behavior; TWO export paths tested separately — (a) round-trip: export the
  metadata SVG, reopen it in the editor, behaviors survive and work in preview; (b) bundle:
  build the runtime bundle page and drive the SAME interactions standalone (click/key →
  visible effect); legacy project (no interactions) arms zero listeners (assert via absence
  of behavior effects + editor parity).
- **Security tests:** hostile expression strings (500+ chars, depth bombs, `__proto__`,
  unicode) through sanitizer + parser; `setText` with `<script>` markup stays inert text;
  variable names with hostile content length-capped and rendered only as React text.

## 10. Slice plan

1. **SavigScript** — tokenize/parse/evaluate + caps + coercion table (pure TDD).
2. **Session** — fire/chain-walk/hover-diff/scene-identity/tick/overrides/stop-reset (fake host).
3. **Model + store + sanitizer + v7** — types, `interactionsSlice`, `sanitizeInteractions`,
   migration, engine version stamp.
4. **Preview mode + Stage wiring** — gate, leaf→chain resolution, key scoping, applyOverrides
   in the editor frame path.
5. **Authoring UI** — Inspector Behaviors section + project Interactions panel.
6. **Runtime export** — listeners, RAF integration, build:runtime, export e2e parity.
7. **Agent parity** — builders, describe, validate, DSL, MCP tools.
8. **Comprehensive e2e + security review + INDEX + merge** — per-slice cadence as always.

Each slice: TDD, reviewer pass looped to clean, then merge; security gate before final merge
(new parse surface: SavigScript + sanitizeInteractions + DSL interactions section).
