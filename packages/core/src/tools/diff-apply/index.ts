import type { ToolModule, ToolRunContext } from '../../types.js';

export interface DiffApplyParams {
  /** The unified diff (patch) to apply. */
  diff?: string;
}

export const defaultDiffApplyParams: DiffApplyParams = { diff: '' };

export interface DiffApplyResult {
  hunksApplied: number;
  linesAdded: number;
  linesRemoved: number;
}

interface Hunk {
  oldStart: number;
  lines: { kind: ' ' | '-' | '+'; text: string }[];
}

// Parse a unified diff into hunks. File headers (---/+++) and any preamble
// are ignored; only @@ hunks and their bodies are read.
function parseHunks(diff: string): Hunk[] {
  const lines = diff.replace(/\r\n/g, '\n').split('\n');
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;

  for (const line of lines) {
    const header = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(line);
    if (header) {
      current = { oldStart: Number.parseInt(header[1]!, 10), lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current) continue; // preamble / file headers before the first hunk
    if (line.startsWith('---') || line.startsWith('+++')) continue;
    const kind = line[0];
    if (kind === ' ' || kind === '-' || kind === '+') {
      current.lines.push({ kind, text: line.slice(1) });
    }
    // Truly-empty lines (e.g. the trailing newline of the pasted diff) are
    // ignored — standard unified diffs prefix even empty context with a
    // space, and a "\ No newline at end of file" marker is not a body line.
  }
  return hunks;
}

export const diffApply: ToolModule<DiffApplyParams> = {
  id: 'diff-apply',
  slug: 'diff-apply',
  name: 'Apply Diff',
  description:
    'Apply a unified diff (patch) to a text file. Verifies each hunk against the source and fails loudly on a mismatch. The counterpart to Text Diff.',
  category: 'dev',
  keywords: ['diff', 'patch', 'apply', 'unified', 'hunk', 'merge'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 25 * 1024 * 1024,
  },
  output: {
    mime: 'text/plain',
    multiple: true,
  },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultDiffApplyParams,

  paramSchema: {
    diff: {
      type: 'string',
      label: 'unified diff',
      help: 'Paste the unified diff / patch to apply to the uploaded file.',
      placeholder: '@@ -1,3 +1,3 @@\n context\n-old line\n+new line\n context',
      multiline: true,
    },
  },

  async run(inputs: File[], params: DiffApplyParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('diff-apply accepts exactly one text file.');
    const diff = (params.diff ?? '').trim();
    if (!diff) throw new Error('Paste a unified diff to apply.');

    ctx.onProgress({ stage: 'processing', percent: 25, message: 'Parsing diff' });
    const hunks = parseHunks(diff);
    if (hunks.length === 0) throw new Error('No @@ hunks found in the diff.');

    const srcText = await inputs[0]!.text();
    const trailingNewline = srcText.endsWith('\n');
    const src = srcText.replace(/\r\n/g, '\n').split('\n');
    if (trailingNewline) src.pop(); // drop the empty element after a final \n

    ctx.onProgress({ stage: 'processing', percent: 55, message: 'Applying hunks' });
    const out: string[] = [];
    let srcIdx = 0; // 0-based pointer into src
    let linesAdded = 0;
    let linesRemoved = 0;

    for (let h = 0; h < hunks.length; h++) {
      const hunk = hunks[h]!;
      const hunkStart = hunk.oldStart - 1; // to 0-based
      if (hunkStart < srcIdx) {
        throw new Error(`Hunk ${h + 1} overlaps the previous hunk.`);
      }
      // Copy untouched lines before the hunk.
      while (srcIdx < hunkStart && srcIdx < src.length) out.push(src[srcIdx++]!);

      for (const { kind, text } of hunk.lines) {
        if (kind === ' ') {
          if (src[srcIdx] !== text) {
            throw new Error(
              `Hunk ${h + 1} doesn't apply — context mismatch at source line ${srcIdx + 1}.`,
            );
          }
          out.push(text);
          srcIdx++;
        } else if (kind === '-') {
          if (src[srcIdx] !== text) {
            throw new Error(
              `Hunk ${h + 1} doesn't apply — expected to remove a different line at source line ${srcIdx + 1}.`,
            );
          }
          srcIdx++;
          linesRemoved++;
        } else {
          out.push(text);
          linesAdded++;
        }
      }
    }
    // Copy whatever is left after the last hunk.
    while (srcIdx < src.length) out.push(src[srcIdx++]!);

    ctx.onProgress({ stage: 'processing', percent: 90, message: 'Writing result' });
    const patched = out.join('\n') + (trailingNewline ? '\n' : '');
    const stats: DiffApplyResult = {
      hunksApplied: hunks.length,
      linesAdded,
      linesRemoved,
    };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [
      new Blob([patched], { type: 'text/plain' }),
      new Blob([JSON.stringify(stats, null, 2)], { type: 'application/json' }),
    ];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain', 'application/json'],
  },
};
