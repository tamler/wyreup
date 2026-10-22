import { describe, expect, it } from 'vitest';
import { editCsvCell, exportCsv, parseCsv, selectCsvRows } from '../../src/utilities/csv-data.js';

const bytes = (text: string) => new TextEncoder().encode(text);
const parse = (text: string, hasHeader = true) =>
  parseCsv(bytes(text), { delimiter: 'comma', hasHeader });

describe('CSV data and single export serializer', () => {
  it('preserves quoted newlines, BOM, duplicate/blank headers, numeric strings and quotes', () => {
    const table = parse('\uFEFFname,name,\r\n"A,B","line1\nline2",03\r\n"a""b",,\r\n');
    expect(table.columns).toEqual([
      { id: 'c0', label: 'name' },
      { id: 'c1', label: 'name' },
      { id: 'c2', label: '' },
    ]);
    expect(table.rows.map((row) => row.cells)).toEqual([
      ['A,B', 'line1\nline2', '03'],
      ['a"b', '', ''],
    ]);
    expect(exportCsv(table)).toBe('name,name,\r\n"A,B","line1\nline2",03\r\n"a""b",,\r\n');
  });

  it('pads ragged rows without losing extra values and identifies source rows', () => {
    const table = parse('a,b\n1\n2,3,4');
    expect(table.columns.map((column) => column.label)).toEqual(['a', 'b', '']);
    expect(table.rows.map((row) => [row.sourceRow, row.cells])).toEqual([
      [2, ['1', '', '']],
      [3, ['2', '3', '4']],
    ]);
    expect(table.warnings).toEqual([
      { sourceRow: 2, width: 1 },
      { sourceRow: 3, width: 3 },
    ]);
  });

  it('keeps real blank records while removing only the final terminator placeholder', () => {
    expect(parse('a\n\n').rows.map((row) => row.cells)).toEqual([['']]);
    expect(parse('a\n""\n').rows.map((row) => row.cells)).toEqual([['']]);
    expect(parseCsv(bytes(''), { delimiter: 'auto', hasHeader: true }).rows).toEqual([]);
    expect(exportCsv(parse(''))).toBe('');
  });

  it('uses explicit delimiters or requires one unambiguous consistent auto candidate', () => {
    expect(parseCsv(bytes('a\tb\n1\t2'), { delimiter: 'auto', hasHeader: true }).delimiter).toBe(
      '\t',
    );
    expect(() =>
      parseCsv(bytes('a,b\tc,d\n1,2\t3,4'), { delimiter: 'auto', hasHeader: true }),
    ).toThrow(/delimiter/i);
    expect(() => parseCsv(bytes('one\ntwo'), { delimiter: 'auto', hasHeader: true })).toThrow(
      /delimiter/i,
    );
    expect(
      parseCsv(bytes('a|b\n1|2'), { delimiter: 'pipe', hasHeader: false }).rows[0]?.cells,
    ).toEqual(['a', 'b']);
  });

  it('rejects malformed quotes, non-UTF8, unknown options, column and row budgets', () => {
    expect(() => parse('a,b\n"unfinished,2')).toThrow(/quote|parse/i);
    expect(() => parseCsv(new Uint8Array([0xc3]), { delimiter: 'comma', hasHeader: true })).toThrow(
      /UTF/i,
    );
    expect(() =>
      parseCsv(bytes('x'), { delimiter: 'comma', hasHeader: true, extra: true } as never),
    ).toThrow(/unknown/i);
    expect(() => parse(new Array(201).fill('x').join(','))).toThrow(/column/i);
    expect(() => parse(`a\n${'x\n'.repeat(100001)}`)).toThrow(/row/i);
  });

  it('enforces the one-MiB cell limit and fails an already cancelled parse', () => {
    expect(() => parse(`a\n${'x'.repeat(1048577)}`)).toThrow(/cell/i);
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      parseCsv(bytes('a\n1'), { delimiter: 'comma', hasHeader: true }, controller.signal),
    ).toThrow(/cancel/i);
  });

  it('searches all rows, including rows beyond the first rendering page', () => {
    const table = parse(
      `name,number\n${Array.from({ length: 110 }, (_, i) => `row${i},${i}`).join('\n')}`,
    );
    expect(selectCsvRows(table, { search: 'row105' }).map((row) => row.sourceRow)).toEqual([107]);
    expect(selectCsvRows(table, { filters: { c1: '109' } }).map((row) => row.cells)).toEqual([
      ['row109', '109'],
    ]);
  });

  it('sorts whole numeric strings with stable ties and invalid/blank values last in both directions', () => {
    const table = parse('n,label\n10,a\n2,b\n2,c\n,d\nno,e\n2junk,f');
    expect(
      selectCsvRows(table, { sort: { column: 'c0', direction: 'asc', numeric: true } }).map(
        (row) => row.cells[1],
      ),
    ).toEqual(['b', 'c', 'a', 'd', 'e', 'f']);
    expect(
      selectCsvRows(table, { sort: { column: 'c0', direction: 'desc', numeric: true } }).map(
        (row) => row.cells[1],
      ),
    ).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('edits immutably and exports the chosen complete edited table through the same serializer', () => {
    const table = parse('name,n\na,1\nb,2');
    const id = table.rows[1]?.id;
    if (!id) throw new Error('Fixture missing row');
    const edited = editCsvCell(table, id, 'c0', '<img src=x onerror=alert(1)>');
    expect(table.rows[1]?.cells[0]).toBe('b');
    expect(parse(exportCsv(edited)).rows[1]?.cells[0]).toBe('<img src=x onerror=alert(1)>');
    expect(() => editCsvCell(table, 'forged', 'c0', 'x')).toThrow(/row/i);
  });

  it('preserves raw strings and makes spreadsheet-safe transformation explicit', () => {
    const table = parse('value\n=1+2\n -10\n@SUM(A1)\n"\tword"');
    expect(parse(exportCsv(table)).rows.map((row) => row.cells[0])).toEqual([
      '=1+2',
      ' -10',
      '@SUM(A1)',
      '\tword',
    ]);
    expect(
      parse(exportCsv(table, { spreadsheetSafe: true })).rows.map((row) => row.cells[0]),
    ).toEqual(["'=1+2", "' -10", "'@SUM(A1)", "'\tword"]);
    expect(exportCsv(table, { rows: selectCsvRows(table, { search: '@SUM' }) })).toBe(
      'value\r\n@SUM(A1)\r\n',
    );
  });

  it('accepts a maximum row count with terminator and rejects forged table/options without partial export', () => {
    const table = parse(`a\n${'x\n'.repeat(100000)}`);
    expect(table.rows).toHaveLength(100000);
    expect(() =>
      exportCsv({
        ...table,
        rows: [{ id: 'r1', sourceRow: 2, originalWidth: 1, cells: [false] }],
      } as never),
    ).toThrow(/cell|string/i);
    expect(() => exportCsv(table, { spreadsheetSafe: 'yes' } as never)).toThrow(/boolean|safe/i);
  });
});
