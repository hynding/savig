// Bitmap import slice 1 (spec 2026-11-15-bitmap-import): image assets share the svg-asset
// <use> + def path in every export; guide objects reach the editor painter but no export.
import { describe, expect, it } from 'vitest';
import {
  createGroupObject,
  createKeyframe,
  createProject,
  createSceneObject,
  createVectorAsset,
  flattenInstances,
  type ImageAsset,
  type Project,
} from '@savig/engine';
import { computeFrame } from '@savig/runtime/frame';
import { renderProjectDocument, renderSvgDocument } from './renderDocument';
import { renderAnimatedSvgDocument } from './animatedSvg';
import { renderCssSvgDocument } from './cssSvg';

const RED_2X2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==';

const image = (extra: Partial<ImageAsset> = {}): ImageAsset => ({
  id: 'img', kind: 'image', name: 'Red', mimeType: 'image/png', dataUrl: RED_2X2, width: 40, height: 20, ...extra,
});

function fixture(): Project {
  const p = createProject({ fps: 10, width: 100, height: 100 });
  p.assets.push(image(), createVectorAsset('rect', { id: 'va' }));
  p.objects.push(
    createSceneObject('img', { id: 'photo', zOrder: 0, anchorX: 20, anchorY: 10, tracks: { x: [createKeyframe(0, 0), createKeyframe(1, 50)] } }),
    createSceneObject('va', { id: 'r', zOrder: 1, shapeBase: { width: 10, height: 10 } }),
  );
  return p;
}

const parse = (markup: string) => new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;

describe('image assets in the export', () => {
  it('emits one asset def with an <image> and a <use> leaf per object', () => {
    const p = fixture();
    p.objects.push(createSceneObject('img', { id: 'photo2', zOrder: 2 }));
    const svg = parse(renderSvgDocument(p));
    const defs = svg.querySelectorAll('svg#savig-asset-img');
    expect(defs).toHaveLength(1);
    const img = defs[0].querySelector('image')!;
    expect(img.getAttribute('href')).toBe(RED_2X2);
    expect(img.getAttribute('width')).toBe('40');
    expect(img.getAttribute('preserveAspectRatio')).toBe('none');
    const uses = svg.querySelectorAll('use[data-savig-object]');
    expect(Array.from(uses).map((u) => u.getAttribute('data-savig-object'))).toEqual(['photo', 'photo2']);
    expect(uses[0].getAttribute('href')).toBe('#savig-asset-img');
  });

  it('an unsafe data URL renders an empty box instead of reaching the markup', () => {
    const p = fixture();
    (p.assets[0] as ImageAsset).dataUrl = 'javascript:alert(1)';
    const out = renderSvgDocument(p);
    expect(out).not.toContain('javascript:');
    expect(parse(out).querySelector('svg#savig-asset-img image')).toBeNull();
  });

  it('the runtime animates an image leaf like any other object', () => {
    const items = computeFrame(fixture(), 0.5);
    expect(items.find((i) => i.objectId === 'photo')?.transform).toContain('translate(25');
  });

  it('SMIL and CSS exports animate the image <use>', () => {
    const p = fixture();
    expect(renderAnimatedSvgDocument(p)).toContain('#savig-asset-img');
    expect(renderCssSvgDocument(p)).toContain('#savig-asset-img');
  });
});

describe('guide objects', () => {
  function withGuides(): Project {
    const p = fixture();
    p.objects[0].guide = true; // the photo is a tracing reference
    p.objects.push(
      { ...createGroupObject({ id: 'G', zOrder: 3, anchorX: 0, anchorY: 0 }), guide: true },
      createSceneObject('va', { id: 'inG', parentId: 'G', zOrder: 0, shapeBase: { width: 5, height: 5 } }),
    );
    return p;
  }

  it('flattenInstances drops guides (and guide-group subtrees) unless asked for them', () => {
    const p = withGuides();
    expect(flattenInstances(p, 0).map((l) => l.renderId)).toEqual(['r']);
    expect(flattenInstances(p, 0, { guides: true }).map((l) => l.renderId).sort()).toEqual(['inG', 'photo', 'r']);
  });

  it('the shared painter still reaches guide nodes (the editor draws them)', () => {
    const ids = computeFrame(withGuides(), 0).map((i) => i.objectId);
    expect(ids).toEqual(expect.arrayContaining(['photo', 'inG', 'r']));
  });

  it('no export draws a guide, but the embedded project keeps it for round trips', () => {
    const p = withGuides();
    for (const out of [renderSvgDocument(p), renderProjectDocument(p), renderAnimatedSvgDocument(p), renderCssSvgDocument(p)]) {
      const doc = parse(out);
      expect(doc.querySelector('[data-savig-object="photo"]')).toBeNull();
      expect(doc.querySelector('[data-savig-object="inG"]')).toBeNull();
      expect(doc.querySelector('[data-savig-object="r"]')).not.toBeNull();
      expect(doc.querySelector('svg#savig-asset-img')).toBeNull(); // no orphaned def either
    }
    const meta = parse(renderAnimatedSvgDocument(p)).querySelector('metadata[data-savig-source="project"]')!;
    expect(JSON.parse(meta.textContent!).project.objects.find((o: { id: string }) => o.id === 'photo').guide).toBe(true);
  });

  it('a guide never masks: the masked object renders unmasked', () => {
    const p = fixture();
    p.objects.push(createSceneObject('va', { id: 'm', zOrder: 5, isMask: true, guide: true, shapeBase: { width: 10, height: 10 } }));
    p.objects[1].maskedBy = 'm';
    const doc = parse(renderSvgDocument(p));
    expect(doc.querySelector('mask')).toBeNull();
    expect(doc.querySelector('[data-savig-object="r"]')).not.toBeNull();
  });
});
