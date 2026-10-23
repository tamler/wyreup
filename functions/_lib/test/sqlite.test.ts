import { expect, it, vi } from 'vitest';
import type * as ChildProcessModule from 'node:child_process';
import type * as FsPromisesModule from 'node:fs/promises';
import { createSqliteTestDb } from './sqlite';

const observed = vi.hoisted(() => ({
  pending: 0,
  spawned: 0,
  removals: [] as Array<{ pending: number; path: string }>,
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcessModule>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      const child = actual.spawn(...args);
      observed.spawned++;
      observed.pending++;
      let settled = false;
      const settle = () => {
        if (!settled) {
          settled = true;
          observed.pending--;
        }
      };
      child.once('close', settle);
      child.once('error', () => {
        if (child.pid === undefined) settle();
      });
      return child;
    },
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromisesModule>();
  return {
    ...actual,
    rm: (...args: Parameters<typeof actual.rm>) => {
      observed.removals.push({ pending: observed.pending, path: String(args[0]) });
      return actual.rm(...args);
    },
  };
});

it('drains real SQLite children before removal and rejects late SQL without spawning', async () => {
  const database = await createSqliteTestDb();
  const write = database.exec('CREATE TABLE lifecycle_check (value INTEGER);');
  const read = database.db.prepare('SELECT ? AS v').bind('x').first<{ v: string }>();
  const closing = database.close();
  await Promise.allSettled([write, read, closing]);
  console.warn('SQLite lifecycle observation', JSON.stringify(observed));

  expect(observed.removals.map(({ pending }) => pending)).toEqual([0]);
  await write;
  expect(await read).toEqual({ v: 'x' });
  await closing;
  expect(observed.pending).toBe(0);

  const spawned = observed.spawned;
  await expect(database.exec('SELECT 1;')).rejects.toThrow(
    'SQLite test database is closing or closed',
  );
  expect(observed.spawned).toBe(spawned);
  await database.close();
  expect(observed.removals.map(({ pending }) => pending)).toEqual([0]);
});
