// Rulers and guides (spec 2026-11-19-rulers-guides). Guides live on the project (root Stage
// coordinates) and every edit is one undo step; the view toggles are preferences.
import { guidePos } from '@savig/engine';
import type { Project, RulerGuide } from '@savig/engine';
import type { SliceCreator, StoreGet } from '../store-internals';

type GuideKeys = 'toggleRulers' | 'toggleGuides' | 'toggleGuidesLocked' | 'addGuide' | 'moveGuide' | 'removeGuide' | 'clearGuides';

function commitGuides(get: StoreGet, guides: RulerGuide[]): void {
  const project = get().history.present;
  const out: Project = { ...project, guides };
  if (guides.length === 0) delete out.guides;
  get().commit(out);
}

export const createGuidesSlice: SliceCreator<GuideKeys> = (set, get) => ({
  toggleRulers() {
    set({ rulersVisible: !get().rulersVisible });
  },
  toggleGuides() {
    set({ guidesVisible: !get().guidesVisible });
  },
  toggleGuidesLocked() {
    set({ guidesLocked: !get().guidesLocked });
  },

  addGuide(axis, pos) {
    if (!Number.isFinite(pos)) return;
    const guides = get().history.present.guides ?? [];
    // A new guide is visible: turn guides back on if they were hidden.
    if (!get().guidesVisible) set({ guidesVisible: true });
    commitGuides(get, [...guides, { axis, pos: guidePos(pos) }]);
  },

  moveGuide(index, pos) {
    const s = get();
    const guides = s.history.present.guides ?? [];
    const g = guides[index];
    if (!g || s.guidesLocked || !Number.isFinite(pos)) return;
    const p = guidePos(pos);
    if (p === g.pos) return;
    commitGuides(get, guides.map((x, i) => (i === index ? { ...x, pos: p } : x)));
  },

  removeGuide(index) {
    const s = get();
    const guides = s.history.present.guides ?? [];
    if (!guides[index] || s.guidesLocked) return;
    commitGuides(get, guides.filter((_, i) => i !== index));
  },

  clearGuides() {
    if (!get().history.present.guides?.length) return;
    commitGuides(get, []);
  },
});
