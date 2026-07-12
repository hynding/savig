import { buildDefs } from './buildDefs';
import type { SvgAsset } from '@savig/engine';

const asset: SvgAsset = {
  id: 'abc', kind: 'svg', name: 'box',
  normalizedContent: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
  viewBox: '0 0 10 10', width: 10, height: 10,
};

it('wraps each used asset in an identified symbol svg', () => {
  const out = buildDefs([asset], ['abc']);
  expect(out).toContain('id="savig-asset-abc"');
  expect(out).toMatch(/<rect[^>]*width="10"[^>]*height="10"/);
  expect(out).toContain('overflow="visible"');
});

it('ignores asset ids not in the used set', () => {
  expect(buildDefs([asset], [])).toBe('');
});

it('re-sanitizes stored content (strips <script> before inlining)', () => {
  const malicious: SvgAsset = {
    ...asset,
    id: 'evil',
    normalizedContent:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><rect width="10" height="10"/></svg>',
  };
  const out = buildDefs([malicious], ['evil']);
  expect(out).not.toContain('<script');
  expect(out).toContain('<rect');
});

// ─── hostile id/viewBox escaping (security, Task 1c) ─────────────────────────
describe('buildDefs — hostile asset id/viewBox escaping (security)', () => {
  const hostileId = '"><image href=x onerror=alert(1)>';
  const escapedHostileId = '&quot;&gt;&lt;image href=x onerror=alert(1)&gt;';
  const hostileViewBox = '0 0 1 1"><image href=x onerror=alert(1)>';
  const escapedHostileViewBox = '0 0 1 1&quot;&gt;&lt;image href=x onerror=alert(1)&gt;';

  it('escapes a hostile asset id so it cannot break out of the id attribute', () => {
    const malicious: SvgAsset = { ...asset, id: hostileId };
    const out = buildDefs([malicious], [hostileId]);
    expect(out).not.toContain('<image');
    expect(out).toContain(`id="savig-asset-${escapedHostileId}"`);
  });

  it('escapes a hostile asset viewBox so it cannot break out of the viewBox attribute', () => {
    const malicious: SvgAsset = { ...asset, id: 'vb-evil', viewBox: hostileViewBox };
    const out = buildDefs([malicious], ['vb-evil']);
    expect(out).not.toContain('<image');
    expect(out).toContain(`viewBox="${escapedHostileViewBox}"`);
  });

  it('leaves a benign id and viewBox byte-identical — escapeAttr is a no-op on [a-z0-9-/. ] (parity)', () => {
    const out = buildDefs([asset], ['abc']);
    expect(out).toContain('id="savig-asset-abc"');
    expect(out).toContain('viewBox="0 0 10 10"');
    expect(out).not.toContain('&quot;');
    expect(out).not.toContain('&amp;');
    expect(out).not.toContain('&lt;');
    expect(out).not.toContain('&gt;');
  });
});
