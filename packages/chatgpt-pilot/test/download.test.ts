import { PassThrough, Writable } from 'node:stream';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import { describe, expect, it, vi } from 'vitest';
import { configuredHosts, downloadFile, permittedUrl, publicAddress } from '../src/download.js';
import type { DownloadDependencies } from '../src/download.js';
import { LIMITS } from '../src/limits.js';

const hosts = configuredHosts('files.example.test');
const url = 'https://files.example.test/input?signature=DO_NOT_LOG';

function fixture(statusCode = 200, headers: Record<string, string> = {}, chunks = [Buffer.from('file-bytes')]) {
  let options: RequestOptions | undefined;
  const response = Object.assign(new PassThrough(), { statusCode, headers });
  const request = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  request.on('finish', () => queueMicrotask(() => {
    callback?.(response as unknown as IncomingMessage);
    for (const chunk of chunks) response.write(chunk);
    response.end();
  }));
  let callback: ((response: IncomingMessage) => void) | undefined;
  const implementation = vi.fn((_url: URL, opts: RequestOptions, cb: (res: IncomingMessage) => void): ClientRequest => {
    options = opts;
    callback = cb;
    return request as unknown as ClientRequest;
  });
  const resolve = vi.fn(() => Promise.resolve(['93.184.215.14']));
  const dependencies: DownloadDependencies = { request: implementation as unknown as DownloadDependencies['request'], resolve };
  return { dependencies, request, response, implementation, resolve, options: () => options };
}

describe('exact-host and global-address boundary', () => {
  it('starts deny-all and yields only the syntactically valid hostname diagnostic', () => {
    expect(configuredHosts().size).toBe(0);
    expect(() => permittedUrl(url, configuredHosts())).toThrow('This file host is not enabled');
    expect(() => configuredHosts('*.example.test')).toThrow();
    expect(() => configuredHosts('files.example.test.')).toThrow();
  });

  it.each([
    'http://files.example.test/a', 'https://files.example.test:444/a',
    'https://user:password@files.example.test/a', 'https://files.example.test/a#fragment',
    'https://files.example.test./a', 'https://127.0.0.1/a', 'https://[::1]/a',
    'file:///etc/passwd', 'https://files.example.test.evil.test/a',
  ])('rejects forbidden URL forms without connecting: %s', async input => {
    const f = fixture();
    await expect(downloadFile(input, hosts, { remaining: LIMITS.requestBytes }, new AbortController().signal, f.dependencies)).rejects.toHaveProperty('code');
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.implementation).not.toHaveBeenCalled();
  });

  it.each(['0.1.2.3', '10.0.0.1', '100.64.0.1', '100.127.255.255', '127.0.0.1', '169.254.1.1', '172.31.1.1', '192.0.0.1', '192.0.2.1', '192.88.99.1', '192.168.0.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::', '::1', 'fe80::1', 'fc00::1', 'ff02::1', '2001:db8::1', '2001::1', '2002:0808:0808::1', '3fff::1', '::ffff:127.0.0.1', '::ffff:c0a8:1'])('rejects nonglobal DNS answer %s', input => {
    expect(publicAddress(input)).toBeNull();
  });

  it('accepts public IPv4/IPv6 and normalizes mapped public IPv4', () => {
    expect(publicAddress('8.8.8.8')).toEqual({ address: '8.8.8.8', family: 4 });
    expect(publicAddress('2606:4700:4700::1111')).toEqual({ address: '2606:4700:4700::1111', family: 6 });
    expect(publicAddress('::ffff:0808:0808')).toEqual({ address: '8.8.8.8', family: 4 });
  });

  it('rejects the whole hostname when any answer is private, before HTTPS starts', async () => {
    const f = fixture();
    f.resolve.mockResolvedValue(['93.184.215.14', '::ffff:10.0.0.1']);
    await expect(downloadFile(url, hosts, { remaining: LIMITS.requestBytes }, new AbortController().signal, f.dependencies)).rejects.toHaveProperty('code', 'FILE_URL_NOT_ALLOWED');
    expect(f.implementation).not.toHaveBeenCalled();
  });
});

describe('bounded HTTPS downloads', () => {
  it('uses the checked address while retaining TLS hostname/certificate checks and exact bytes', async () => {
    const f = fixture(200, { 'content-length': '10' });
    const budget = { remaining: 20 };
    const result = await downloadFile(url, hosts, budget, new AbortController().signal, f.dependencies);
    expect(Buffer.from(result).toString()).toBe('file-bytes');
    expect(budget.remaining).toBe(10);
    expect(f.options()).toMatchObject({ servername: 'files.example.test', rejectUnauthorized: true, family: 4, agent: false });
    const callback = vi.fn();
    f.options()?.lookup?.('files.example.test', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '93.184.215.14', 4);
    expect(f.request.destroyed).toBe(true);
  });

  it.each([301, 302, 307, 308, 403, 500])('does not follow redirect/error HTTP %s', async status => {
    const f = fixture(status, { location: 'https://127.0.0.1/private' });
    await expect(downloadFile(url, hosts, { remaining: LIMITS.requestBytes }, new AbortController().signal, f.dependencies)).rejects.toHaveProperty('code', 'FILE_DOWNLOAD_FAILED');
    expect(f.implementation).toHaveBeenCalledTimes(1);
    expect(f.request.destroyed).toBe(true);
  });

  it('rejects encoding and declared lengths above per-file or request budgets', async () => {
    const cases: Record<string, string>[] = [{ 'content-encoding': 'gzip' }, { 'content-length': String(LIMITS.fileBytes + 1) }, { 'content-length': '100' }];
    for (const headers of cases) {
      const f = fixture(200, headers);
      await expect(downloadFile(url, hosts, { remaining: 20 }, new AbortController().signal, f.dependencies)).rejects.toHaveProperty('code');
      expect(f.request.destroyed).toBe(true);
    }
  });

  it('stops before retaining an oversized streamed chunk, including absent content-length', async () => {
    const f = fixture(200, {}, [Buffer.alloc(10), Buffer.alloc(11)]);
    const budget = { remaining: 20 };
    await expect(downloadFile(url, hosts, budget, new AbortController().signal, f.dependencies)).rejects.toHaveProperty('code', 'FILE_TOO_LARGE');
    expect(budget.remaining).toBe(10);
    expect(f.request.destroyed).toBe(true);
  });

  it('rejects cancellation before DNS and completes cleanup', async () => {
    const controller = new AbortController();
    controller.abort();
    const f = fixture();
    await expect(downloadFile(url, hosts, { remaining: LIMITS.requestBytes }, controller.signal, f.dependencies)).rejects.toHaveProperty('code', 'CANCELLED');
    expect(f.resolve).not.toHaveBeenCalled();
  });
});
