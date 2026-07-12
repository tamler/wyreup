import { describe, expect, it } from 'vitest';
import { harSanitize } from '../../../src/tools/har-sanitize/index.js';
import type { HarSanitizeParams } from '../../../src/tools/har-sanitize/types.js';
import type { ToolRunContext } from '../../../src/types.js';

const HAR = {
  log: {
    version: '1.2',
    creator: { name: 'test', version: '1' },
    entries: [
      {
        request: {
          method: 'POST',
          url: 'https://example.com/api?access_token=url-secret&access_token=second&safe=yes',
          headers: [
            { name: 'Authorization', value: 'Bearer header-secret' },
            { name: 'Cookie', value: 'session=cookie-secret' },
            { name: 'Accept', value: 'application/json' },
          ],
          cookies: [{ name: 'session', value: 'cookie-array-secret' }],
          queryString: [
            { name: 'access_token', value: 'query-secret' },
            { name: 'safe', value: 'yes' },
          ],
          postData: { mimeType: 'application/json', text: '{"password":"body-secret"}' },
        },
        response: {
          status: 200,
          headers: [
            { name: 'Set-Cookie', value: 'server=secret' },
            { name: 'X-Api-Key', value: 'response-secret' },
          ],
          cookies: [{ name: 'server', value: 'response-cookie-secret' }],
          content: { mimeType: 'application/json', text: '{"token":"response-body"}' },
        },
      },
      {
        request: { method: 'GET', url: 'https://example.com/health', headers: [] },
        response: { status: 204, headers: [], content: {} },
      },
    ],
  },
};

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

interface SanitizedHar {
  log: {
    entries: Array<{
      request: {
        url: string;
        headers: Array<{ value: string }>;
        cookies: Array<{ value: string }>;
        queryString: Array<{ value: string }>;
        postData: { text: string };
      };
      response: {
        headers: Array<{ value: string }>;
        cookies: Array<{ value: string }>;
        content: { text: string };
      };
    }>;
    _sanitized: {
      cookies: number;
      authHeaders: number;
      queryTokens: number;
      postData: number;
    };
  };
}

async function run(params: HarSanitizeParams = {}): Promise<SanitizedHar> {
  const input = new File([JSON.stringify(HAR)], 'capture.har', { type: 'application/json' });
  const [output] = (await harSanitize.run([input], params, makeCtx())) as Blob[];
  expect(output!.type).toBe('application/json');
  return JSON.parse(await output!.text()) as SanitizedHar;
}

describe('har-sanitize — metadata', () => {
  it('declares complete privacy and developer metadata', () => {
    expect(harSanitize.category).toBe('privacy');
    expect(harSanitize.categories).toEqual(['privacy', 'dev']);
    expect(harSanitize.input.accept).toEqual(['application/json', 'text/plain']);
    expect(harSanitize.defaults).toEqual({
      redactCookies: true,
      redactAuthHeaders: true,
      redactQueryTokens: true,
      redactPostData: false,
    });
    expect(harSanitize.llmDescription).toBeTruthy();
  });
});

describe('har-sanitize — run()', () => {
  it('redacts configured secrets, records counts, and preserves every entry', async () => {
    const result = await run({ redactPostData: true });
    const entry = result.log.entries[0]!;

    expect(result.log.entries).toHaveLength(2);
    expect(entry.request.cookies[0]!.value).toBe('[REDACTED]');
    expect(entry.response.cookies[0]!.value).toBe('[REDACTED]');
    expect(entry.request.headers[0]!.value).toBe('[REDACTED]');
    expect(entry.request.headers[1]!.value).toBe('[REDACTED]');
    expect(entry.response.headers[0]!.value).toBe('[REDACTED]');
    expect(entry.response.headers[1]!.value).toBe('[REDACTED]');
    expect(entry.request.queryString[0]!.value).toBe('[REDACTED]');
    expect(new URL(entry.request.url).searchParams.getAll('access_token')).toEqual([
      '[REDACTED]',
      '[REDACTED]',
    ]);
    expect(entry.request.postData.text).toBe('[REDACTED]');
    expect(entry.response.content.text).toBe('[REDACTED]');
    expect(result.log._sanitized).toEqual({
      cookies: 4,
      authHeaders: 2,
      queryTokens: 3,
      postData: 2,
    });
  });

  it('leaves request and response bodies intact by default', async () => {
    const result = await run();
    expect(result.log.entries[0]!.request.postData.text).toBe('{"password":"body-secret"}');
    expect(result.log.entries[0]!.response.content.text).toBe('{"token":"response-body"}');
    expect(result.log._sanitized.postData).toBe(0);
  });
});
