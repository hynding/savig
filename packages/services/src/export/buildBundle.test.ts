import { describe, expect, it } from 'vitest';
import { createProject, type Project, type SvgAsset } from '@savig/engine';
import { MissingAssetError } from '../errors';
import { buildExportBundle, type AssetBinaries } from './buildBundle';

function svgProject(): Project {
  const asset: SvgAsset = {
    id: 'aaaa1111',
    kind: 'svg',
    name: 'box.svg',
    normalizedContent: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect/></svg>',
    viewBox: '0 0 10 10',
    width: 10,
    height: 10,
  };
  const project = createProject({ name: 'Demo' });
  project.assets.push(asset);
  return project;
}

describe('buildExportBundle', () => {
  it('writes the runtime js verbatim', () => {
    const files = buildExportBundle(svgProject(), {}, 'console.log("rt");');
    expect(files['savig-runtime.js']).toBe('console.log("rt");');
  });

  it('references the runtime and embeds project JSON', () => {
    const files = buildExportBundle(svgProject(), {}, 'X');
    expect(files['index.html']).toContain('<script src="savig-runtime.js"></script>');
    expect(files['index.html']).toContain('id="savig-project"');
    expect(files['index.html']).toContain('"name":"Demo"');
  });

  it('embeds audio as base64 keyed by asset id', () => {
    const project = svgProject();
    project.assets.push({ id: 'b0b0b0b0', kind: 'audio', name: 'a.mp3', mimeType: 'audio/mpeg' });
    project.audioClips.push({ id: 'clip1', assetId: 'b0b0b0b0', startTime: 0, inPoint: 0, outPoint: 1, volume: 1 });
    const binaries: AssetBinaries = { b0b0b0b0: new Uint8Array([1, 2, 3]) };
    const files = buildExportBundle(project, binaries, 'X');
    expect(files['index.html']).toContain('id="savig-audio"');
    expect(files['index.html']).toContain('"b0b0b0b0":"AQID"'); // base64 of [1,2,3]
  });

  it('throws MissingAssetError when audio binary is absent', () => {
    const project = svgProject();
    project.assets.push({ id: 'b0b0b0b0', kind: 'audio', name: 'a.mp3', mimeType: 'audio/mpeg' });
    project.audioClips.push({ id: 'clip1', assetId: 'b0b0b0b0', startTime: 0, inPoint: 0, outPoint: 1, volume: 1 });
    expect(() => buildExportBundle(project, {}, 'X')).toThrow(MissingAssetError);
  });

  it('escapes "</script>" inside embedded JSON to prevent breakout', () => {
    const project = svgProject();
    project.meta.name = '</script><img src=x onerror=alert(1)>';
    const html = buildExportBundle(project, {}, 'X')['index.html'];
    expect(html).not.toContain('</script><img');
    expect(html).toContain('\\u003c/script>');
  });

  it('is byte-stable across calls (golden)', () => {
    const a = buildExportBundle(svgProject(), {}, 'X')['index.html'];
    const b = buildExportBundle(svgProject(), {}, 'X')['index.html'];
    expect(a).toBe(b);
  });
});
