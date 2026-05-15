import { describe, it, expect } from 'vitest';
import { explainSql, sqlFormatExplain } from '../../../src/tools/sql-format-explain/index.js';

describe('sql-format-explain — metadata', () => {
  it('has id sql-format-explain', () => {
    expect(sqlFormatExplain.id).toBe('sql-format-explain');
  });
  it('is in the dev category', () => {
    expect(sqlFormatExplain.category).toBe('dev');
  });
  it('outputs application/json', () => {
    expect(sqlFormatExplain.output.mime).toBe('application/json');
  });
  it('declares free cost', () => {
    expect(sqlFormatExplain.cost).toBe('free');
  });
});

describe('explainSql — basic SELECT', () => {
  it('detects SELECT statement type', async () => {
    const r = await explainSql('select id, name from users');
    expect(r.statementType).toBe('SELECT');
  });

  it('formats the SQL output', async () => {
    const r = await explainSql('select id, name from users where id=1');
    expect(r.formatted).toMatch(/SELECT/);
    expect(r.formatted).toMatch(/FROM/);
    expect(r.formatted).toMatch(/WHERE/);
  });

  it('annotates SELECT, FROM, WHERE', async () => {
    const r = await explainSql('select id, name from users where active = true');
    const clauses = r.annotations.map((a) => a.clause);
    expect(clauses).toContain('SELECT');
    expect(clauses).toContain('FROM');
    expect(clauses).toContain('WHERE');
  });

  it('explains SELECT with column list', async () => {
    const r = await explainSql('select id, name from users');
    const sel = r.annotations.find((a) => a.clause === 'SELECT');
    expect(sel?.explanation).toMatch(/id, name/);
  });

  it('explains SELECT * as "every column"', async () => {
    const r = await explainSql('select * from users');
    const sel = r.annotations.find((a) => a.clause === 'SELECT');
    expect(sel?.explanation).toMatch(/every column/i);
  });
});

describe('explainSql — joins, aggregates, grouping', () => {
  it('detects an inner JOIN', async () => {
    const r = await explainSql('select u.id from users u join orders o on o.user_id = u.id');
    expect(r.annotations.some((a) => a.clause === 'JOIN')).toBe(true);
  });

  it('detects a LEFT JOIN', async () => {
    const r = await explainSql('select u.id from users u left join orders o on o.user_id = u.id');
    expect(r.annotations.some((a) => a.clause === 'LEFT JOIN')).toBe(true);
  });

  it('flags aggregate functions in SELECT', async () => {
    const r = await explainSql('select count(*), sum(amount) from orders');
    const sel = r.annotations.find((a) => a.clause === 'SELECT');
    expect(sel?.explanation).toMatch(/COUNT/);
    expect(sel?.explanation).toMatch(/SUM/);
  });

  it('annotates GROUP BY', async () => {
    const r = await explainSql('select user_id, count(*) from orders group by user_id');
    expect(r.annotations.some((a) => a.clause === 'GROUP BY')).toBe(true);
  });

  it('annotates HAVING', async () => {
    const r = await explainSql(
      'select user_id, count(*) c from orders group by user_id having count(*) > 5',
    );
    expect(r.annotations.some((a) => a.clause === 'HAVING')).toBe(true);
  });

  it('annotates ORDER BY and LIMIT', async () => {
    const r = await explainSql('select id from users order by created_at desc limit 10');
    expect(r.annotations.some((a) => a.clause === 'ORDER BY')).toBe(true);
    const limit = r.annotations.find((a) => a.clause === 'LIMIT');
    expect(limit?.explanation).toMatch(/10/);
  });
});

describe('explainSql — write statements', () => {
  it('detects INSERT', async () => {
    const r = await explainSql("insert into users (name) values ('alice')");
    expect(r.statementType).toBe('INSERT');
  });
  it('detects UPDATE', async () => {
    const r = await explainSql("update users set name='bob' where id=1");
    expect(r.statementType).toBe('UPDATE');
  });
  it('detects DELETE', async () => {
    const r = await explainSql('delete from users where id=1');
    expect(r.statementType).toBe('DELETE');
  });
  it('detects WITH (CTE)', async () => {
    const r = await explainSql('with active as (select * from users where active) select * from active');
    expect(r.statementType).toBe('WITH');
  });
});

describe('explainSql — summary', () => {
  it('builds a summary covering features used', async () => {
    const r = await explainSql(
      'select u.id, count(*) c from users u join orders o on o.user_id=u.id where u.active group by u.id order by c desc limit 5',
    );
    expect(r.summary).toMatch(/Read query/);
    expect(r.summary).toMatch(/joins/);
    expect(r.summary).toMatch(/grouping/);
    expect(r.summary).toMatch(/filtering/);
    expect(r.summary).toMatch(/sorting/);
    expect(r.summary).toMatch(/row limit/);
  });
});

describe('explainSql — errors', () => {
  it('throws on empty input', async () => {
    await expect(explainSql('')).rejects.toThrow();
    await expect(explainSql('   ')).rejects.toThrow();
  });
});
