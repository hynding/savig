import { describe, expect, it } from 'vitest';
import { strToU8 } from 'fflate';
import { createProject, createSceneObject, createVectorAsset } from '@savig/engine';
import type { Project } from '@savig/engine';
import { renderAnimatedSvgDocument } from '../export/animatedSvg';
import { SavigLoadError, UnsupportedVersionError } from '../errors';
import { saveSavig } from './savig';
import { loadProjectOrSvg } from './openFile';

/** A 1s project with one rect whose x animates 0 -> 100 — same shape as
 *  export/animatedSvg.test.ts's movingRectProject, so renderAnimatedSvgDocument actually
 *  samples (duration > 0) and emits SMIL, not a static frame. */
function movingRectProject(): Project {
  const p = createProject({ name: 'anim-test' });
  p.meta.fps = 10;
  p.meta.duration = 1;
  p.meta.durationMode = 'manual';
  p.meta.loop = false;
  p.assets.push(
    createVectorAsset('rect', { id: 'a1', style: { fill: '#ff0000', stroke: 'none', strokeWidth: 1 } }),
  );
  p.objects.push(
    createSceneObject('a1', {
      id: 'o1',
      zOrder: 0,
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      shapeBase: { width: 20, height: 20 },
      tracks: { x: [{ time: 0, value: 0, easing: 'linear' }, { time: 1, value: 100, easing: 'linear' }] },
    }),
  );
  return p;
}

describe('loadProjectOrSvg', () => {
  it('opens a .savig zip (PK sniff) exactly like loadSavig', () => {
    const project = createProject({ name: 'Zip' });
    const opened = loadProjectOrSvg(saveSavig({ project, binaries: {} }));
    expect(opened.kind).toBe('project');
    if (opened.kind === 'project') expect(opened.file.project).toEqual(project);
  });

  it('opens an exported animated SVG back into the identical project', () => {
    const project = movingRectProject();
    const bytes = strToU8(renderAnimatedSvgDocument(project));
    const opened = loadProjectOrSvg(bytes);
    expect(opened.kind).toBe('project');
    if (opened.kind === 'project')
      expect(opened.file.project).toEqual(JSON.parse(JSON.stringify(project)));
  });

  it('restores embedded audio binaries byte-identically', () => {
    const project = createProject({ name: 'Aud' });
    project.assets.push({ id: 'a1', kind: 'audio', name: 'a.mp3', mimeType: 'audio/mpeg' });
    project.audioClips = [{ id: 'c1', assetId: 'a1', startTime: 0, inPoint: 0, outPoint: 1, volume: 1 }];
    const bytes = strToU8(renderAnimatedSvgDocument(project, undefined, { a1: new Uint8Array([7, 8, 9]) }));
    const opened = loadProjectOrSvg(bytes);
    if (opened.kind === 'project') expect(Array.from(opened.file.binaries.a1)).toEqual([7, 8, 9]);
  });

  it('classifies a valid SVG without savig metadata as plain-svg with the source text', () => {
    const src = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5"/></svg>';
    expect(loadProjectOrSvg(strToU8(src))).toEqual({ kind: 'plain-svg', source: src });
  });

  it('rejects bytes that are neither zip nor SVG', () => {
    expect(() => loadProjectOrSvg(strToU8('hello'))).toThrow(SavigLoadError);
  });

  it('rejects corrupt embedded JSON', () => {
    const src = '<svg xmlns="http://www.w3.org/2000/svg"><metadata data-savig-source="project">{nope</metadata></svg>';
    expect(() => loadProjectOrSvg(strToU8(src))).toThrow(SavigLoadError);
  });

  it('rejects an embedded payload whose "audio" field is not a plain object', () => {
    const project = createProject({ name: 'BadAudio' });
    const markup = renderAnimatedSvgDocument(project).replace(
      /"audio":\{\}/,
      '"audio":"not-an-object"',
    );
    expect(() => loadProjectOrSvg(strToU8(markup))).toThrow(SavigLoadError);
    expect(() => loadProjectOrSvg(strToU8(markup))).toThrow('Embedded Savig project data is corrupt.');
  });

  it('rejects an embedded payload whose "audio" entries are not valid base64', () => {
    const project = createProject({ name: 'BadAudio2' });
    const markup = renderAnimatedSvgDocument(project).replace(
      /"audio":\{\}/,
      '"audio":{"a1":"not valid base64!!"}',
    );
    expect(() => loadProjectOrSvg(strToU8(markup))).toThrow(SavigLoadError);
  });

  it('gates embedded projects on version like .savig (newer version rejected)', () => {
    const project = createProject({ name: 'Future' });
    project.meta.version = 99;
    const bytes = strToU8(renderAnimatedSvgDocument(project));
    expect(() => loadProjectOrSvg(bytes)).toThrow(UnsupportedVersionError);
  });
});
