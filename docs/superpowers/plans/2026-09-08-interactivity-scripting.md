# Interactivity & Scripting (M9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Interactive Savig shorts — per-object pointer behaviors, project-level keyboard/timeline handlers, and the sandboxed SavigScript expression language (variables, guards, computed args), running in an editor preview mode and the exported runtime bundle, with full DSL/MCP parity.

**Architecture:** One engine-owned interpreter (`script/` — tokenize→Pratt-parse→tree-walk evaluate; no loops/functions/member access = termination by construction) and one engine-owned `InteractiveSession` consumed by both the editor preview and the export runtime through an injected `SessionHost`. Behaviors are additive optional model fields (absent = zero listeners, byte-identical parity). Runtime effects are session-local overrides applied as a post-pass after the existing shared frame paint — the document is never mutated.

**Tech Stack:** TypeScript strict, pnpm monorepo, Vitest, Playwright, Zustand slice pattern, React 18 + ui-core controller/VM seam.

**Spec:** `docs/superpowers/specs/2026-09-08-interactivity-scripting-design.md` (binding authority — read it first; it carries the full grammar, coercion table, and session semantics).

## Global Constraints

- Branch `feature/interactivity` (from `main`).
- Additive optional model fields; conditional-spread (absent stays absent). Legacy projects: byte-identical behavior, ZERO armed listeners, zero preview cost outside preview mode.
- SavigScript caps: source ≤ 500 chars; AST depth ≤ 32 (breach = parse error). Coercion table is spec §4 VERBATIM (string `+` concat; booleans in `+` error; `- * / %` numbers-only; div-by-zero error; mixed `==` false / `!=` true; relational numbers-only; `! && || ?:` boolean-only; escapes `\\ \' \" \n \t` only).
- Session caps: ≤ 8 chained scene transitions per EXTERNAL `tickTo`/fire (then one `host.warn`, stop the tick); session is never re-entrant; `tick` fires once per EXTERNAL `tickTo`, only while playing.
- Semantics: undeclared-variable read = eval error; `setVar` may create dynamics; `reset()` restores declared initials and DELETES dynamics; `stop` = pause + seek(0) WITHOUT reset; host `seek` preserves playing state; errored guard/arg skips that ACTION only.
- Sanitizer caps: expression/arg values ≤ 500 chars; `args` ≤ 8 entries, keys ≤ 32; `key` ≤ 32; variable names ≤ 64, count ≤ 64; behaviors/object ≤ 64; global handlers ≤ 256; actions/behavior ≤ 32; unknown kinds/arg-keys dropped; `===` no-op parity. Version v6→v7 stamp-only.
- Event placement: pointer kinds on objects only; global kinds (`keydown/keyup/sceneStart/sceneEnd/tick`) on `project.interactions.handlers` only (validate rejects both violations).
- Commands: `node_modules/.bin/{vitest,tsc,eslint,playwright}` directly — never `pnpm <script>` (subagent env constraint); never touch `pnpm-workspace.yaml`. ⚠ ANY `packages/runtime/src` change ⇒ rerun `pnpm build:runtime` (main session) / `node scripts/build-runtime.mjs` equivalent per `package.json`, and commit `runtimeSource.generated.ts`.
- INDEX.md + security review + merge happen at the controller's end-gates (Task 8 scope note).

## File Structure

| File | Responsibility |
|---|---|
| `packages/engine/src/script/{tokenize,parse,evaluate}.ts` (create) | SavigScript: tokens → AST → value; caps; error values, never throws |
| `packages/engine/src/script/session.ts` (create) | `createSession`: events, guards, actions, cascade guard, overrides, vars |
| `packages/engine/src/script/resolve.ts` (create) | `resolveAuthoredChain`, `expandOverrides` (renderId↔authored mapping) |
| `packages/engine/src/types.ts` (modify) | `Behavior`, `BehaviorAction`, `InteractionModel`, event kind types |
| `packages/editor-state/src/slices/interactionsSlice.ts` (create) | behavior/variable actions (undoable) + `previewMode` transient |
| `packages/services/src/persistence/sanitizeInteractions.ts` (create) | hostile-JSON hardening at the `migrateProject` seam |
| `packages/services/src/persistence/migrate.ts` (modify) | v7 |
| `apps/react/src/ui/preview/{previewBridge.ts,usePreviewSession.ts,applyOverridesPass.ts}` (create) | editor preview wiring: session lifecycle, listeners, frame post-pass |
| `apps/react/src/ui/playback/usePlayback.ts` + `applyFrame.ts` (modify) | post-pass hook into the paint path |
| `apps/react/src/ui/hooks/useKeyboard.ts` caller (modify) | gate shortcuts during preview |
| `apps/react/src/ui/components/Inspector/BehaviorsSection.tsx` + `InteractionsPanel.tsx` (create) | authoring UI |
| `packages/ui-core/src/viewmodels/inspector.ts` (modify) | behaviors VM + intents |
| `packages/runtime/src/index.ts` (modify) | bundle-side session wiring |
| `packages/core/src/{build,describe,validate,dsl}.ts`, `packages/mcp/src/tools.ts` (modify) | agent parity |
| `e2e/interactivity.spec.ts` (create) | comprehensive e2e |

---

### Task 1: SavigScript — tokenize, parse, evaluate

**Files:**
- Create: `packages/engine/src/script/tokenize.ts`, `parse.ts`, `evaluate.ts`, and tests `script/savigscript.test.ts`
- Modify: `packages/engine/src/index.ts` (export `parse`, `evaluate`, and types)

