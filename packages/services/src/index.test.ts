import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createProject, createSceneObject } from '@savig/engine';
import {
  exportProject,
  importAudio,
  importSvg,
  loadSavig,
  saveSavig,
  type AssetBinaries,
} from './index';

function buildProject() {
  const { asset: svg } = importSvg(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
    'box.svg',
  );
  const { asset: audio, bytes } = importAudio('beat.mp3', new Uint8Array([1, 2, 3, 4]), 'audio/mpeg');

  const project = createProject({ name: 'Integration' });
  project.assets.push(svg, audio);
  project.objects.push(createSceneObject(svg.id, { id: 'o1' }));
  project.audioClips.push({ id: 'c1', assetId: audio.id, startTime: 0, inPoint: 0, outPoint: 1, volume: 1 });

  const binaries: AssetBinaries = { [audio.id]: bytes };
  return { project, binaries };
}

describe('services integration', () => {
  it('imports, exports, and unzips a runnable bundle', () => {
    const { project, binaries } = buildProject();
    const zip = unzipSync(exportProject(project, binaries));
    const html = strFromU8(zip['index.html']);
    expect(html).toContain('data-savig-object="o1"');
    expect(html).toContain('SavigRuntime.create');
    expect(strFromU8(zip['savig-runtime.js']).length).toBeGreaterThan(0);
  });

  it('round-trips a project through .savig', () => {
    const { project, binaries } = buildProject();
    const loaded = loadSavig(saveSavig({ project, binaries }));
    expect(loaded.project.meta.name).toBe('Integration');
    expect(loaded.project.objects).toHaveLength(1);
    expect(Object.keys(loaded.binaries)).toHaveLength(1);
  });
});
