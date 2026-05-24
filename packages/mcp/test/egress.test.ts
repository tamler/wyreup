import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { installEgressLock, EgressBlockedError, _resetEgressLockForTests } from '../src/egress.js';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

let server: Server;
let port: number;

beforeEach(async () => {
  _resetEgressLockForTests();
  await new Promise<void>((resolve) => {
    server = createServer((req, res) => {
      if (req.url === '/ok') { res.writeHead(200); res.end('ok'); return; }
      if (req.url === '/redirect-internal') { res.writeHead(302, { location: `http://127.0.0.1:${port}/ok` }); res.end(); return; }
      if (req.url === '/redirect-external') { res.writeHead(302, { location: 'http://evil.example/' }); res.end(); return; }
      if (req.url === '/loop') { res.writeHead(302, { location: `http://127.0.0.1:${port}/loop` }); res.end(); return; }
      res.writeHead(404); res.end();
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
    await expect(fetch(new Request('http://evil.example/'))).rejects.toBeInstanceOf(EgressBlockedError);
  });

  it('follows internal redirects', async () => {
    installEgressLock(`http://127.0.0.1:${port}`);
    const r = await fetch(`http://127.0.0.1:${port}/redirect-internal`);
    expect(await r.text()).toBe('ok');
  });

  it('blocks a cross-origin redirect', async () => {
    installEgressLock(`http://127.0.0.1:${port}`);
    await expect(fetch(`http://127.0.0.1:${port}/redirect-external`)).rejects.toBeInstanceOf(EgressBlockedError);
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
    installEgressLock('http://other.example');  // ignored
    await expect(fetch('http://other.example/')).rejects.toBeInstanceOf(EgressBlockedError);
  });
});