**Interfaces:**
- Consumes: nothing (pure).
- Produces (later tasks rely on EXACT names):
  - `type Value = number | string | boolean`
  - `type ParseResult = { ok: true; ast: Expr } | { ok: false; message: string; pos: number }`
  - `type EvalResult = { ok: true; value: Value } | { ok: false; message: string }`
  - `interface EvalEnv { vars: ReadonlyMap<string, Value>; time: number; sceneIndex: number; sceneTime: number; random(): number }`
  - `parse(source: string): ParseResult` · `evaluate(ast: Expr, env: EvalEnv): EvalResult`
  - `Expr` is an opaque discriminated-union AST type (exported for typing only).

- [ ] **Step 1: Write the failing tests** — `savigscript.test.ts`. Helper: `const run = (src: string, vars: Record<string, Value> = {}, env: Partial<EvalEnv> = {}) => { const p = parse(src); if (!p.ok) return p; return evaluate(p.ast, { vars: new Map(Object.entries(vars)), time: 0, sceneIndex: 0, sceneTime: 0, random: () => 0.5, ...env }); };` Cases (each an `it`, asserting exact `{ok, value}` / `{ok:false}` shapes):

```ts
// literals & precedence
run('1 + 2 * 3')            → { ok: true, value: 7 }
run('(1 + 2) * 3')          → { ok: true, value: 9 }
run('10 % 3')               → { ok: true, value: 1 }
run('-4 + 1')               → { ok: true, value: -3 }
run('1 < 2 == true')        → { ok: true, value: true }   // relational binds tighter than equality
run('true ? 1 : false ? 2 : 3') → { ok: true, value: 1 }  // ternary right-assoc: false-branch is (false?2:3)
// strings
run("'a' + 1")              → { ok: true, value: 'a1' }
run('"x" + "y"')            → { ok: true, value: 'xy' }
run("'it\\'s' + \"\\n\"")   → ok, value "it's\n"
parse("'bad\\q'")           → { ok: false, pos } // unknown escape
// booleans & logic
run('true && false')        → { ok: true, value: false }
run('false && (1 / 0 > 0)') → { ok: true, value: false }  // short-circuit: RHS never evaluated
run('true || undeclared')   → { ok: true, value: true }   // short-circuit skips undeclared read
run('!false')               → { ok: true, value: true }
// coercion errors (spec §4 table — one test per row)
run('true + 1')             → { ok: false }
run("'a' - 1")              → { ok: false }
run('1 / 0')                → { ok: false }
run("1 == 'a'")             → { ok: true, value: false }
run("1 != 'a'")             → { ok: true, value: true }
run("'a' < 'b'")            → { ok: false }
run('1 && true')            → { ok: false }
run('1 ? 2 : 3')            → { ok: false }
// variables & builtins
run('score + 1', { score: 2 })          → { ok: true, value: 3 }
run('missing')                           → { ok: false }  // undeclared read = eval error
run('time + sceneTime', {}, { time: 2, sceneTime: 1 }) → { ok: true, value: 3 }
run('random() < 1')                      → { ok: true, value: true }
parse('random(1)')                       → { ok: false }   // random takes no args
parse('foo()')                           → { ok: false }   // only random is callable
// caps & errors
parse('1 + '.repeat(200) + '1')          → { ok: false }   // depth or length cap
parse('x'.repeat(501))                   → { ok: false, pos: 500 } // source length cap
parse('1 +')                             → { ok: false }   // pos points at the gap
parse('(1 + 2')                          → { ok: false }
// no forbidden forms
parse('a.b')  → { ok: false };  parse('a[0]') → { ok: false };  parse('a = 1') → { ok: false }
```

- [ ] **Step 2: Verify RED** — `node_modules/.bin/vitest run packages/engine/src/script` → FAIL (module not found).

- [ ] **Step 3: Implement.** Three focused files:

`tokenize.ts`:
```ts
export interface Token { kind: 'num' | 'str' | 'ident' | 'op' | 'lparen' | 'rparen' | 'question' | 'colon' | 'eof'; text: string; value?: number | string; pos: number }
export type TokenizeResult = { ok: true; tokens: Token[] } | { ok: false; message: string; pos: number };
const OPS = ['&&', '||', '==', '!=', '<=', '>=', '+', '-', '*', '/', '%', '<', '>', '!'];
const ESCAPES: Record<string, string> = { '\\': '\\', "'": "'", '"': '"', n: '\n', t: '\t' };
export function tokenize(source: string): TokenizeResult {
  if (source.length > 500) return { ok: false, message: 'expression longer than 500 characters', pos: 500 };
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const start = i;
      while (i < source.length && /[0-9.]/.test(source[i])) i++;
      const text = source.slice(start, i);
      const value = Number(text);
      if (!Number.isFinite(value)) return { ok: false, message: `bad number "${text}"`, pos: start };
      tokens.push({ kind: 'num', text, value, pos: start });
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c; const start = i; let out = ''; i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') {
          const esc = ESCAPES[source[i + 1]];
          if (esc === undefined) return { ok: false, message: `unknown escape "\\${source[i + 1] ?? ''}"`, pos: i };
          out += esc; i += 2;
        } else { out += source[i]; i++; }
      }
      if (i >= source.length) return { ok: false, message: 'unterminated string', pos: start };
      i++; tokens.push({ kind: 'str', text: out, value: out, pos: start });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) i++;
      tokens.push({ kind: 'ident', text: source.slice(start, i), pos: start });
      continue;
    }
    if (c === '(') { tokens.push({ kind: 'lparen', text: c, pos: i++ }); continue; }
    if (c === ')') { tokens.push({ kind: 'rparen', text: c, pos: i++ }); continue; }
    if (c === '?') { tokens.push({ kind: 'question', text: c, pos: i++ }); continue; }
    if (c === ':') { tokens.push({ kind: 'colon', text: c, pos: i++ }); continue; }
    const op = OPS.find((o) => source.startsWith(o, i));
    if (op) { tokens.push({ kind: 'op', text: op, pos: i }); i += op.length; continue; }
    return { ok: false, message: `unexpected character "${c}"`, pos: i };
  }
  tokens.push({ kind: 'eof', text: '', pos: source.length });
  return { ok: true, tokens };
}
```
(Note: a lone `=` matches no OPS entry and errors as an unexpected character — assignment, member access `.`, and `[` all fall through to `unexpected character`, satisfying the forbidden-form tests. `a.b` fails at the `.`.)

