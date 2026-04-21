import { describe, it, expect } from 'vitest';
import { sqlFormatter } from '../../../src/tools/sql-formatter/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import type { SqlFormatterParams } from '../../../src/tools/sql-formatter/index.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

async function run(text: string, params: SqlFormatterParams = {}): Promise<string> {
  const file = new File([text], 'query.sql', { type: 'text/plain' });
  const [out] = await sqlFormatter.run([file], params, makeCtx()) as Blob[];
  return out!.text();
}

describe('sql-formatter — metadata', () => {
  it('has id sql-formatter', () => {
    expect(sqlFormatter.id).toBe('sql-formatter');
  });

  it('is in the dev category', () => {
    expect(sqlFormatter.category).toBe('dev');
  });

  it('outputs text/plain', () => {
    expect(sqlFormatter.output.mime).toBe('text/plain');
  });
});

describe('sql-formatter — run()', () => {
  it('formats a basic SELECT query with uppercase keywords', async () => {
    const result = await run('select id,name from users where id=1');
    expect(result).toContain('SELECT');
    expect(result).toContain('FROM');
    expect(result).toContain('WHERE');
  });

  it('lowercases keywords when keywordCase=lower', async () => {
    const result = await run('SELECT id FROM users', { keywordCase: 'lower' });
    expect(result).toContain('select');
    expect(result).toContain('from');
  });

  it('formats with postgresql dialect', async () => {
    const result = await run('select id from users limit 10', { language: 'postgresql' });
    expect(result).toContain('id');
  });

  it('formats with mysql dialect', async () => {
    const result = await run('select id from users', { language: 'mysql' });
    expect(result).toContain('id');
  });

  it('indents with tabWidth', async () => {
    const result = await run('select id,name from users', { indent: 4 });
    expect(result).toContain('id');
  });

  it('handles multi-statement SQL', async () => {
    const result = await run('select 1; select 2;');
    expect(result).toContain('SELECT');
  });
});
