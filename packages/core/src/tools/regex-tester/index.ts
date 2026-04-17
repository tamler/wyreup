import type { ToolModule, ToolRunContext } from '../../types.js';
import type { RegexTesterParams, RegexTesterResult, RegexTesterMatch } from './types.js';

export type { RegexTesterParams, RegexTesterResult, RegexTesterMatch } from './types.js';
export { defaultRegexTesterParams } from './types.js';

const RegexTesterComponentStub = (): unknown => null;

export const regexTester: ToolModule<RegexTesterParams> = {
  id: 'regex-tester',
  slug: 'regex-tester',
  name: 'Regex Tester',
  description: 'Test a regular expression against text and see all matches with positions and named groups.',
  category: 'inspect',
  presence: 'both',
  keywords: ['regex', 'regexp', 'regular', 'expression', 'pattern', 'match', 'test'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 1 * 1024 * 1024,
  },
  output: {
    mime: 'application/json',
    multiple: false,
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: {
    pattern: '',
    flags: 'g',
  },

  Component: RegexTesterComponentStub,

  async run(
    inputs: File[],
    params: RegexTesterParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'processing', percent: 0, message: 'Testing regex' });

    const text = await inputs[0]!.text();
    const flags = params.flags ?? 'g';

    let regex: RegExp;
    try {
      regex = new RegExp(params.pattern, flags);
    } catch (e) {
      const result: RegexTesterResult = {
        valid: false,
        error: (e as Error).message,
        matchCount: 0,
        matches: [],
      };
      ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
      return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
    }

    const MAX_MATCHES = 10000;
    const matches: RegexTesterMatch[] = [];
    let truncated = false;

    if (flags.includes('g') || flags.includes('y')) {
      for (const m of text.matchAll(regex)) {
        if (matches.length >= MAX_MATCHES) { truncated = true; break; }
        const entry: RegexTesterMatch = {
          match: m[0],
          index: m.index ?? 0,
        };
        if (m.groups && Object.keys(m.groups).length > 0) {
          entry.groups = Object.fromEntries(
            Object.entries(m.groups).filter(([, v]) => v !== undefined),
          ) as Record<string, string>;
        }
        matches.push(entry);
      }
    } else {
      // Non-global: single match
      const m = regex.exec(text);
      if (m) {
        const entry: RegexTesterMatch = {
          match: m[0],
          index: m.index,
        };
        if (m.groups && Object.keys(m.groups).length > 0) {
          entry.groups = Object.fromEntries(
            Object.entries(m.groups).filter(([, v]) => v !== undefined),
          ) as Record<string, string>;
        }
        matches.push(entry);
      }
    }

    const result: RegexTesterResult = {
      valid: true,
      matchCount: matches.length,
      matches,
      truncated,
    };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
