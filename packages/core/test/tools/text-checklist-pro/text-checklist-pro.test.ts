import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRegistry } from '../../../src/default-registry.js';
import {
  CHECKLIST_CLIENT_LIMITS,
  parseChecklist,
  textChecklistPro,
} from '../../../src/tools/text-checklist-pro/index.js';
import type * as ProRunner from '../../../src/lib/pro-runner.js';
import type { ToolRunContext } from '../../../src/types.js';

const calls = vi.hoisted(() => [] as { toolId: string; input: Record<string, unknown> }[]);
vi.mock('../../../src/lib/pro-runner.js', async (orig) => ({
  ...(await orig<typeof ProRunner>()),
  runPro: (toolId: string, input: Record<string, unknown>) => {
    calls.push({ toolId, input });
    return Promise.resolve({
      results: [{ question: 'Is this urgent?', kind: 'yes-no', yes: 0.9, no: 0.1 }],
    });
  },
}));

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'text-checklist-pro-test',
  };
}

const txt = (s: string) => new File([s], 'email.txt', { type: 'text/plain' });

beforeEach(() => {
  calls.length = 0;
});

describe('text-checklist-pro metadata', () => {
  it('is registered as a 1-credit text-only tool', () => {
    const tool = createDefaultRegistry().toolsById.get('text-checklist-pro');
    expect(tool?.cost).toBe('credit');
    expect(tool?.creditCost).toBe(1);
    expect(tool?.input.accept).toEqual(['text/plain']);
    expect(tool?.description).toMatch(/Uses 1 credit per run\.$/);
    expect(tool?.description).toContain('16,000 characters');
    expect(`${tool?.description} ${JSON.stringify(tool?.paramSchema)}`).not.toMatch(/[—–]/);
  });
});

describe('parseChecklist', () => {
  it('reads yes/no, pick-one and score lines', () => {
    expect(
      parseChecklist(
        [
          'Is this email urgent?',
          '',
          '# comment',
          'Which team? [billing | technical |sales ]',
          'How severe? [Score: none | minor | major]',
          'Does it mention auto-renewal (or renewal terms)?',
        ].join('\n'),
      ),
    ).toEqual([
      { kind: 'yes-no', question: 'Is this email urgent?' },
      { kind: 'pick-one', question: 'Which team?', options: ['billing', 'technical', 'sales'] },
      { kind: 'score', question: 'How severe?', options: ['none', 'minor', 'major'] },
      { kind: 'yes-no', question: 'Does it mention auto-renewal (or renewal terms)?' },
    ]);
  });

  it.each([
    ['', /at least one question/],
    [Array(11).fill('Ok?').join('\n'), /At most 10/],
    ['Which? [only]', /2 to 10 options/],
    ['Which? [a | A]', /appears twice/],
    ['[a | b]', /no question/],
    [`Which? [a | ${'b'.repeat(41)}]`, /up to 40/],
    [`${'q'.repeat(201)}?`, /longer than 200/],
  ])('rejects %j', (src, msg) => {
    expect(() => parseChecklist(src)).toThrow(msg);
  });
});

describe('text-checklist-pro run', () => {
  it('sends the trimmed text and parsed questions to the hosted runner', async () => {
    const out = await textChecklistPro.run(
      [txt('  Checkout is down.  ')],
      { questions: 'Is this urgent?\nWhich team? [billing | technical]' },
      makeCtx(),
    );
    expect(calls).toEqual([
      {
        toolId: 'text-checklist-pro',
        input: {
          text: 'Checkout is down.',
          fileName: 'email.txt',
          questions: [
            { kind: 'yes-no', question: 'Is this urgent?' },
            { kind: 'pick-one', question: 'Which team?', options: ['billing', 'technical'] },
          ],
        },
      },
    ]);
    const parsed = JSON.parse(await (out as Blob).text()) as { results: { yes: number }[] };
    expect(parsed.results[0]?.yes).toBe(0.9);
  });

  it('refuses text over the cap without spending a credit', async () => {
    await expect(
      textChecklistPro.run(
        [txt('x'.repeat(CHECKLIST_CLIENT_LIMITS.maxTextChars + 1))],
        { questions: 'Ok?' },
        makeCtx(),
      ),
    ).rejects.toThrow(/limit is 16000/);
    expect(calls).toHaveLength(0);
  });
});
