import { describe, it, expect } from 'vitest';
import { diffApply } from '../../../src/tools/diff-apply/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('diff-apply — metadata', () => {
  it('has id diff-apply', () => {
    expect(diffApply.id).toBe('diff-apply');
  });

  it('is a free tool', () => {
    expect(diffApply.cost).toBe('free');
  });

  it('has multiple output', () => {
    expect(diffApply.output.multiple).toBe(true);
  });
});

describe('diff-apply — run()', () => {
  it('applies a hunk that replaces a line', async () => {
    const src = 'line one\nline two\nline three\n';
    const diff = '@@ -1,3 +1,3 @@\n line one\n-line two\n+LINE TWO\n line three\n';
    const file = new File([src], 'f.txt', { type: 'text/plain' });
    const [patched, statsBlob] = (await diffApply.run([file], { diff }, makeCtx())) as Blob[];
    expect(await patched!.text()).toBe('line one\nLINE TWO\nline three\n');
    const stats = JSON.parse(await statsBlob!.text()) as {
      hunksApplied: number;
      linesAdded: number;
      linesRemoved: number;
    };
    expect(stats.hunksApplied).toBe(1);
    expect(stats.linesAdded).toBe(1);
    expect(stats.linesRemoved).toBe(1);
  });

  it('applies an addition-only hunk', async () => {
    const src = 'alpha\ngamma\n';
    const diff = '@@ -1,2 +1,3 @@\n alpha\n+beta\n gamma\n';
    const file = new File([src], 'f.txt', { type: 'text/plain' });
    const [patched] = (await diffApply.run([file], { diff }, makeCtx())) as Blob[];
    expect(await patched!.text()).toBe('alpha\nbeta\ngamma\n');
  });

  it('throws on a context mismatch', async () => {
    const src = 'alpha\nbeta\ngamma\n';
    const diff = '@@ -1,3 +1,3 @@\n alpha\n-WRONG\n+new\n gamma\n';
    const file = new File([src], 'f.txt', { type: 'text/plain' });
    await expect(diffApply.run([file], { diff }, makeCtx())).rejects.toThrow(/doesn't apply/);
  });

  it('rejects an empty diff', async () => {
    const file = new File(['x\n'], 'f.txt', { type: 'text/plain' });
    await expect(diffApply.run([file], { diff: '' }, makeCtx())).rejects.toThrow('unified diff');
  });

  it('rejects a diff with no hunks', async () => {
    const file = new File(['x\n'], 'f.txt', { type: 'text/plain' });
    await expect(diffApply.run([file], { diff: '--- a\n+++ b\n' }, makeCtx())).rejects.toThrow(
      'No @@ hunks',
    );
  });
});
