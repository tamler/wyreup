import { describe, expect, it } from 'vitest';
import { extractLinks } from '../../../src/tools/html-extract-links/index.js';

describe('html-extract-links — entity decoding', () => {
  it('does not decode entities exposed by decoding ampersands', () => {
    const result = extractLinks('<a href="&amp;lt;">link</a>', {});
    expect(result.links[0]?.url).toBe('&lt;');
  });
});
