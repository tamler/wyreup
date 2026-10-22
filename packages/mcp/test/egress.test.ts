import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  installEgressLock,
  EgressBlockedError,
  _resetEgressLockForTests,
  setEgressAllowedOrigin,
  setEgressAllowedOrigins,
} from '../src/egress.js';
import { scrubbedEnv } from '../src/supervisor.js';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

let server: Server;
let port: number;
let targetServer: Server;
let targetPort: number;
let capturedHeaders: Record<string, string | string[] | undefined>;
let redirectedRequests: { method: string | undefined; body: string }[];

beforeEach(async () => {
  _resetEgressLockForTests();
  capturedHeaders = {};
  redirectedRequests = [];
  await new Promise<void>((resolve) => {
    targetServer = createServer((req, res) => {
      capturedHeaders = req.headers;
      const chunks: Buffer[] = [];
      let failed = false;
      const fail = (error: Error) => { failed = true; res.destroy(error); };
      req.on('data', (chunk: unknown) => {
        if (failed) return;
        if (!Buffer.isBuffer(chunk)) { fail(new Error('Expected a native request Buffer')); return; }
        chunks.push(chunk);
      });
      req.once('error', fail);
      req.once('aborted', () => fail(new Error('Native request aborted')));
      req.once('end', () => {
        if (failed) return;
        redirectedRequests.push({ method: req.method, body: Buffer.concat(chunks).toString() });
        res.writeHead(200);
        res.end('target');
      });
    });
    targetServer.listen(0, '127.0.0.1', () => {
      targetPort = (targetServer.address() as AddressInfo).port;
      resolve();
    });
  });
  await new Promise<void>((resolve) => {
    server = createServer((req, res) => {
      const redirect = /^\/redirect-(301|302|303|307|308)-(same|other)$/.exec(req.url ?? '');
      if (redirect) {
        const destination = redirect[2] === 'same' ? port : targetPort;
        res.writeHead(Number(redirect[1]), { location: `http://127.0.0.1:${destination}/capture` });
        res.end();
        return;
      }
      if (req.url === '/capture') {
        capturedHeaders = req.headers;
        const chunks: Buffer[] = [];
        let failed = false;
        const fail = (error: Error) => { failed = true; res.destroy(error); };
        req.on('data', (chunk: unknown) => {
          if (failed) return;
          if (!Buffer.isBuffer(chunk)) { fail(new Error('Expected a native request Buffer')); return; }
          chunks.push(chunk);
        });
        req.once('error', fail);
        req.once('aborted', () => fail(new Error('Native request aborted')));
        req.once('end', () => {
          if (failed) return;
          redirectedRequests.push({ method: req.method, body: Buffer.concat(chunks).toString() });
          res.end('target');
        });
        return;
      }
      if (req.url === '/ok') {
        res.writeHead(200);
        res.end('ok');
        return;
      }
      if (req.url === '/redirect-internal') {
        res.writeHead(302, { location: `http://127.0.0.1:${port}/ok` });
        res.end();
        return;
      }
      if (req.url === '/redirect-external') {
        res.writeHead(302, { location: 'http://evil.example/' });
        res.end();
        return;
      }
      if (req.url === '/redirect-allowed-cross-origin') {
        res.writeHead(302, { location: `http://127.0.0.1:${targetPort}/capture` });
        res.end();
        return;
      }
      if (req.url === '/loop') {
        res.writeHead(302, { location: `http://127.0.0.1:${port}/loop` });
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port;
      resolve();
    });
  });
});

afterEach(async () => {
  const currentServer = server as Server | undefined;
  const currentTargetServer = targetServer as Server | undefined;
  currentServer?.closeAllConnections();
  currentTargetServer?.closeAllConnections();
  if (currentServer) await new Promise<void>((r) => currentServer.close(() => r()));
  if (currentTargetServer) {
    await new Promise<void>((r) => currentTargetServer.close(() => r()));
  }
  _resetEgressLockForTests();
});

describe('egress lock [spec §#9]', () => {
  it.each([301, 302, 303])('rewrites POST to GET for status %s without forwarding its body headers', async (status) => {
    installEgressLock([`http://127.0.0.1:${port}`, `http://127.0.0.1:${targetPort}`]);
    const response = await fetch(`http://127.0.0.1:${port}/redirect-${status}-other`, {
      method: 'POST', body: 'private-payload',
      headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer secret', 'X-Safe': 'keep' },
    });
    expect(await response.text()).toBe('target');
    expect(redirectedRequests).toEqual([{ method: 'GET', body: '' }]);
    expect(capturedHeaders['content-type']).toBeUndefined();
    expect(capturedHeaders['authorization']).toBeUndefined();
    expect(capturedHeaders['x-safe']).toBe('keep');
  });

  it.each([307, 308])('keeps a bodyless GET usable across status %s', async (status) => {
    installEgressLock([`http://127.0.0.1:${port}`, `http://127.0.0.1:${targetPort}`]);
    const response = await fetch(`http://127.0.0.1:${port}/redirect-${status}-other`);
    expect(await response.text()).toBe('target');
    expect(redirectedRequests).toEqual([{ method: 'GET', body: '' }]);
  });

  it.each([
    [307, 'same', 'POST'], [308, 'other', 'POST'], [301, 'same', 'PUT'], [302, 'other', 'PUT'],
  ] as const)('refuses body replay for status %s to %s origin with %s', async (status, destination, method) => {
    installEgressLock([`http://127.0.0.1:${port}`, `http://127.0.0.1:${targetPort}`]);
    await expect(fetch(`http://127.0.0.1:${port}/redirect-${status}-${destination}`, {
      method, body: 'private-payload',
    })).rejects.toThrow('Redirect would replay a request body');
    expect(redirectedRequests).toEqual([]);
  });

  it('preserves effective Request fields while following a bodyless redirect', async () => {
    installEgressLock([`http://127.0.0.1:${port}`, `http://127.0.0.1:${targetPort}`]);
    const request = new Request(`http://127.0.0.1:${port}/redirect-302-other`, {
      headers: { Authorization: 'Bearer secret', 'X-Safe': 'request-value' },
    });
    const response = await fetch(request);
    expect(await response.text()).toBe('target');
    expect(capturedHeaders['x-safe']).toBe('request-value');
    expect(capturedHeaders['authorization']).toBeUndefined();
  });

  it('keeps HEAD unchanged for a 303 redirect', async () => {
    installEgressLock([`http://127.0.0.1:${port}`, `http://127.0.0.1:${targetPort}`]);
    const response = await fetch(new Request(`http://127.0.0.1:${port}/redirect-303-other`, { method: 'HEAD' }));
    expect(response.status).toBe(200);
    expect(redirectedRequests).toEqual([{ method: 'HEAD', body: '' }]);
  });

  it.each(['manual', 'error'] as const)('honors redirect=%s on a Request without an init override', async (redirect) => {
    installEgressLock([`http://127.0.0.1:${port}`, `http://127.0.0.1:${targetPort}`]);
    const request = new Request(`http://127.0.0.1:${port}/redirect-302-other`, { redirect });
    if (redirect === 'error') await expect(fetch(request)).rejects.toBeInstanceOf(TypeError);
    else {
      const response = await fetch(request);
      expect(response.status).toBe(302);
      await response.body?.cancel();
    }
    expect(redirectedRequests).toEqual([]);
  });

  it('blocks fetch to a disallowed origin', async () => {
    installEgressLock(`http://127.0.0.1:${port}`);
    await expect(fetch('http://evil.example/')).rejects.toBeInstanceOf(EgressBlockedError);
  });

  it('allows fetch to the configured origin', async () => {
    installEgressLock(`http://127.0.0.1:${port}`);
    const r = await fetch(`http://127.0.0.1:${port}/ok`);
    expect(await r.text()).toBe('ok');
  });

  it('allows each explicitly trusted origin and still blocks unrelated egress', async () => {
    installEgressLock(['http://first.example', `http://127.0.0.1:${port}`]);
    const r = await fetch(`http://127.0.0.1:${port}/ok`);
    expect(await r.text()).toBe('ok');
    await expect(fetch('http://evil.example/')).rejects.toBeInstanceOf(EgressBlockedError);
  });

  it('strips credentials when following a redirect to another allowed origin', async () => {
    installEgressLock([
      `http://127.0.0.1:${port}`,
      `http://127.0.0.1:${targetPort}`,
    ]);
    const r = await fetch(`http://127.0.0.1:${port}/redirect-allowed-cross-origin`, {
      headers: {
        Authorization: 'Bearer secret',
        Cookie: 'session=secret',
        'Proxy-Authorization': 'Basic secret',
      },
    });
    expect(await r.text()).toBe('target');
    expect(capturedHeaders['authorization']).toBeUndefined();
    expect(capturedHeaders['cookie']).toBeUndefined();
    expect(capturedHeaders['proxy-authorization']).toBeUndefined();
  });

  it('blocks Request(URL) to a disallowed origin', async () => {
    installEgressLock(`http://127.0.0.1:${port}`);
    await expect(fetch(new Request('http://evil.example/'))).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
  });

  it('follows internal redirects', async () => {
    installEgressLock(`http://127.0.0.1:${port}`);
    const r = await fetch(`http://127.0.0.1:${port}/redirect-internal`);
    expect(await r.text()).toBe('ok');
  });

  it('blocks a cross-origin redirect', async () => {
    installEgressLock(`http://127.0.0.1:${port}`);
    await expect(fetch(`http://127.0.0.1:${port}/redirect-external`)).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
  });

  it('rejects redirect loop after 5 hops', async () => {
    installEgressLock(`http://127.0.0.1:${port}`);
    await expect(fetch(`http://127.0.0.1:${port}/loop`)).rejects.toBeInstanceOf(EgressBlockedError);
  });

  it('honors redirect: "manual" — returns 3xx directly', async () => {
    installEgressLock(`http://127.0.0.1:${port}`);
    const r = await fetch(`http://127.0.0.1:${port}/redirect-internal`, { redirect: 'manual' });
    expect(r.status).toBe(302);
  });

  it('idempotent: second install is a no-op', async () => {
    installEgressLock(`http://127.0.0.1:${port}`);
    installEgressLock('http://other.example'); // ignored
    await expect(fetch('http://other.example/')).rejects.toBeInstanceOf(EgressBlockedError);
  });

  it('setEgressAllowedOrigin repoints the installed lock to a trusted origin', async () => {
    installEgressLock('http://first.example');
    // The worker narrows the allowlist to job.proOrigin (IPC-delivered, trusted).
    setEgressAllowedOrigin(`http://127.0.0.1:${port}`);
    const r = await fetch(`http://127.0.0.1:${port}/ok`);
    expect(await r.text()).toBe('ok');
    await expect(fetch('http://first.example/')).rejects.toBeInstanceOf(EgressBlockedError);
  });

  it('setEgressAllowedOrigins preserves Pro and model origins together', async () => {
    installEgressLock('http://first.example');
    setEgressAllowedOrigins(['http://pro.example', `http://127.0.0.1:${port}`]);
    const r = await fetch(`http://127.0.0.1:${port}/ok`);
    expect(await r.text()).toBe('ok');
    await expect(fetch('http://first.example/')).rejects.toBeInstanceOf(EgressBlockedError);
  });
});

describe('egress lock — worker env hardening [security]', () => {
  // FIX 1a: the forked worker holds the Pro key and must ALWAYS install the
  // egress lock. scrubbedEnv() must therefore NOT propagate the parent's
  // disable flag or origin override into the worker, or an attacker could hand
  // the worker a "no egress restriction" path or re-point its allowlist.
  it('does not forward WYREUP_DISABLE_EGRESS_LOCK into the worker env', () => {
    const ORIG = process.env['WYREUP_DISABLE_EGRESS_LOCK'];
    process.env['WYREUP_DISABLE_EGRESS_LOCK'] = '1';
    try {
      expect(scrubbedEnv()['WYREUP_DISABLE_EGRESS_LOCK']).toBeUndefined();
    } finally {
      if (ORIG === undefined) delete process.env['WYREUP_DISABLE_EGRESS_LOCK'];
      else process.env['WYREUP_DISABLE_EGRESS_LOCK'] = ORIG;
    }
  });

  it('does not forward WYREUP_ORIGIN into the worker env', () => {
    const ORIG = process.env['WYREUP_ORIGIN'];
    process.env['WYREUP_ORIGIN'] = 'http://attacker.example';
    try {
      expect(scrubbedEnv()['WYREUP_ORIGIN']).toBeUndefined();
    } finally {
      if (ORIG === undefined) delete process.env['WYREUP_ORIGIN'];
      else process.env['WYREUP_ORIGIN'] = ORIG;
    }
  });
});
