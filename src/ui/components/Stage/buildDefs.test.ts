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
