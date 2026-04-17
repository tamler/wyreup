import { describe, it, expect } from 'vitest';
import { textDiff } from '../../../src/tools/text-diff/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import type { TextDiffStats } from '../../../src/tools/text-diff/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('text-diff — metadata', () => {
  it('has id text-diff', () => {
    expect(textDiff.id).toBe('text-diff');
  });

  it('is in the inspect category', () => {
    expect(textDiff.category).toBe('inspect');
  });

  it('accepts two text/plain files (min 2, max 2)', () => {
    expect(textDiff.input.min).toBe(2);
    expect(textDiff.input.max).toBe(2);
  });

  it('has multiple output', () => {
    expect(textDiff.output.multiple).toBe(true);
  });
});

describe('text-diff — run()', () => {
  it('identical files produce minimal diff (no +/- lines)', async () => {
    const text = 'line one\nline two\nline three\n';
    const f1 = new File([text], 'file1.txt', { type: 'text/plain' });
    const f2 = new File([text], 'file2.txt', { type: 'text/plain' });

    const [diffBlob, statsBlob] = await textDiff.run([f1, f2], { context: 3 }, makeCtx());
    const stats = JSON.parse(await statsBlob!.text()) as TextDiffStats;
    expect(stats.additions).toBe(0);
    expect(stats.deletions).toBe(0);
    expect(stats.changes).toBe(0);
  });

  it('single-line change shows in diff', async () => {
    const f1 = new File(['line one\nline two\nline three\n'], 'file1.txt', { type: 'text/plain' });
    const f2 = new File(['line one\nline TWO\nline three\n'], 'file2.txt', { type: 'text/plain' });

    const [diffBlob, statsBlob] = await textDiff.run([f1, f2], { context: 3 }, makeCtx());
    const diff = await diffBlob!.text();
    const stats = JSON.parse(await statsBlob!.text()) as TextDiffStats;

    expect(diff).toContain('-line two');
    expect(diff).toContain('+line TWO');
    expect(stats.additions).toBe(1);
    expect(stats.deletions).toBe(1);
    expect(stats.changes).toBe(2);
  });

  it('multi-line additions counted correctly', async () => {
    const f1 = new File(['line one\n'], 'file1.txt', { type: 'text/plain' });
    const f2 = new File(['line one\nline two\nline three\n'], 'file2.txt', { type: 'text/plain' });

    const [, statsBlob] = await textDiff.run([f1, f2], { context: 3 }, makeCtx());
    const stats = JSON.parse(await statsBlob!.text()) as TextDiffStats;

    expect(stats.additions).toBe(2);
    expect(stats.deletions).toBe(0);
  });

  it('produces unified diff format with --- and +++ headers', async () => {
    const f1 = new File(['hello\n'], 'a.txt', { type: 'text/plain' });
    const f2 = new File(['world\n'], 'b.txt', { type: 'text/plain' });

    const [diffBlob] = await textDiff.run([f1, f2], { context: 3 }, makeCtx());
    const diff = await diffBlob!.text();
    expect(diff).toContain('---');
    expect(diff).toContain('+++');
  });
});
