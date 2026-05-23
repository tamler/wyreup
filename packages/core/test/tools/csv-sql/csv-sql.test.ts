import { describe, it, expect } from 'vitest';
import { csvSql } from '../../../src/tools/csv-sql/index.js';
import { runQuery, tableNameFor } from '../../../src/tools/csv-sql/engine.js';

function makeCtx() {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map<string, unknown>(),
    executionId: 'test',
  };
}

const ENC = new TextEncoder();
const DEC = new TextDecoder();

function csvFile(name: string, body: string): File {
  return new File([body], name, { type: 'text/csv' });
}

describe('csv-sql — tool metadata', () => {
  it('is a free tool that takes 1+ inputs', () => {
    expect(csvSql.cost).toBe('free');
    expect(csvSql.input.min).toBe(1);
    expect(csvSql.input.max).toBeUndefined();
  });
});

describe('csv-sql — engine', () => {
  it('runs a SELECT over a single CSV', async () => {
    const bytes = ENC.encode('name,age\nAlice,30\nBob,25\n');
    const result = await runQuery(
      [{ name: 'people.csv', bytes, mime: 'text/csv' }],
      'SELECT name FROM people ORDER BY CAST(age AS INTEGER) DESC',
    );
    expect(result.columns).toEqual(['name']);
    expect(result.rows).toEqual([['Alice'], ['Bob']]);
  });

  it('JOINs two CSVs by their filename-derived table names', async () => {
    const customers = ENC.encode('id,name\n1,Alice\n2,Bob\n');
    const orders = ENC.encode('customer_id,amount\n1,50\n1,30\n2,100\n');
    const result = await runQuery(
      [
        { name: 'customers.csv', bytes: customers, mime: 'text/csv' },
        { name: 'orders.csv', bytes: orders, mime: 'text/csv' },
      ],
      `SELECT c.name, SUM(CAST(o.amount AS REAL)) AS total
       FROM customers c
       JOIN orders o ON o.customer_id = c.id
       GROUP BY c.name
       ORDER BY total DESC`,
    );
    expect(result.columns).toEqual(['name', 'total']);
    expect(result.rows).toEqual([
      ['Bob', 100],
      ['Alice', 80],
    ]);
  });

  it('reads JSON input as an array of objects', async () => {
    const json = ENC.encode(
      JSON.stringify([
        { city: 'Chicago', pop: 2_700_000 },
        { city: 'NYC', pop: 8_300_000 },
      ]),
    );
    const result = await runQuery(
      [{ name: 'cities.json', bytes: json, mime: 'application/json' }],
      'SELECT city FROM cities ORDER BY CAST(pop AS INTEGER) DESC LIMIT 1',
    );
    expect(result.rows).toEqual([['NYC']]);
  });

  it('throws on malformed SQL with a useful message', async () => {
    const bytes = ENC.encode('a\n1\n');
    await expect(
      runQuery(
        [{ name: 't.csv', bytes, mime: 'text/csv' }],
        'SELEKT * FROM t',
      ),
    ).rejects.toThrow(/syntax|near|SELEKT/i);
  });

  it('throws on missing query', async () => {
    const bytes = ENC.encode('a\n1\n');
    await expect(
      runQuery([{ name: 't.csv', bytes, mime: 'text/csv' }], '   '),
    ).rejects.toThrow(/sql query/i);
  });
});

describe('csv-sql — table-name derivation', () => {
  it('normalizes filenames to SQL identifiers', () => {
    expect(tableNameFor('customers.csv')).toBe('customers');
    expect(tableNameFor('Customer Orders (2025).xlsx')).toBe('customer_orders_2025');
    expect(tableNameFor('2024-data.csv')).toBe('t_2024_data');
    expect(tableNameFor('weird@name!.csv')).toBe('weird_name');
  });
});

async function runToCsvSqlBlobs(file: File, params: { query: string; outputFormat?: 'csv' | 'json' }): Promise<Blob[]> {
  const r = await csvSql.run([file], params, makeCtx());
  return Array.isArray(r) ? r : [r];
}

describe('csv-sql — tool.run() end-to-end', () => {
  it('emits CSV by default', async () => {
    const f = csvFile('items.csv', 'item,qty\napple,3\nbanana,5\n');
    const blobs = await runToCsvSqlBlobs(f, {
      query: 'SELECT item FROM items ORDER BY item',
      outputFormat: 'csv',
    });
    const out = blobs[0]!;
    expect(out.type).toBe('text/csv');
    const body = DEC.decode(new Uint8Array(await out.arrayBuffer()));
    expect(body).toBe('item\r\napple\r\nbanana');
  });

  it('emits JSON when outputFormat=json', async () => {
    const f = csvFile('items.csv', 'item,qty\napple,3\n');
    const blobs = await runToCsvSqlBlobs(f, {
      query: 'SELECT * FROM items',
      outputFormat: 'json',
    });
    const out = blobs[0]!;
    expect(out.type).toBe('application/json');
    const parsed = JSON.parse(DEC.decode(new Uint8Array(await out.arrayBuffer()))) as unknown;
    expect(parsed).toEqual([{ item: 'apple', qty: '3' }]);
  });
});
