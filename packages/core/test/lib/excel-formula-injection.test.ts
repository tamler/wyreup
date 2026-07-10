import { describe, it, expect } from 'vitest';
import {
  newWorkbook,
  addWorksheet,
  addAOAToSheet,
  addObjectsToSheet,
  sheetToAOA,
  sheetToCsv,
} from '../../src/lib/excel.js';

describe('excel formula injection — addAOAToSheet', () => {
  it('prefixes formula-leading string cells with an apostrophe', async () => {
    const wb = await newWorkbook();
    const ws = addWorksheet(wb, 'Sheet1');
    addAOAToSheet(ws, [['=1+1', '+1', '-1', '@SUM(A1)', "=cmd|'/c calc'!A0"]]);
    const rows = sheetToAOA(ws);
    expect(rows[0]![0]).toBe("'=1+1");
    expect(rows[0]![1]).toBe("'+1");
    expect(rows[0]![2]).toBe("'-1");
    expect(rows[0]![3]).toBe("'@SUM(A1)");
    expect(rows[0]![4]).toBe("'=cmd|'/c calc'!A0");
  });

  it('prefixes cells starting with TAB or CR', async () => {
    const wb = await newWorkbook();
    const ws = addWorksheet(wb, 'Sheet1');
    addAOAToSheet(ws, [['\t=evil', '\r=evil']]);
    const rows = sheetToAOA(ws);
    expect(rows[0]![0]).toBe("'\t=evil");
    expect(rows[0]![1]).toBe("'\r=evil");
  });

  it('leaves numbers, booleans, and safe strings untouched', async () => {
    const wb = await newWorkbook();
    const ws = addWorksheet(wb, 'Sheet1');
    addAOAToSheet(ws, [[42, true, 'hello', 'a=b']]);
    const rows = sheetToAOA(ws);
    expect(rows[0]![0]).toBe(42);
    expect(rows[0]![1]).toBe(true);
    expect(rows[0]![2]).toBe('hello');
    expect(rows[0]![3]).toBe('a=b'); // '=' not leading — untouched
  });
});

describe('excel formula injection — addObjectsToSheet', () => {
  it('defangs both header and value cells', async () => {
    const wb = await newWorkbook();
    const ws = addWorksheet(wb, 'Sheet1');
    addObjectsToSheet(ws, [{ '=header': '=1+1' }, { '=header': 42 }]);
    const rows = sheetToAOA(ws);
    expect(rows[0]![0]).toBe("'=header");
    expect(rows[1]![0]).toBe("'=1+1");
    expect(rows[2]![0]).toBe(42);
  });
});

describe('excel formula injection — sheetToCsv', () => {
  it('defangs formula-leading fields in CSV output', async () => {
    const wb = await newWorkbook();
    const ws = addWorksheet(wb, 'Sheet1');
    // add via raw addRow so the values are not pre-defanged by addAOAToSheet
    ws.addRow(['=1+1', 'safe']);
    const csv = sheetToCsv(ws);
    expect(csv.startsWith("'=1+1")).toBe(true);
    expect(csv).toContain('safe');
  });
});
