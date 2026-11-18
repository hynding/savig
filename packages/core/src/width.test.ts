import { describe, expect, it } from 'vitest';
import { addPath, addRect, compileShort, createProject, decompileProject, describeProject, setWidthProfile } from './index';

const stroke = { fill: 'none', stroke: '#000', strokeWidth: 3 };
const line = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 50, y: 0 } }] };

describe('setWidthProfile (core)', () => {
  it('applies a preset, describes it, and clears it', () => {
    let { project } = addPath(createProject(), { path: line, id: 'p', style: stroke });
    project = setWidthProfile(project, 'p', 'taper-end');
    expect(describeProject(project)).toContain('width taper-end');
    project = setWidthProfile(project, 'p', [{ t: 0.5, w: 3 }]);
    expect(describeProject(project)).toContain('width 0.5:3');
    project = setWidthProfile(project, 'p', 'uniform');
    expect(describeProject(project)).not.toContain('width ');
  });

  it('round-trips through the DSL', () => {
    let { project } = addPath(createProject(), { path: line, id: 'p', style: stroke });
    project = setWidthProfile(project, 'p', 'bulge');
    const back = compileShort(decompileProject(project));
    const a = back.assets.find((x) => x.kind === 'vector');
    expect(a?.kind === 'vector' && a.style.widthProfile).toEqual([{ t: 0, w: 0.5 }, { t: 0.5, w: 2 }, { t: 1, w: 0.5 }]);
  });

  it('fails loud on bad input', () => {
    const { project } = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' });
    expect(() => setWidthProfile(project, 'r', 'taper-end')).toThrow(/no stroke/);
    expect(() => setWidthProfile(project, 'r', 'wobbly' as never)).toThrow(/unknown width preset/);
    expect(() => setWidthProfile(project, 'r', [{ t: NaN, w: 1 }])).toThrow(/finite/);
    expect(() => setWidthProfile(project, 'nope', null)).toThrow(/no object/);
  });
});
