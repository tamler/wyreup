import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { installEgressLock, EgressBlockedError, _resetEgressLockForTests } from '../src/lib/safety/egress.js';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

let server: Server;
let port: number;

beforeEach(async () => {
  _resetEgressLockForTests();
  await new Promise<void>((resolve) => {
    server = createServer((req, res) => {
      if (req.url === '/ok') { res.writeHead(200); res.end('ok'); return; }
      if (req.url === '/redirect-external') { res.writeHead(302, { location: 'http://evil.example/' }); res.end(); return; }
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

describe('CLI egress lock — multi-origin', () => {
  it('allows fetch to any of the configured origins', async () => {
    installEgressLock([`http://127.0.0.1:${port}`, 'http://other.example']);
    const r = await fetch(`http://127.0.0.1:${port}/ok`);
    expect(await r.text()).toBe('ok');
  });

  it('blocks an origin not in the allowlist', async () => {
    installEgressLock([`http://127.0.0.1:${port}`, 'http://models.example']);
    await expect(fetch('http://evil.example/')).rejects.toBeInstanceOf(EgressBlockedError);
  });

  it('blocks a cross-origin redirect even when the initial origin is allowed', async () => {
    installEgressLock([`http://127.0.0.1:${port}`]);
    await expect(fetch(`http://127.0.0.1:${port}/redirect-external`)).rejects.toBeInstanceOf(EgressBlockedError);
  });

  it('idempotent: second install is a no-op', async () => {
    installEgressLock([`http://127.0.0.1:${port}`]);
    installEgressLock(['http://other.example']);  // ignored
    await expect(fetch('http://other.example/')).rejects.toBeInstanceOf(EgressBlockedError);
  });
});
