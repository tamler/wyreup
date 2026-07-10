import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  installEgressLock,
  EgressBlockedError,
  _resetEgressLockForTests,
  setEgressAllowedOrigin,
} from '../src/egress.js';
import { scrubbedEnv } from '../src/supervisor.js';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

let server: Server;
let port: number;

beforeEach(async () => {
  _resetEgressLockForTests();
  await new Promise<void>((resolve) => {
    server = createServer((req, res) => {
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
  await new Promise<void>((r) => server.close(() => r()));
  _resetEgressLockForTests();
});

describe('egress lock [spec §#9]', () => {
  it('blocks fetch to a disallowed origin', async () => {
    installEgressLock(`http://127.0.0.1:${port}`);
    await expect(fetch('http://evil.example/')).rejects.toBeInstanceOf(EgressBlockedError);
  });

  it('allows fetch to the configured origin', async () => {
    installEgressLock(`http://127.0.0.1:${port}`);
    const r = await fetch(`http://127.0.0.1:${port}/ok`);
    expect(await r.text()).toBe('ok');
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
