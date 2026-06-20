import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createProject, type Project, type SvgAsset } from '../../engine';
import { RUNTIME_JS } from '../../runtime/runtimeSource.generated';
import { exportProject } from './exportProject';

function project(): Project {
  const asset: SvgAsset = {
    id: 'aaaa1111', kind: 'svg', name: 'box.svg',
    normalizedContent: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect/></svg>',
    viewBox: '0 0 10 10', width: 10, height: 10,
  };
  const p = createProject({ name: 'Demo' });
  p.assets.push(asset);
  return p;
}

describe('exportProject', () => {
  it('produces a zip with index.html and the real runtime', () => {
    const zip = unzipSync(exportProject(project(), {}));
    expect(strFromU8(zip['index.html'])).toContain('SavigRuntime.create');
    expect(strFromU8(zip['savig-runtime.js'])).toBe(RUNTIME_JS);
  });

  it('bundled runtime exposes the SavigRuntime global', () => {
    expect(RUNTIME_JS).toContain('SavigRuntime');
    expect(RUNTIME_JS.length).toBeGreaterThan(0);
  });
});
