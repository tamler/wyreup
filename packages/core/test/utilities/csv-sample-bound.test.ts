import { describe, expect, it } from 'vitest';
import { exportCsv, parseCsv, type CsvTable } from '../../src/utilities/csv-data.js';

const encoder = new TextEncoder();
const auto = (source: string) =>
  parseCsv(encoder.encode(source), { delimiter: 'auto', hasHeader: false });
const cells = (table: CsvTable) => table.rows.map((row) => row.cells);
const reopen = (table: CsvTable) =>
  parseCsv(encoder.encode(exportCsv(table)), { delimiter: 'comma', hasHeader: false });

describe('CSV first nonempty 65,536 UTF-8 byte sample', () => {
  it('detects comma after a complete 20,000-character quoted field within the byte sample', () => {
    const value = 'x'.repeat(20000);
    const source = `"${value}",b\n1,2\n`;
    expect(encoder.encode(source).length).toBe(20009);
    const table = auto(source);
    expect(table.delimiter).toBe(',');
    expect(cells(table)).toEqual([
      [value, 'b'],
      ['1', '2'],
    ]);
    expect(cells(reopen(table))).toEqual(cells(table));
  });

  it('starts sampling after 20,000 blank physical lines but preserves every actual blank record', () => {
    const source = `${'\n'.repeat(20000)}a,b\n1,2\n`;
    expect(encoder.encode(source).length).toBe(20008);
    const table = auto(source);
    expect(table.delimiter).toBe(',');
    expect(table.rows).toHaveLength(20002);
    expect(
      table.rows
        .slice(0, 20000)
        .every((row) => row.cells.length === 2 && row.cells.every((value) => value === '')),
    ).toBe(true);
    expect(table.rows[0]?.sourceRow).toBe(1);
    expect(table.rows[19999]?.sourceRow).toBe(20000);
    expect(table.rows.slice(-2).map((row) => [row.sourceRow, row.cells])).toEqual([
      [20001, ['a', 'b']],
      [20002, ['1', '2']],
    ]);
    expect(cells(reopen(table))).toEqual(cells(table));
  });

  it('measures the sample in UTF-8 bytes and keeps all 17,000 Han characters', () => {
    const value = '漢'.repeat(17000);
    const source = `"${value}",b\n1,2\n`;
    expect(encoder.encode(source).length).toBe(51009);
    const table = auto(source);
    expect(table.delimiter).toBe(',');
    expect(cells(table)).toEqual([
      [value, 'b'],
      ['1', '2'],
    ]);
    expect(cells(reopen(table))).toEqual(cells(table));
  });

  it('accepts a complete nonempty record ending at exactly byte 65,536 and parses later rows fully', () => {
    const value = `${'漢'.repeat(21843)}xx`;
    const firstRecord = `"${value}",b\n`;
    expect(encoder.encode(firstRecord).length).toBe(65536);
    const source = `${firstRecord}1,2\n`;
    expect(encoder.encode(source).length).toBe(65540);
    const table = auto(source);
    expect(table.delimiter).toBe(',');
    expect(cells(table)).toEqual([
      [value, 'b'],
      ['1', '2'],
    ]);
    expect(cells(reopen(table))).toEqual(cells(table));
  });

  it('requires an explicit delimiter when the byte cap cuts a quoted field inside a UTF-8 code point', () => {
    const value = `x${'漢'.repeat(21845)}`;
    const source = `"${value}",b\n1,2\n`;
    expect(encoder.encode(source).length).toBe(65545);
    // Byte 65,536 falls inside the last Han code point; source itself is valid UTF-8.
    expect(() => auto(source)).toThrow(/Choose an explicit CSV delimiter/);
    const explicit = parseCsv(encoder.encode(source), { delimiter: 'comma', hasHeader: false });
    expect(cells(explicit)).toEqual([
      [value, 'b'],
      ['1', '2'],
    ]);
    expect(cells(reopen(explicit))).toEqual(cells(explicit));
  });

  it('rejects a genuinely ambiguous sample rather than selecting one of two eligible delimiters', () => {
    expect(() => auto('a,b;c\n1,2;3\n')).toThrow(/Choose an explicit CSV delimiter/);
  });

  it('retains leading blank records and quoted embedded newlines while locating the sample', () => {
    const table = auto('\r\n\r\n"a\nb",c\r\n1,2\r\n');
    expect(table.delimiter).toBe(',');
    expect(cells(table)).toEqual([
      ['', ''],
      ['', ''],
      ['a\nb', 'c'],
      ['1', '2'],
    ]);
    expect(table.rows.map((row) => row.sourceRow)).toEqual([1, 2, 3, 4]);
    expect(cells(reopen(table))).toEqual(cells(table));
  });
});
