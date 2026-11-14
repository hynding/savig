# Bone springs — slice 2 plan (agent surfaces)

Spec: `specs/2026-11-14-bone-springs-design.md`.

- [x] engine `bakeProjectSprings` (root or per scene; same project when unchanged).
- [x] core `BoneOpts.spring`, `setBoneSpring` (validated, bakes); `bakeProjectSprings` re-export.
- [x] DSL `ShortBone.spring`; `compileShort` bakes at the end; decompile omits the bake.
- [x] describe ` spring=s/d`.
- [x] MCP `set_bone_spring`, `add_bone.spring`, re-bake in `edited`.
- [x] Template `springy-antenna`.
- [x] Tests: core (`bones.test.ts` springs block), MCP tool test, template suite.
