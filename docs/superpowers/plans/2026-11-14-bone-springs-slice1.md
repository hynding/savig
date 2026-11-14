# Bone springs — slice 1 plan

Spec: `specs/2026-11-14-bone-springs-design.md`.

- [x] types `BoneSpring`; `springOffset` + `sampleObject` adds it (runtime regenerated).
- [x] engine `springs.ts`: `springConstants`, `simulateSprings`, `bakeSprings` (+ tests).
- [x] editor-state `autoBakeSprings` in `commit` (after tween re-bake); posing writes keyed angles
      (`poseBoneTip`, core `poseIK` subtract `springOffset`); BoneOverlay preview drops the bake.
- [x] Inspector: Spring strength / damping (`inspector-bone-spring`); VM fields.
- [x] Sanitizer: clamp settings, drop malformed spring/bake.
- [x] Tests: engine, store (simulate in one undo step, re-simulate on edits, keyed-angle posing,
      off), sanitizer, e2e `bone-springs.spec.ts` (Waving arm hand spring moves the palm; undo).