`parse.ts` (Pratt; depth-capped):
```ts
export type Expr =
  | { kind: 'lit'; value: Value }
  | { kind: 'var'; name: string; pos: number }
  | { kind: 'call'; name: 'random'; pos: number }
  | { kind: 'unary'; op: '-' | '!'; expr: Expr; pos: number }
  | { kind: 'binary'; op: string; left: Expr; right: Expr; pos: number }
  | { kind: 'ternary'; cond: Expr; then: Expr; else: Expr; pos: number };
const BIN_PRECEDENCE: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
const MAX_DEPTH = 32;
```
Structure: `parse(source)` → tokenize → recursive-descent with `parseExpr(minPrec, depth)`; ternary handled at the top level of `parseExpr` after the binary loop (`cond ? parseExpr(0) : parseExpr(0)`, right-assoc); `parsePrimary(depth)`: num/str/`true`/`false` → lit; ident followed by `lparen` → only `random()` (with immediate `rparen`; anything else = error); ident → var; lparen → parenthesized; unary `-`/`!` → recurse. Every recursion increments depth; `depth > MAX_DEPTH` → `{ ok:false, message:'expression too deeply nested', pos }`. Trailing tokens after the expression (`kind !== 'eof'`) → error at that token's pos.

`evaluate.ts` — direct transcription of the spec §4 coercion table:
```ts
export function evaluate(ast: Expr, env: EvalEnv): EvalResult {
  try { return { ok: true, value: evalNode(ast, env) }; }
  catch (e) { return { ok: false, message: (e as Error).message }; }
}
// evalNode throws EvalError-lite Errors internally (single try/catch at the boundary keeps
// per-node code simple while the PUBLIC contract never throws).
function evalNode(n: Expr, env: EvalEnv): Value {
  switch (n.kind) {
    case 'lit': return n.value;
    case 'var': {
      if (n.name === 'time') return env.time;
      if (n.name === 'sceneIndex') return env.sceneIndex;
      if (n.name === 'sceneTime') return env.sceneTime;
      const v = env.vars.get(n.name);
      if (v === undefined) throw new Error(`unknown variable "${n.name}"`);
      return v;
    }
    case 'call': return env.random();
    case 'unary': {
      const v = evalNode(n.expr, env);
      if (n.op === '-') { if (typeof v !== 'number') throw new Error('unary - needs a number'); return -v; }
      if (typeof v !== 'boolean') throw new Error('! needs a boolean');
      return !v;
    }
    case 'binary': {
      if (n.op === '&&' || n.op === '||') {
        const l = evalNode(n.left, env);
        if (typeof l !== 'boolean') throw new Error(`${n.op} needs booleans`);
        if (n.op === '&&' && !l) return false;
        if (n.op === '||' && l) return true;
        const r = evalNode(n.right, env);
        if (typeof r !== 'boolean') throw new Error(`${n.op} needs booleans`);
        return r;
      }
      const l = evalNode(n.left, env); const r = evalNode(n.right, env);
      switch (n.op) {
        case '+':
          if (typeof l === 'string' || typeof r === 'string') {
            if (typeof l === 'boolean' || typeof r === 'boolean') throw new Error('+ cannot mix booleans');
            return String(l) + String(r);
          }
          if (typeof l !== 'number' || typeof r !== 'number') throw new Error('+ cannot mix booleans');
          return l + r;
        case '-': case '*': case '/': case '%': {
          if (typeof l !== 'number' || typeof r !== 'number') throw new Error(`${n.op} needs numbers`);
          if ((n.op === '/' || n.op === '%') && r === 0) throw new Error('division by zero');
          return n.op === '-' ? l - r : n.op === '*' ? l * r : n.op === '/' ? l / r : l % r;
        }
        case '==': return typeof l === typeof r ? l === r : false;
        case '!=': return typeof l === typeof r ? l !== r : true;
        default: { // relational
          if (typeof l !== 'number' || typeof r !== 'number') throw new Error(`${n.op} needs numbers`);
          return n.op === '<' ? l < r : n.op === '<=' ? l <= r : n.op === '>' ? l > r : l >= r;
        }
      }
    }
    case 'ternary': {
      const c = evalNode(n.cond, env);
      if (typeof c !== 'boolean') throw new Error('?: condition needs a boolean');
      return evalNode(c ? n.then : n.else, env);
    }
  }
}
```

- [ ] **Step 4: Verify GREEN** — `node_modules/.bin/vitest run packages/engine/src/script` → all pass. Full engine suite → pass.
- [ ] **Step 5: Export from `packages/engine/src/index.ts`; typecheck; commit** — `git add -A && git commit -m "feat(engine): SavigScript tokenizer/parser/evaluator"` (Co-Authored-By trailer as always).

---

### Task 2: Session + resolve/expand helpers

