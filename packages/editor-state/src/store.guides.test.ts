// Rulers and guides (spec 2026-11-19-rulers-guides): store verbs.
import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { createProject } from '@savig/engine';

const st = () => store.getState();
const guides = () => st().history.present.guides;

beforeEach(() => {
  st().setProject(createProject());
  store.setState({ guidesLocked: false, guidesVisible: true, rulersVisible: false });
});

describe('guide verbs', () => {
  it('adds, moves and removes guides, each one undo step, positions rounded', () => {
    st().addGuide('x', 100.4);
    st().addGuide('y', 50);
    expect(guides()).toEqual([{ axis: 'x', pos: 100 }, { axis: 'y', pos: 50 }]);
    st().moveGuide(0, 140.6);
    expect(guides()![0]).toEqual({ axis: 'x', pos: 141 });
    st().removeGuide(1);
    expect(guides()).toEqual([{ axis: 'x', pos: 141 }]);
    st().undo();
    expect(guides()).toHaveLength(2);
    st().undo();
    expect(guides()![0].pos).toBe(100);
  });

  it('removing the last guide drops the field; clear removes them all', () => {
    st().addGuide('x', 10);
    st().removeGuide(0);
    expect('guides' in st().history.present).toBe(false);
    st().addGuide('x', 10);
    st().addGuide('y', 20);
    st().clearGuides();
    expect(guides()).toBeUndefined();
    const before = st().history.past.length;
    st().clearGuides(); // nothing to clear -> no commit
    expect(st().history.past.length).toBe(before);
  });

  it('locked guides cannot be moved or removed; a no-op move does not commit', () => {
    st().addGuide('x', 10);
    const before = st().history.past.length;
    st().moveGuide(0, 10.2);
    expect(st().history.past.length).toBe(before);
    st().toggleGuidesLocked();
    st().moveGuide(0, 40);
    st().removeGuide(0);
    expect(guides()).toEqual([{ axis: 'x', pos: 10 }]);
  });

  it('adding a guide while guides are hidden shows them again', () => {
    st().toggleGuides();
    expect(st().guidesVisible).toBe(false);
    st().addGuide('y', 5);
    expect(st().guidesVisible).toBe(true);
  });

  it('toggles rulers', () => {
    st().toggleRulers();
    expect(st().rulersVisible).toBe(true);
  });
});
