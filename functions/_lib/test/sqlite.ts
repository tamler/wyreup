import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { D1Database, D1PreparedStatement, D1Result } from '../env';

function literal(value: unknown): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`;
  throw new Error('SQLite test binding must be a string, finite number, or null');
}

export async function createSqliteTestDb(): Promise<{
  db: D1Database;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'wyreup-sqlite-'));
  const filename = join(directory, 'test.sqlite');
  const pending = new Set<Promise<void>>();
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      await Promise.all(pending);
      await rm(directory, { recursive: true, force: true });
    })();
    return closing;
  };
  const execute = (sql: string): Promise<string> => {
    if (closing) return Promise.reject(new Error('SQLite test database is closing or closed'));
    return new Promise((resolve, reject) => {
      const child = spawn('sqlite3', ['-bail', '-json', filename], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const closed = new Promise<void>((resolveClose) => {
        child.once('close', () => resolveClose());
        child.once('error', () => {
          if (child.pid === undefined) resolveClose();
        });
      });
      pending.add(closed);
      void closed.then(() => {
        pending.delete(closed);
      });
      let output = '';
      let errors = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        output += chunk;
      });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        errors += chunk;
      });
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve(output) : reject(new Error(errors))));
      child.stdin.on('error', reject);
      child.stdin.end(`.timeout 10000\n.explain off\nPRAGMA foreign_keys=ON;\n${sql}\n`);
    });
  };

  class Statement implements D1PreparedStatement {
    constructor(
      readonly query: string,
      readonly values: unknown[] = [],
    ) {}
    bind(...values: unknown[]): Statement {
      return new Statement(this.query, values);
    }
    sql(): string {
      let index = 0;
      // Preserve quoted SQL strings/identifiers while replacing positional binds.
      const sql = this.query.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?/g, (token) =>
        token === '?' ? literal(this.values[index++]) : token,
      );
      if (index !== this.values.length) throw new Error('SQLite bind count mismatch');
      return sql;
    }
    async first<T>(): Promise<T | null> {
      return (await this.all<T>()).results?.[0] ?? null;
    }
    async all<T>(): Promise<D1Result<T>> {
      return (await runStatements<T>([this], false))[0];
    }
    async run<T>(): Promise<D1Result<T>> {
      return this.all<T>();
    }
  }
  async function runStatements<T>(
    statements: Statement[],
    transaction: boolean,
  ): Promise<D1Result<T>[]> {
    const script = statements
      .map(
        (statement, i) =>
          `.print result_${i}\n${statement.sql()};\n.print meta_${i}\nSELECT changes() AS changes;\n.print end_${i}`,
      )
      .join('\n');
    const output = await execute(
      `${transaction ? 'BEGIN IMMEDIATE;' : ''}\n${script}\n${transaction ? 'COMMIT;' : ''}`,
    );
    return statements.map((_, i) => {
      const rows = output.split(`result_${i}\n`)[1].split(`meta_${i}\n`)[0].trim();
      const metadata = output.split(`meta_${i}\n`)[1].split(`end_${i}\n`)[0].trim();
      return {
        success: true,
        results: rows ? (JSON.parse(rows) as T[]) : [],
        meta: (JSON.parse(metadata) as Array<{ changes: number }>)[0],
      };
    });
  }
  const db: D1Database = {
    prepare(query) {
      return new Statement(query);
    },
    async batch<T>(statements: D1PreparedStatement[]) {
      if (!statements.every((statement) => statement instanceof Statement))
        throw new Error('Foreign SQLite statement');
      return runStatements<T>(statements, true);
    },
  };
  try {
    const migrations = new URL('../../../migrations/', import.meta.url);
    for (const name of (await readdir(migrations)).filter((name) => name.endsWith('.sql')).sort()) {
      await execute(await readFile(new URL(name, migrations), 'utf8'));
    }
  } catch (error) {
    await close();
    throw error;
  }
  return {
    db,
    exec: async (sql) => {
      await execute(sql);
    },
    close,
  };
}
