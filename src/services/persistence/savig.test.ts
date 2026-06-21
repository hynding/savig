import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createProject, type Project } from '../../engine';
import { SavigLoadError } from '../errors';
import { loadSavig, saveSavig } from './savig';

function file(): { project: Project; binaries: Record<string, Uint8Array> } {
  const project = createProject({ name: 'Persisted' });
  project.assets.push({ id: 'b0b0b0b0', kind: 'audio', name: 'a.mp3', mimeType: 'audio/mpeg' });
  return { project, binaries: { b0b0b0b0: new Uint8Array([9, 8, 7]) } };
}

describe('savig persistence', () => {
  it('round-trips a project and its binaries', () => {
    const loaded = loadSavig(saveSavig(file()));
    expect(loaded.project.meta.name).toBe('Persisted');
    expect(loaded.binaries.b0b0b0b0).toEqual(new Uint8Array([9, 8, 7]));
  });

  it('preserves assets and clips', () => {
    const original = file();
    original.project.audioClips.push({ id: 'c1', assetId: 'b0b0b0b0', startTime: 1, inPoint: 0, outPoint: 2, volume: 0.5 });
    const loaded = loadSavig(saveSavig(original));
    expect(loaded.project.audioClips).toHaveLength(1);
    expect(loaded.project.audioClips[0].volume).toBe(0.5);
  });

  it('preserves a shape keyframe morph mode across save/load', () => {
    const f = file();
    f.project.objects.push({
      id: 'o1',
      name: 'morpher',
      assetId: 'b0b0b0b0',
      zOrder: 0,
      anchorX: 0,
      anchorY: 0,
      base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      tracks: {},
      shapeTrack: [
        { time: 0, path: { nodes: [{ anchor: { x: 0, y: 0 } }], closed: true }, easing: 'linear', morph: 'resampled' },
        { time: 1, path: { nodes: [{ anchor: { x: 5, y: 5 } }], closed: true }, easing: 'linear' },
      ],
    });
    const loaded = loadSavig(saveSavig(f));
    expect(loaded.project.objects[0].shapeTrack![0].morph).toBe('resampled');
    expect(loaded.project.objects[0].shapeTrack![1].morph).toBeUndefined();
  });

  it('throws SavigLoadError when project.json is missing', () => {
    const bogus = zipSync({ 'notes.txt': strToU8('hi') });
    expect(() => loadSavig(bogus)).toThrow(SavigLoadError);
  });
});
