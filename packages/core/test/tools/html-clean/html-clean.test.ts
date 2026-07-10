import { describe, expect, it } from 'vitest';
import { cleanHtml } from '../../../src/tools/html-clean/index.js';

describe('html-clean — sanitization', () => {
  it('strips script and style blocks whose closing tags have attributes', () => {
    const html =
      '<p>before</p><script>secret</script nonce="x"><style>hidden</style media="x"><p>after</p>';
    const result = cleanHtml(html, {});

    expect(result).toContain('before');
    expect(result).toContain('after');
    expect(result).not.toContain('secret');
    expect(result).not.toContain('hidden');
  });

  it('strips active-content blocks recombined by an earlier replacement', () => {
    const html = '<p>safe</p><scr<script>inner</script>ipt>secret</script>';
    expect(cleanHtml(html, {})).toBe('safe');
  });

  it('strips tags recombined by an earlier replacement', () => {
    const html = '<<span>span>text</span>';
    expect(cleanHtml(html, { preserveParagraphs: false })).toBe('text');
  });

  it('strips comments recombined by tag removal', () => {
    expect(cleanHtml('<!<span>--secret-->', {})).toBe('');
  });

  it('does not return deferred tags when the pass bound is exhausted', () => {
    let html = '<script>secret</script>';
    for (let depth = 0; depth < 26; depth += 1) {
      html = `<scr${html}ipt>secret</script>`;
    }

    expect(cleanHtml(html, {})).not.toMatch(/<[^>]*>/);
  });
});
