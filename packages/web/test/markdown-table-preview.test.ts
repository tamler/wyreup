import { describe, expect, it } from 'vitest';
import {
  markdownCellLines,
  prepareMarkdownTablePreview,
} from '../src/components/runners/markdownTablePreview';

describe('shared-parser Markdown table presentation', () => {
  it('keeps raw quoted HTML and multiline cells for literal DOM presentation', () => {
    const source = 'name,note\nA,"a|b\\c\n<script>""x""</script>"\n';
    expect(prepareMarkdownTablePreview(source, { delimiter: 'comma', hasHeader: true })).toEqual({
      headers: ['name', 'note'],
      rows: [['A', 'a|b\\c\n<script>"x"</script>']],
    });
    expect(markdownCellLines('a\r\nb\rc\nd')).toEqual(['a', 'b', 'c', 'd']);
  });
  it('pads ragged data against the widest actual record and preserves duplicate headers', () => {
    expect(
      prepareMarkdownTablePreview('same,same\n1\n2,3,4\n', { delimiter: 'comma', hasHeader: true }),
    ).toEqual({
      headers: ['same', 'same', ''],
      rows: [
        ['1', '', ''],
        ['2', '3', '4'],
      ],
    });
  });
  it('header-off generates actual Column labels and retains every input row', () => {
    expect(
      prepareMarkdownTablePreview('a\tb\n1\t2\n', { delimiter: 'tab', hasHeader: false }),
    ).toEqual({
      headers: ['Column 1', 'Column 2'],
      rows: [
        ['a', 'b'],
        ['1', '2'],
      ],
    });
  });
  it('distinguishes final record terminator from a real extra blank record', () => {
    expect(
      prepareMarkdownTablePreview('a,b\n', { delimiter: 'comma', hasHeader: true }).rows,
    ).toEqual([]);
    expect(
      prepareMarkdownTablePreview('a,b\n\n', { delimiter: 'comma', hasHeader: true }).rows,
    ).toEqual([['', '']]);
  });
  it('surfaces actual shared parser malformed/ambiguous/inconsistent and budget failures', () => {
    expect(() =>
      prepareMarkdownTablePreview('a,b\n"unfinished', { delimiter: 'comma', hasHeader: true }),
    ).toThrow('CSV parse');
    expect(() =>
      prepareMarkdownTablePreview('a,b\tc\nd,e\tf\n', { delimiter: 'auto', hasHeader: true }),
    ).toThrow('ambiguous');
    expect(() =>
      prepareMarkdownTablePreview('a,b\n1\n', { delimiter: 'auto', hasHeader: true }),
    ).toThrow('inconsistent');
    expect(() =>
      prepareMarkdownTablePreview('a,b\n' + '1,2\n'.repeat(10000), {
        delimiter: 'comma',
        hasHeader: true,
      }),
    ).toThrow('row limit');
    expect(() =>
      prepareMarkdownTablePreview('x'.repeat(5 * 1024 * 1024 + 1), {
        delimiter: 'comma',
        hasHeader: true,
      }),
    ).toThrow('bytes');
    expect(() =>
      prepareMarkdownTablePreview('\uD800', { delimiter: 'comma', hasHeader: true }),
    ).toThrow('surrogate');
  });
});