**Files:**
- Create: `packages/engine/src/script/session.ts`, `packages/engine/src/script/resolve.ts`, tests `session.test.ts`, `resolve.test.ts`
- Modify: `packages/engine/src/types.ts` (model types), `packages/engine/src/index.ts` (exports)

**Interfaces:**
- Consumes (Task 1): `parse`, `evaluate`, `Value`, `EvalEnv`. Engine: `projectScenes`, `resolveTimeline`, `sceneAtTime`.
- Produces (EXACT — later tasks import these):
  - Types from spec §3 VERBATIM: `PointerEventKind`, `GlobalEventKind`, `BehaviorAction`, `Behavior`, `InteractionModel`; `SceneObject.behaviors?: Behavior[]`; `Project.interactions?: InteractionModel`.
  - `interface ObjectOverride { hidden?: boolean; opacity?: number; dx?: number; dy?: number; text?: string }`
  - `interface SessionHost { play(): void; pause(): void; seek(t: number): void; now(): number; random(): number; warn(message: string): void }`
  - `createSession(project: Project, host: SessionHost): InteractiveSession` with the spec §5 interface (`firePointer(kind, chain)`, `fireKey(kind, key)`, `pointerAt(chain | null)`, `tickTo(masterTime, playing)`, `overrides()`, `vars()`, `onChange(cb): unsub`, `reset()`).
  - `resolveAuthoredChain(project: Project, renderId: string): string[]` — strip `/@\d+$/` repeater suffix; first `/` segment = targetable authored object; then `parentId` walk within its containing scene, leaf-first; unknown id → `[]`.
  - `expandOverrides(project: Project, overrides: ReadonlyMap<string, ObjectOverride>, renderIds: Iterable<string>): Map<string, ObjectOverride>` — maps authored-object overrides onto the consumer's actual leaf renderIds (a renderId matches an authored id when its first segment IS that id, or is a DESCENDANT of it via the parentId walk / instance containment). NOTE: deviation from the spec's sketched signature — the renderId universe comes from the consumer's nodes map; recorded here deliberately.

- [ ] **Step 1: Failing tests.** `resolve.test.ts`: chain for a plain leaf (`[leafId]`), leaf in nested groups (`[leaf, group1, group2]`), instance-namespaced leaf `inst1/child` → `[inst1, ...inst1's groups]`, repeater `leaf@2` → same as `leaf`, unknown → `[]`. `expandOverrides`: override on a group maps onto both child leaves' renderIds; override on an instance maps onto `inst1/a`, `inst1/b`; leaf override maps onto itself; unrelated renderIds untouched.
  `session.test.ts` (fake host records calls; project builders from `@savig/core` or hand-built objects):
  - guard true fires action; guard false / eval-error / non-boolean skips THAT action, later actions still run
  - chain walk: behavior on group fires when leaf chain passed; nearest-first order across chain; array order within object
  - `setVar` + `vars()`; undeclared setVar creates; `reset()` restores declared initials and deletes dynamics
  - overrides: `hide` then `show` yields explicit `hidden:false` entry; `setOpacity` clamps 0..1; `setText` on non-text target is a no-op; last-write-wins
  - playback: `play`/`pause` call host; `stop` = host.pause + host.seek(0), vars survive; `seek.time` expression evaluated, negative clamps to 0; `gotoScene` seeks the span start (multi-scene project via `resolveTimeline`)
  - scene identity: `tickTo` across a span boundary fires `sceneEnd(a)` then `sceneStart(b)`; seek-while-paused fires them; session start fires initial `sceneStart`; `sceneId`-filtered handlers only fire for their scene
  - cascade guard: `sceneStart` handler doing `gotoScene` to the next scene chains; a 2-scene mutual gotoScene loop stops after 8 transitions with exactly ONE `host.warn`; `tick` fired at most once for that external call
  - re-entrancy: calling `tickTo` from within a handler (simulate: host.seek implementation synchronously calls `session.tickTo`) does not recurse (assert via handler-execution order log)
  - keyboard: `fireKey('keydown','ArrowLeft')` matches only handlers with that key; `hoverEnter`/`hoverLeave` via `pointerAt` chain diffs incl. moving between two leaves of the SAME group (no spurious leave/enter for the group); `pointerAt(null)` leaves all; `reset()` clears hover without synthetic leaves
  - `onChange` fires when vars/overrides change, not for a no-op event; unsub works
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement.** `session.ts` structure (spec §5 is the contract; key internals):

```ts
// Internal state: vars (Map, seeded from declared initials), overrides (Map<authoredId, ObjectOverride>),
// hoverChain: string[] , lastSceneId: string | null, processing: boolean, pendingTime: number | null,
// warnedCascade: boolean (per external call), listeners: Set<() => void>, changed: boolean.
// Behaviors index built once at createSession: objectBehaviors: Map<objectId, Behavior[]> across
// ALL scenes' objects (projectScenes), globalHandlers: Behavior[] from interactions.handlers.
// runActions(behavior, ownerObjectId | null): for each action — evaluate `if` (skip on non-true),
// evaluate expression args via evaluate(parseCache(src), env()); parse results cached by source string.
// env(): { vars, time: host.now(), sceneIndex/sceneTime from sceneAtTime(project, host.now()), random: host.random }.
// External entry points (firePointer/fireKey/pointerAt/tickTo) all funnel through
// withProcessing(fn): if processing → (tickTo only) record pendingTime, return; else set processing,
// run fn, then drain: let hops = 0; while (pendingTime !== null && hops < 8) { const t = pendingTime;
// pendingTime = null; hops++; emitSceneChange(t); } if (pendingTime !== null) { host.warn(...) once };
// processing = false; if (changed) notify().
// emitSceneChange(t): const id = sceneAtTime(project, t).primary.scene.id; if (id !== lastSceneId)
// { fire sceneEnd handlers for lastSceneId; fire sceneStart handlers for id; lastSceneId = id; }
// tickTo(masterTime, playing): withProcessing(() => { emitSceneChange(masterTime);
//   if (playing && !tickFiredThisCall) fire 'tick' handlers once; });
// host.seek called from an action: sets pendingTime = t as well (the session cannot rely on the
// consumer's tickTo arriving synchronously) — the drain loop above then emits scene events.
```
`resolve.ts`: pure walks over `projectScenes(project)` object arrays (build `byId` + `childrenOf` maps per call; these run on user gestures, not per-frame — no caching needed).
- [ ] **Step 4: GREEN; full engine suite; typecheck.**
- [ ] **Step 5: Commit** — `feat(engine): interaction model + InteractiveSession + chain/override resolution`.

