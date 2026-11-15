import { describe, expect, test } from 'vitest';
import { createProject, createSceneObject, type ImageAsset } from '@savig/engine';
import { migrateProject } from './migrate';
import { imageDataUrlMime, isSafeImageDataUrl, sanitizeImages } from './sanitizeImages';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const img = (extra: Partial<ImageAsset> = {}): ImageAsset => ({
  id: 'img', kind: 'image', name: 'Photo', mimeType: 'image/png', dataUrl: PNG, width: 40, height: 20, ...extra,
});

describe('isSafeImageDataUrl', () => {
  test('accepts base64 png/jpeg/gif/webp data URLs only', () => {
    expect(isSafeImageDataUrl(PNG)).toBe(true);
    expect(isSafeImageDataUrl('data:image/jpeg;base64,/9j/4AAQ')).toBe(true);
    expect(isSafeImageDataUrl('data:image/webp;base64,UklGRg==')).toBe(true);
    expect(isSafeImageDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(isSafeImageDataUrl('https://example.com/a.png')).toBe(false);
    expect(isSafeImageDataUrl('data:image/png;base64,AA"/><script>')).toBe(false);
    expect(isSafeImageDataUrl('data:image/png,rawtext')).toBe(false);
    expect(isSafeImageDataUrl(42)).toBe(false);
    expect(imageDataUrlMime('data:image/gif;base64,R0lG')).toBe('image/gif');
  });
});

describe('sanitizeImages', () => {
  test('a clean project is returned reference-equal', () => {
    const p = createProject();
    p.assets.push(img());
    p.objects.push({ ...createSceneObject('img', { id: 'o' }), guide: true });
    expect(sanitizeImages(p)).toBe(p);
  });

  test('repairs an unsafe URL, a mismatched mime type and a bad size without dropping the asset', () => {
    const p = createProject();
    p.assets.push(
      img({ id: 'a', dataUrl: 'javascript:alert(1)' }),
      img({ id: 'b', mimeType: 'image/png', dataUrl: 'data:image/jpeg;base64,/9j/' }),
      img({ id: 'c', width: -3, height: Number.NaN }),
    );
    const out = sanitizeImages(p).assets as ImageAsset[];
    expect(out[0].dataUrl).toBe('');
    expect(out[1].mimeType).toBe('image/jpeg');
    expect(out[2]).toMatchObject({ width: 1, height: 1 });
  });

  test('drops a non-true guide flag and keeps guide: true', () => {
    const p = createProject();
    p.objects.push({ ...createSceneObject('a', { id: 'g' }), guide: true }, { ...createSceneObject('a', { id: 'x' }), guide: 'yes' as never });
    const out = sanitizeImages(p);
    expect(out.objects[0].guide).toBe(true);
    expect('guide' in out.objects[1]).toBe(false);
  });

  test('runs on load via migrateProject', () => {
    const p = createProject();
    p.meta.version = 11;
    p.assets.push(img({ dataUrl: 'https://tracker.example/pixel.png' }));
    const m = migrateProject(p);
    expect(m.meta.version).toBe(12);
    expect((m.assets[0] as ImageAsset).dataUrl).toBe('');
  });
});
