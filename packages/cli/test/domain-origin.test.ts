/// <reference lib="dom" />
// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- The source fixture uses an existing ambient declaration with no runtime module.
/// <reference path="../../core/src/lib/tr46.d.ts" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ToolRunContext, ToolModule } from '@wyreup/core';
import type * as Core from '@wyreup/core';
import type * as Credentials from '../src/lib/credentials.js';
import { domainAgeChecker } from '../../core/src/utilities/domain-age';
import { domainStatusResult, registrationInstant } from '../../core/src/lib/domain-registration';
import {
  installEgressLock,
  _resetEgressLockForTests,
  EgressBlockedError,
} from '../src/lib/safety/egress';

const spies = vi.hoisted(() => ({
  readKey: vi.fn(() => Promise.resolve('KEY_CANARY')),
  login: vi.fn(() => Promise.reject(new Error('Free tools must not prompt.'))),
  contexts: [] as ToolRunContext[],
}));
vi.mock('../src/lib/credentials.js', async (importOriginal) => {
  const actual = await importOriginal<typeof Credentials>();
  return { ...actual, readApiKey: spies.readKey };
});
vi.mock('../src/lib/interactive-login.js', () => ({ interactiveLogin: spies.login }));
vi.mock('@wyreup/core', async (importOriginal) => {
  const actual = await importOriginal<typeof Core>();
  const { domainAgeChecker: domain } = await import('../../core/src/utilities/domain-age');
  const runnable = domain as unknown as ToolModule;
  return {
    ...actual,
    createDefaultRegistry: () =>
      actual.createRegistry([
        {
          ...runnable,
          run(inputs, params, ctx) {
            spies.contexts.push(ctx);
            return runnable.run(inputs, params, ctx);
          },
        },
        {
          ...runnable,
          id: 'synthetic-credit',
          cost: 'credit',
          run(_inputs, _params, ctx) {
            spies.contexts.push(ctx);
            return Promise.resolve(new Blob(['{}'], { type: 'application/json' }));
          },
        },
      ]),
  };
});
import { executeTool } from '../src/commands/run';
import { executeChain } from '../src/commands/chain';

let server: Server;
let origin: string;
let calls: { path: string; body: string; auth?: string; cookie?: string }[];
beforeEach(async () => {
  _resetEgressLockForTests();
  spies.readKey.mockClear();
  spies.login.mockClear();
  spies.contexts.length = 0;
  calls = [];
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  // Suppress only this test's new SIGINT listener; production lifecycle is outside this change.
  vi.spyOn(process, 'on').mockReturnValue(process);
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`exit ${code}`);
  });
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  await new Promise<void>((resolve) => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk as Uint8Array)));
      request.on('end', () => {
        calls.push({
          path: request.url ?? '',
          body: Buffer.concat(chunks).toString(),
          auth: request.headers.authorization,
          cookie: request.headers.cookie,
        });
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify(
            domainStatusResult(
              'example.com',
              'unsupported-tld',
              registrationInstant('2026-01-01T00:00:00Z'),
            ),
          ),
        );
      });
    });
    server.listen(0, '127.0.0.1', () => {
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
  vi.stubEnv('WYREUP_ORIGIN', origin);
  vi.stubEnv('WYREUP_API_KEY', 'ENV_KEY_CANARY');
  installEgressLock([origin, 'https://models.wyreup.com']);
});
afterEach(async () => {
  _resetEgressLockForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
});

describe('CLI trusted origin with actual domain tool and normal egress lock (test-injected registry)', () => {
  it('run reaches only the configured local API without reading a key or prompting', async () => {
    await executeTool(domainAgeChecker.id, [], { param: ['domain=example.com'] });
    expect(spies.contexts[0]?.proOrigin).toBe(origin);
    expect(spies.contexts[0]?.apiKey).toBeUndefined();
    expect(calls).toEqual([
      {
        path: '/api/domain-age',
        body: '{"domain":"example.com"}',
        auth: undefined,
        cookie: undefined,
      },
    ]);
    expect(spies.readKey).not.toHaveBeenCalled();
    expect(spies.login).not.toHaveBeenCalled();
    await expect(fetch('https://data.iana.org/rdap/dns.json')).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
  });
  it('chain carries the same trusted origin without key lookup and cannot fetch a registry directly', async () => {
    await executeChain([], { steps: 'domain-age-checker[domain=example.com]' });
    expect(spies.contexts[0]?.proOrigin).toBe(origin);
    expect(spies.contexts[0]?.apiKey).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(spies.readKey).not.toHaveBeenCalled();
    expect(spies.login).not.toHaveBeenCalled();
    await expect(fetch('https://rdap.registry.net/domain/example.com')).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
  });
  it('credit runs retain existing key lookup and receive the same origin', async () => {
    await executeTool('synthetic-credit', [], {});
    expect(spies.contexts[0]).toMatchObject({ apiKey: 'KEY_CANARY', proOrigin: origin });
    expect(spies.readKey).toHaveBeenCalledOnce();
    expect(spies.login).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
  it.each([
    'https://user:pass@wyreup.com',
    'https://wyreup.com/path',
    'https://wyreup.com/?q=x',
    'http://wyreup.com',
  ])(
    'rejects invalid trusted origin %s without a provider request or key lookup',
    async (value) => {
      vi.stubEnv('WYREUP_ORIGIN', value);
      await expect(
        executeTool(domainAgeChecker.id, [], { param: ['domain=example.com'] }),
      ).rejects.toThrow('exit 1');
      expect(calls).toEqual([]);
      expect(spies.readKey).not.toHaveBeenCalled();
      expect(spies.login).not.toHaveBeenCalled();
    },
  );
});