---

### Task 3: Store slice + sanitizer + v7

**Files:**
- Create: `packages/editor-state/src/slices/interactionsSlice.ts` (+ test), `packages/services/src/persistence/sanitizeInteractions.ts` (+ test)
- Modify: `packages/editor-state/src/store-internals.ts` (action types; `previewMode: boolean` in `TRANSIENT_DEFAULTS` at :569 + interface), `packages/editor-state/src/store.ts` (compose slice), `packages/services/src/persistence/migrate.ts` (v7), engine `createProject` version stamp (`packages/engine/src/project.ts:60`, 6→7 + its pinned tests)

**Interfaces:**
- Consumes (Task 2 types). Produces store actions (EXACT names; all `commit`-undoable except the transient pair):
  - `addBehavior(objectId: string | null, behavior: Omit<Behavior, 'id'>): void` (null = project handler; id = newId())
  - `updateBehavior(objectId: string | null, behaviorId: string, patch: Partial<Omit<Behavior, 'id'>>): void`
  - `removeBehavior(objectId: string | null, behaviorId: string): void`
  - `addVariable(name: string, initial: number | string | boolean): void` · `updateVariable(name, initial): void` · `removeVariable(name): void`
  - Transient: `enterPreview(): void` / `exitPreview(): void` toggling `previewMode` (plain `set`; `enterPreview` also clears object selection via the existing `NO_KEYFRAME_SELECTION`-style patch + `selectedObjectIds: []`).
  - `sanitizeInteractionsModel(project: Project): Project` wired into `migrateProject` beside `sanitizeAudioModel`.

