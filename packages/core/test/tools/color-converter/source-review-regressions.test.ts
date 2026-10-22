import { describe, expect, it } from 'vitest';
import { colorConverter } from '../../../src/tools/color-converter/index.js';
import type { ToolRunContext } from '../../../src/types.js';

class ObservedFile extends File {
  reads = 0;
  byteReads = 0;
  slices: Array<[number | undefined, number | undefined]> = [];

  override text(): Promise<string> {
    this.reads += 1;
    return super.text();
  }

  override slice(start?: number, end?: number, contentType?: string): Blob {
    this.slices.push([start, end]);
    const blob = super.slice(start, end, contentType);
    const read = blob.arrayBuffer.bind(blob);
    Object.defineProperty(blob, 'arrayBuffer', {
      value: () => {
        this.byteReads += 1;
        return read();
      },
    });
    return blob;
  }
}

async function expectRefusedBeforeReadOrProgress(files: ObservedFile[], aborted = false) {
  const controller = new AbortController();
  if (aborted) controller.abort();
  const stages: string[] = [];
  const ctx: ToolRunContext = {
    signal: controller.signal,
    cache: new Map(),
    executionId: 'color-source-review-regressions',
    onProgress: (progress) => stages.push(progress.stage),
  };
  let refusal: unknown;
  let output: unknown;
  try {
    output = await colorConverter.run(files, {}, ctx);
  } catch (error) {
    refusal = error;
  }
  expect.soft(refusal).toBeInstanceOf(Error);
  expect.soft(output).toBeUndefined();
  expect.soft(files.map((file) => file.reads)).toEqual(files.map(() => 0));
  expect.soft(files.map((file) => file.byteReads)).toEqual(files.map(() => 0));
  expect.soft(files.map((file) => file.slices)).toEqual(files.map(() => []));
  expect(stages).toEqual([]);
}

describe('color source review direct-run input gates', () => {
  it('refuses no input without publishing processing stages', async () => {
    await expectRefusedBeforeReadOrProgress([]);
  });

  it('refuses multiple files without reading either one', async () => {
    await expectRefusedBeforeReadOrProgress([
      new ObservedFile(['red'], 'first.txt', { type: 'text/plain' }),
      new ObservedFile(['blue'], 'second.txt', { type: 'text/plain' }),
    ]);
  });

  it('refuses 1025 bytes before reading even when trimming would yield a valid color', async () => {
    const file = new ObservedFile([' '.repeat(1022) + 'red'], 'oversize.txt', {
      type: 'text/plain',
    });
    expect(file.size).toBe(1025);
    await expectRefusedBeforeReadOrProgress([file]);
  });

  it('refuses an already-aborted direct run before reading or progress', async () => {
    await expectRefusedBeforeReadOrProgress(
      [new ObservedFile(['red'], 'color.txt', { type: 'text/plain' })],
      true,
    );
  });

  it('accepts the exact 1024-byte boundary and preserves normal conversion', async () => {
    const file = new ObservedFile([' '.repeat(1021) + 'red'], 'boundary.txt', {
      type: 'text/plain',
    });
    expect(file.size).toBe(1024);
    const stages: string[] = [];
    const output = (await colorConverter.run(
      [file],
      {},
      {
        signal: new AbortController().signal,
        cache: new Map(),
        executionId: 'color-source-review-boundary',
        onProgress: (progress) => stages.push(progress.stage),
      },
    )) as Blob[];
    expect(file.reads).toBe(0);
    expect(file.slices).toEqual([[0, 1025]]);
    expect(file.byteReads).toBe(1);
    expect(output[0]!.type).toBe('application/json');
    expect(JSON.parse(await output[0]!.text())).toMatchObject({
      valid: true,
      input: 'red',
      hex: '#ff0000',
      alpha: 1,
    });
    expect(stages.at(-1)).toBe('done');
  });

  it('bounds actual sliced bytes when caller metadata understates size', async () => {
    class UnderstatedFile extends ObservedFile {
      override get size() {
        return 3;
      }
    }
    const file = new UnderstatedFile([' '.repeat(2048) + 'red'], 'understated.txt');
    expect(file.size).toBe(3);
    const stages: string[] = [];
    let refusal: unknown;
    let output: unknown;
    try {
      output = await colorConverter.run(
        [file],
        {},
        {
          signal: new AbortController().signal,
          cache: new Map(),
          executionId: 'color-source-review-actual-bytes',
          onProgress: (progress) => stages.push(progress.stage),
        },
      );
    } catch (error) {
      refusal = error;
    }
    expect.soft(refusal).toBeInstanceOf(Error);
    expect.soft(output).toBeUndefined();
    expect.soft(file.reads).toBe(0);
    expect.soft(file.slices).toEqual([[0, 1025]]);
    expect.soft(file.byteReads).toBe(1);
    expect(stages).not.toContain('done');
  });
});
