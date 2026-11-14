# Bone springs — design

Status: approved direction (Steve, 2026-11-14 evening: "work on each in order"). From the bone
tool spec's Deferred list ("Spring/physics").

## Goal

Flash's bone *spring*: a sprung bone lags and overshoots its parent's motion, then settles back
onto its keyed angle — tails, antennas, hair and loose limbs get follow-through without hand keys.

## Model

```ts
interface BoneSpec { …; spring?: BoneSpring }
interface BoneSpring {
  strength: number;   // 1–100 (0 = off): natural frequency 0.4–5 Hz
  damping: number;    // 0–100: damping ratio 0.05 (rings) – 1 (critical)
  baked?: { fps: number; offsets: number[] };  // DERIVED: rotation offset (deg) per frame from 0
}
```

- `sampleObject` adds the baked offset (linear between frames, held past the ends) to the keyed
  rotation, so the editor, every export and the runtime play springs with no further work.
- Keys stay the user's: posing (IK/FK) subtracts the offset before writing a key; the pose-drag
  preview drops the bake for posed bones.
- No format bump: an older build ignores `spring` and plays the keyed motion.

## Simulation (engine `springs.ts`)

Per sprung bone, ancestors first (a sprung chain whips), 4 substeps per frame, deterministic:
world angle θ with angular velocity ω,
`α = −k(θ − θ_T) − c(ω − θ̇_T) − (u × a_J)/L`, where θ_T is the keyed world angle (ancestors at
their simulated rotations), a_J the joint's acceleration (pendulum swing) and u the bone
direction. The offset is the local-angle difference, clamped to the joint limits.
Constant parent rotation is followed rigidly; follow-through comes from acceleration and stops.

## Re-simulation

- Editor: every `commit` re-bakes springs (root objects or each scene) when the object list, the
  fps or the duration changed; the result rides in the same undo step. Springs inside symbols are
  not simulated in v1.
- Agents: engine `bakeProjectSprings(project)` re-bakes the root (project duration) or each
  scene (scene duration). Core `addBone({ spring })` and `setBoneSpring` bake; other builders
  don't, so a headless caller bakes after editing a sprung armature. `compileShort` bakes once at
  the end; the MCP server bakes after every mutating tool (`edited`).

## Agent surfaces

- Core: `BoneOpts.spring { strength, damping? }` (0–100, damping default 30, strength 0 = none);
  `setBoneSpring(project, boneId, spring | null)`; `bakeProjectSprings` re-exported.
- DSL: `ShortBone.spring { strength, damping? }`; decompile writes the settings, never the bake.
- describe: ` spring=<strength>/<damping>` on the bone line.
- MCP: `set_bone_spring { boneId, strength, damping? }`; `add_bone` takes `spring`.
- Template **Springy antenna**: only the bug's body bone is keyed (three hops); the two-bone
  sprung antenna lags, whips and settles.

## Editor

Inspector bone card: **Spring strength** (0 = off) and **Spring damping**.

## Slices

1. Model, simulation, sampling, editor re-simulate hook, posing fix, Inspector, sanitizer, e2e.
2. Agent surfaces: core `setBoneSpring` + re-bake in builders, DSL `spring`, describe, MCP,
   template.