- [ ] **Step 1: Failing slice tests** (fresh `useEditor.getState()` per read): each action + undo restores; behaviors on objects route through the ACTIVE scene (find the object across scenes — reuse the pattern `audioSlice` uses for assets/clips lookups; behaviors edit the object wherever it lives, incl. inside `scenes[]`); `addBehavior(null, …)` lands in `project.interactions.handlers` (creating `interactions` conditionally — absent stays absent when the last handler/variable is removed); duplicate `addVariable` name replaces (documented upsert); `enterPreview` clears selection and does NOT create an undo entry.
- [ ] **Step 2: RED.** **Step 3: implement** (conditional-spread throughout; deleting the last behavior removes the `behaviors` field from the object; deleting the last variable AND handler removes `interactions`). **Step 4: GREEN + full editor-state suite.**
- [ ] **Step 5: Failing sanitizer tests** — table-driven, mirroring `sanitizeAudio.test.ts` and the Global Constraints caps verbatim, plus: non-array `behaviors`/`handlers`/`variables` → field dropped; behavior with unknown `event` dropped; action with unknown `kind` dropped; `args` with 9 entries → truncated to 8 (stable order); arg key not in that kind's known set dropped (known sets: seek:{time}, gotoScene:{sceneId}, setVar:{name,value}, setOpacity:{targetId,value}, setPosition:{targetId,dx,dy}, setText:{targetId,value}, show/hide:{targetId}, play/pause/stop:{}); pointer kind in `handlers` / global kind on an object BEHAVIOR is NOT the sanitizer's job (validate's) — sanitizer keeps them (test pins this boundary); hostile keys: a behavior/args object carrying a literal `"__proto__"` key does not pollute `Object.prototype` (object-spread is CreateDataProperty-safe — pin with a test asserting `({} as any).polluted === undefined` after sanitize) and unknown-arg-key dropping removes it anyway; hostile-unicode names/keys survive only length-capped; `===` reference identity for a project with no interactions AND for one with entirely-valid interactions.
- [ ] **Step 6: RED → implement `sanitizeInteractions.ts`** (copy `sanitizeAudio.ts`'s changed-flag/identity structure) **→ GREEN.** Wire into `migrateProject` after `sanitizeAudioModel`; `CURRENT_VERSION = 7`, `migrations[6]` stamp-only; engine stamp 7; fix version-pinned tests (grep `version: 6` / `toBe(6)` in engine+services tests).
- [ ] **Step 7: Full unit suite + typecheck; commit** — `feat(editor,persistence): interactions slice, sanitizer, v7`.

---

### Task 4: Editor preview mode — session wiring + override post-pass

**Files:**
- Create: `apps/react/src/ui/preview/previewBridge.ts`, `apps/react/src/ui/preview/usePreviewSession.ts`, `apps/react/src/ui/preview/applyOverridesPass.ts` (+ `applyOverridesPass.test.ts`, `usePreviewSession.test.tsx`)
- Modify: `apps/react/src/ui/playback/applyFrame.ts` (post-pass hook), `apps/react/src/ui/components/Stage/Stage.tsx` (preview gate + listeners + re-apply effect), the `useKeyboard(host, blocked)` CALL SITE (find it: `grep -rn "useKeyboard(" apps/react/src --include="*.tsx"`) to OR in `previewMode`, and the transport toolbar component (find the play/pause buttons: `grep -rn "aria-label=\"Play\"\|Play button" apps/react/src/ui/components` — follow its actual markup) to add the Preview toggle button (`data-testid="preview-toggle"`, `aria-pressed`).

**Interfaces:**
- Consumes: Tasks 1–3 (`createSession`, `resolveAuthoredChain`, `expandOverrides`, `previewMode`, `enterPreview`/`exitPreview`).
- Produces:
  - `previewBridge` (module singleton): `{ setSession(s: InteractiveSession | null): void; getSession(): InteractiveSession | null; postApply(nodes: Map<string, SVGGraphicsElement>, project: Project, time: number): void }` — `postApply` is a NO-OP when no session (zero cost outside preview).
  - `applyOverridesPass(nodes, expanded: Map<string, ObjectOverride>): void` — the DOM post-pass:
```ts
export function applyOverridesPass(nodes: Map<string, SVGGraphicsElement>, expanded: Map<string, ObjectOverride>): void {
  for (const [renderId, o] of expanded) {
    const node = nodes.get(renderId);
    if (!node) continue;
    if (o.hidden !== undefined) node.setAttribute('display', o.hidden ? 'none' : '');
    if (o.opacity !== undefined) node.setAttribute('opacity', String(o.opacity));
    if (o.dx !== undefined || o.dy !== undefined) {
      node.setAttribute('transform', `translate(${o.dx ?? 0} ${o.dy ?? 0}) ${node.getAttribute('transform') ?? ''}`);
    }
    if (o.text !== undefined && node.tagName.toLowerCase() === 'text') node.textContent = o.text;
  }
}
```
  - `usePreviewSession(getSvgRoot: () => SVGSVGElement | null, getNodes: () => Map<string, SVGGraphicsElement>): void` — mounted once in Stage.

- [ ] **Step 1: Failing `applyOverridesPass` tests** (jsdom): display/opacity/translate-prepend/text-only-on-text; idempotence per frame (re-running after a fresh frame-write yields ONE translate prefix — simulate by re-setting the transform attr between calls).
- [ ] **Step 2: RED → implement → GREEN.**
- [ ] **Step 3: Hook the paint path.** `applyFrame.ts`:
```ts
import { previewBridge } from '../preview/previewBridge';
export function applyFrame(nodes, project, time): void {
  applyFrameToNodes(nodes, computeFrame(project, time));
  previewBridge.postApply(nodes, project, time);  // no-op when no session
}
```
`postApply` = `const s = session; if (!s) return; s.tickTo(time, playingFromStore()); applyOverridesPass(nodes, expandOverrides(project, s.overrides(), nodes.keys()));` (read `playing` off `useEditor.getState()` inside the bridge — import the store the way `audioSlice` consumers do; expansion re-runs per frame — cache by overrides-map identity if the profiler ever complains, not preemptively).
- [ ] **Step 4: `usePreviewSession`.** On `previewMode` flip to true: build host `{ play: () => st().setPlaying(true), pause: () => st().setPlaying(false), seek: (t) => st().seek(t), now: () => st().time, random: mulberry32(Date.now() >>> 0), warn: (m) => console.warn('[savig preview]', m) }` — with the 3-line PRNG exported from `previewBridge.ts`: `export function mulberry32(seed: number): () => number { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }`; `createSession(project, host)`; `previewBridge.setSession(s)`; attach to the Stage SVG root: `click`/`pointerdown`/`pointerup` → `resolveAuthoredChain` from `(e.target as Element).closest('[data-savig-object]')?.getAttribute('data-savig-object')` → `firePointer`; `pointerover`/`pointerout` → chain (or null when leaving the root) → `pointerAt`; container `keydown`/`keyup` (skip `e.repeat`; `Escape` → `exitPreview()`) → `fireKey`; focus the container. Subscribe: store `time` changes NOT from the RAF path (i.e. seeks while paused) → `s.tickTo(time, playing)`; `s.onChange(() => reapply())` where `reapply()` = run `applyFrame(getNodes(), project, time)` once. React-commit re-apply: a `useEffect` with NO dep array inside Stage, gated on `previewMode`, calling `reapply()` (spec §6 React-commit interplay). On flip to false or unmount: remove listeners, `previewBridge.setSession(null)`, `s.reset()`, force one plain `applyFrame` (attribute restore) — text nodes restore via the React re-render that exiting triggers.
- [ ] **Step 5: Gate editing.** Stage: at the TOP of `onObjectPointerDown`, `onBackgroundPointerDown`, and the handle pointer-down handlers (Stage.tsx lines ~1137/1306+): `if (previewMode) return;`. `useKeyboard` call site: `useKeyboard(host, blocked || previewMode)`. Toolbar: Preview button calls `enterPreview`/`exitPreview`; visually `aria-pressed={previewMode}`.
- [ ] **Step 6: RTL tests** (`usePreviewSession.test.tsx`, mirroring `AudioLanes.test.tsx`'s real-store pattern): entering preview + clicking a leaf with a click→setVar behavior updates `session.vars()` (observable via a setText action on a text object → node textContent); editing gestures blocked (pointerdown on object does NOT select); Esc exits; exit restores selection gestures. Run apps/react suite.
- [ ] **Step 7: Full unit + typecheck + basic e2e smoke** (extend nothing yet — Task 8 owns e2e; just run existing suites). **Commit** — `feat(editor): interactive preview mode (session bridge, override post-pass, gating)`.

---

### Task 5: Authoring UI — Behaviors section + Interactions panel

**Files:**
- Create: `apps/react/src/ui/components/Inspector/BehaviorsSection.tsx`, `InteractionsPanel.tsx` (+ tests)
- Modify: `apps/react/src/ui/components/Inspector/Inspector.tsx` (mount points: BehaviorsSection inside the single-object branches; InteractionsPanel inside the `vm.kind === 'empty'` branch at :294), `packages/ui-core/src/viewmodels/inspector.ts` (VM: selected object's behaviors + project variables/handlers + intents wrapping the Task 3 store actions)

**Interfaces:** consumes Task 3 actions + Task 1 `parse` (live validation). Produces data-testids later e2e relies on: `add-behavior`, `behavior-event-<behaviorId>`, `behavior-key-<behaviorId>`, `add-action-<behaviorId>`, `action-kind-<actionId?>` (use index when actions lack ids: `action-kind-<behaviorId>-<i>`), `action-arg-<behaviorId>-<i>-<argName>`, `action-if-<behaviorId>-<i>`, `remove-behavior-<behaviorId>`, `expr-error-<behaviorId>-<i>` (inline parse error `message@pos`), `add-variable`, `variable-name-<name>`, `variable-initial-<name>`.

- [ ] **Step 1:** VM + intents (ui-core) with unit tests (behaviors listed for selected object; variables/handlers for empty selection).
- [ ] **Step 2:** BehaviorsSection: list + add (default `click`, empty actions); event `<select>` (pointer kinds only); key capture `<input>` shown for key events — NOT rendered here (objects can't have key events; the same component is reused by InteractionsPanel with global kinds only — pass an `eventKinds` prop). Action rows: kind `<select>`, per-kind arg inputs (expression inputs are plain text `<input>`s; on change run `parse` and render `expr-error-*` when `!ok`), `if` input, remove buttons. All edits call `updateBehavior` with the full patched behavior (single undo entry per field commit — commit onBlur, not per keystroke, mirroring the Inspector's `NumberField` commit pattern).
- [ ] **Step 3:** InteractionsPanel: variables table (add/rename→`updateVariable` upsert/remove; initial input infers type: `true`/`false` → boolean, numeric string → number, else string — pin with a test) + global handlers via the shared behavior editor (`eventKinds` = global kinds; key field for keydown/keyup; sceneId `<select>` from project scenes for scene events).
- [ ] **Step 4:** RTL tests: add behavior → store updated; bad expression shows `expr-error` with pos; variable add + type inference; global handler with key. Run suites.
- [ ] **Step 5: Commit** — `feat(ui): behaviors section + interactions panel`.

---

### Task 6: Runtime export

**Files:**
- Modify: `packages/runtime/src/index.ts` (+ rebuild `runtimeSource.generated.ts`)
- Test: extend `packages/runtime` unit tests if the package has them (check `ls packages/runtime/src/*.test.ts`); the behavioral proof is Task 8's bundle e2e.

**Interfaces:** consumes `createSession`, `resolveAuthoredChain`, `expandOverrides`, `applyFrameToNodes` internals already in the file.

- [ ] **Step 1:** In `create()`: after nodes are collected, when `project.interactions || any object behaviors` (walk `projectScenes`): build host —
```ts
// clock control: keep existing `clock` and RAF loop; host mutates it.
const host = {
  play: () => { clock = play(clock, performance.now() / 1000); ensureLoop(); },
  pause: () => { clock = pause(clock, performance.now() / 1000); },
  seek: (t: number) => { clock = seekClock(clock, t, performance.now() / 1000); apply(clock.time); },
  now: () => clock.time,
  random: Math.random,
  warn: (m: string) => console.warn('[savig]', m),
};
```
(Use the engine clock's actual API — read `packages/engine/src/clock.ts` first; if it lacks pause/seek helpers, add PURE helpers there (`pause(clock, now)`, `seekTo(clock, t, now)` re-anchoring the baseline) with unit tests in engine — that preserves play-state across seeks per the spec host contract.)
Wire listeners on `svg`: click/pointerdown/pointerup → closest `[data-savig-object]` → `resolveAuthoredChain` → `firePointer`; pointerover/pointerout → `pointerAt`; `svg.ownerDocument` keydown/keyup (skip `e.repeat`) → `fireKey`. In the RAF loop after `apply(clock.time)`: `session.tickTo(clock.time, clock.playing); applyOverridesPassRuntime(nodes, expandOverrides(project, session.overrides(), nodes.keys()))` — the runtime keeps its own copy of the DOM pass (the bundle cannot import from apps/); write it in `runtime/src/index.ts` verbatim:
```ts
function applyOverridesPassRuntime(nodes: Map<string, Element>, expanded: Map<string, ObjectOverride>): void {
  for (const [renderId, o] of expanded) {
    const node = nodes.get(renderId);
    if (!node) continue;
    if (o.hidden !== undefined) node.setAttribute('display', o.hidden ? 'none' : '');
    if (o.opacity !== undefined) node.setAttribute('opacity', String(o.opacity));
    if (o.dx !== undefined || o.dy !== undefined) {
      node.setAttribute('transform', `translate(${o.dx ?? 0} ${o.dy ?? 0}) ${node.getAttribute('transform') ?? ''}`);
    }
    if (o.text !== undefined && node.tagName.toLowerCase() === 'text') node.textContent = o.text;
  }
}
``` `session.onChange(() => { if (!clock.playing) { apply(clock.time); …postpass… } })` for paused repaints. Zero listeners when no interactions.
- [ ] **Step 2: REBUILD** — run the build:runtime command from package.json via its underlying script; verify `runtimeSource.generated.ts` changed; commit together.
- [ ] **Step 3:** Run full unit suite + the existing export/roundtrip e2e (`node_modules/.bin/playwright test e2e/animated-svg-export.spec.ts e2e/open-svg-roundtrip.spec.ts --project=react`, pkill vite first) → legacy parity proof.
- [ ] **Step 4: Commit** — `feat(runtime): interactive session in exported bundle`.

---

### Task 7: Agent parity

**Files:** modify `packages/core/src/{build,describe,validate,dsl}.ts` + tests; `packages/mcp/src/tools.ts` + tests.

**Interfaces (EXACT):**
- Builders: `addBehavior(project, objectId: string | null, behavior: Omit<Behavior, 'id'> & { id?: string }): { project: Project; id: string }` · `updateBehavior(project, objectId: string | null, behaviorId: string, patch: Partial<Omit<Behavior, 'id'>>): Project` · `removeBehavior(project, objectId: string | null, behaviorId: string): Project` · `setVariable(project, name: string, initial: Value): Project` (upsert) · `removeVariable(project, name: string): Project`. Pure, no clamping.
- describe: after the audio block — `Interactions: N variable(s), M handler(s)` + per-variable `  - score = 0` + per-object `  - "obj-name": click → 2 action(s)` + per-handler `  - keydown[ArrowLeft] → 1 action(s)`.
- validate error codes: `script-parse-error` (message + pos, per expression arg and `if`), `undeclared-variable` (warn), `dangling-behavior-target` (targetId), `dangling-behavior-scene` (sceneId incl. gotoScene args), `settext-target-not-text`, `behavior-event-placement` (global kind on object / pointer kind on handler), `duplicate-variable`, `behavior-key-missing`, `behavior-target-missing` (object action on project handler without targetId).
- DSL: `ShortDoc.interactions?: { variables?: Array<{name, initial}>; handlers?: ShortBehavior[] }`, `ShortObjectCommon.behaviors?: ShortBehavior[]` where `ShortBehavior = { id?, event, key?, sceneId?, actions: Array<{ kind, args?, if? }> }` — compile via builders, decompile always emits ids, conditional-spread, round-trip test (object behavior + global handler + variables → `compileShort(decompileProject(p))` deep-equals interactions + behaviors).
- MCP tools: `add_behavior` ({ objectId? (absent = project handler), event, key?, sceneId?, actions (JSON array) }), `set_behavior` ({ objectId?, behaviorId, …patch }), `remove_behavior`, `set_variable` ({ name, initial }), `remove_variable` ({ name }) — project-level patches (no withScene for handlers; object behaviors DO route through the object lookup across scenes like other object tools); every description embeds the SavigScript cheat-sheet line: "Expressions: numbers/strings/booleans, vars, time/sceneIndex/sceneTime/random(), + - * / % == != < <= > >= && || ?: — no loops/functions/member access; ≤500 chars."

- [ ] Steps: TDD each layer in the order builders → describe (pin exact strings) → validate (table) → DSL (round-trip) → MCP (per-tool + describe smoke). Full suite + typecheck. Commit — `feat(core,mcp): interactions parity (builders, describe, validate, DSL, 5 MCP tools)`.

---

### Task 8: Comprehensive e2e + INDEX row

**Scope note:** the controller retains the security review and the merge — do NOT perform them.

**Files:** create `e2e/interactivity.spec.ts`; modify `docs/superpowers/INDEX.md` (M9 section + task table, merge hash "pending"; move NEXT pointer to M10 cloud per master §10).

- [ ] **Step 1:** 8 independent tests (each `page.goto('/')`, author via the real UI):
  1. Counter button: rect + text objects; behavior click→`setVar score = score+1` + `setText value = 'Score: ' + score` (targetId = text object) → preview → 2 clicks → text reads `Score: 2`.
  2. Keyboard: global keydown[ArrowRight] → `setPosition dx = 10` on a rect → preview → 3 presses → rect's transform contains `translate(10` (override present; assert via DOM attribute).
  3. gotoScene: 2-scene project, click behavior `gotoScene(scene2)` + scene2 `sceneStart` handler sets a text via `setText` → preview → click → text updated (proves sceneStart fired on jump).
  4. Hover: `hoverEnter` → `setOpacity 0.5`, `hoverLeave` → `setOpacity 1` → hover on/off → opacity attribute flips.
  5. Preview gating: enter preview → clicking an object does NOT select (no selection chrome testid); Esc exits; clicking now selects.
  6. Round-trip: author test-1's counter → export animated SVG (stub `showSaveFilePicker` per `open-svg-roundtrip.spec.ts`'s plumbing) → reopen → behaviors present (Inspector shows them) → preview → counter still works.
  7. Bundle: export the runtime bundle (mirror whatever `e2e/export.spec.ts`/buildBundle e2e does to obtain the html+js — read those specs first) → serve/load it → click the counter → text updates standalone.
  8. Legacy parity: load a template with no interactions → preview toggle on → clicking objects produces zero effects, playhead behavior unchanged; toggle off.
- [ ] **Step 2:** Full suites: `node_modules/.bin/vitest run` (expect ~2900+), `node_modules/.bin/playwright test --project=react` (all green; A/B any "pre-existing" claim against main), `tsc --noEmit`, `eslint .`.
- [ ] **Step 3:** INDEX.md M9 section (spec/plan links, 8-task table, note the SavigScript sandbox + cascade-guard design).
- [ ] **Step 4: Commit** — `test(e2e): interactivity suite; docs: INDEX M9 row`.
