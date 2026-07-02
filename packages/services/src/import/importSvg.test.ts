import { describe, expect, it } from 'vitest';
import { SvgImportError } from '../errors';
import { importSvg } from './importSvg';

describe('importSvg', () => {
  it('produces a content-addressed asset with namespaced ids', () => {
    const { asset } = importSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 20"><linearGradient id="g"/><rect fill="url(#g)"/></svg>',
      'logo.svg',
    );
    expect(asset.kind).toBe('svg');
    expect(asset.name).toBe('logo.svg');
    expect(asset.viewBox).toBe('0 0 10 20');
    expect(asset.id).toMatch(/^[0-9a-f]{8}$/);
    expect(asset.normalizedContent).toContain(`${asset.id}__g`);
    expect(asset.normalizedContent).toContain(`url(#${asset.id}__g)`);
  });

  it('dedupes identical content to the same id', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect/></svg>';
    expect(importSvg(svg, 'a.svg').asset.id).toBe(importSvg(svg, 'b.svg').asset.id);
  });

  it('derives width/height from viewBox when missing', () => {
    const { asset } = importSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 40"><rect/></svg>', 'x.svg');
    expect(asset.width).toBe(30);
    expect(asset.height).toBe(40);
  });

  it('synthesizes a viewBox from width/height when absent', () => {
    const { asset } = importSvg('<svg xmlns="http://www.w3.org/2000/svg" width="50" height="60"><rect/></svg>', 'x.svg');
    expect(asset.viewBox).toBe('0 0 50 60');
    expect(asset.width).toBe(50);
    expect(asset.height).toBe(60);
  });

  it('strips scripts during import', () => {
    const { asset } = importSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>x()</script><rect/></svg>', 'x.svg');
    expect(asset.normalizedContent).not.toContain('<script');
  });

  it('throws SvgImportError on malformed input', () => {
    expect(() => importSvg('not an svg at all <<<', 'bad.svg')).toThrow(SvgImportError);
  });

  it('throws SvgImportError when root element is not <svg>', () => {
    expect(() => importSvg('<html xmlns="http://www.w3.org/1999/xhtml"></html>', 'bad.svg')).toThrow(SvgImportError);
  });
});
