import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EXPLAIN_CODE_PRO_MAX_LANGUAGE_CHARS,
  explainCodePro,
} from '../../../src/tools/explain-code-pro/index.js';
import { PRO_TEXT_LIMITS, estimateTokens } from '../../../src/lib/pro-limits.js';
import { createDefaultRegistry } from '../../../src/default-registry.js';
import type { ToolRunContext } from '../../../src/types.js';

const FUNCTIONS = (path: string) =>
  fileURLToPath(new URL(`../../../../../functions/_lib/${path}`, import.meta.url));

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'explain-code-pro-test',
    apiKey: 'test-key',
    proOrigin: 'https://wyreup.test',
  };
}

const codeFile = (text: string) => new File([text], 'snippet.py', { type: 'text/plain' });

function stubFetch(result: unknown) {
  const fetchMock = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({ result }), { status: 200 })),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

interface SentBody {
  toolId: string;
  input: Record<string, unknown> & { text: string };
}

function sentBody(fetchMock: ReturnType<typeof stubFetch>): SentBody {
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return JSON.parse(init.body as string) as SentBody;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('explain-code-pro', () => {
  it('is registered as a 1-credit hosted tool and priced the same on the server', () => {
    const tool = createDefaultRegistry().toolsById.get('explain-code-pro');
    expect(tool?.cost).toBe('credit');
    expect(tool?.creditCost).toBe(1);
    expect(readFileSync(FUNCTIONS('pricing.ts'), 'utf8')).toMatch(/'explain-code-pro': 1,/);
    expect(readFileSync(FUNCTIONS('runners.ts'), 'utf8')).toMatch(/maxLanguageChars: 40,/);
    expect(EXPLAIN_CODE_PRO_MAX_LANGUAGE_CHARS).toBe(40);
  });

  it('caps the snippet at 4,000 estimated tokens (12,000 ASCII characters)', () => {
    expect(PRO_TEXT_LIMITS['explain-code-pro']).toEqual({ text: 4_000, language: 40 });
    expect(estimateTokens('a'.repeat(12_000))).toBe(4_000);
  });

  it('sends the code as text with level and language and returns the explanation', async () => {
    const fetchMock = stubFetch({ explanation: 'It adds two numbers.' });
    const blob = (await explainCodePro.run(
      [codeFile('def add(a, b):\n    return a + b\n')],
      { language: ' Python ', level: 'expert' },
      makeCtx(),
    )) as Blob;
    expect(await blob.text()).toBe('It adds two numbers.');
    const body = sentBody(fetchMock);
    expect(body.toolId).toBe('explain-code-pro');
    expect(body.input).toMatchObject({ level: 'expert', language: 'Python' });
    expect(body.input.text).toContain('return a + b');
  });

  it('omits language when left blank', async () => {
    const fetchMock = stubFetch({ explanation: 'ok' });
    await explainCodePro.run([codeFile('x = 1')], { language: '  ' }, makeCtx());
    const body = sentBody(fetchMock);
    expect(body.input).toMatchObject({ level: 'beginner' });
    expect(body.input).not.toHaveProperty('language');
  });

  it('rejects ASCII code over 12,000 characters without a request', async () => {
    const fetchMock = stubFetch({});
    await explainCodePro.run([codeFile('x'.repeat(12_000))], {}, makeCtx());
    fetchMock.mockClear();
    await expect(
      explainCodePro.run([codeFile('x'.repeat(12_001))], {}, makeCtx()),
    ).rejects.toThrow('too long');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects CJK-heavy code over the token cap without a request', async () => {
    const fetchMock = stubFetch({});
    await expect(
      explainCodePro.run([codeFile('中'.repeat(4_001))], {}, makeCtx()),
    ).rejects.toThrow('too long');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('describes the real model, caps and price without em or en dashes', () => {
    expect(explainCodePro.description).toMatch(/Qwen2\.5 Coder 32B/);
    expect(explainCodePro.description).toMatch(/12,000 characters/);
    expect(explainCodePro.description).toMatch(/1 credit per run/);
    expect(explainCodePro.description).not.toMatch(/[—–]/);
  });
});
