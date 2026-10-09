import { Resolver } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';
import { LIMITS, PilotError } from './limits.js';

export interface ByteBudget { remaining: number }
export interface Address { address: string; family: 4 | 6 }
export interface DownloadDependencies {
  resolve: (hostname: string, signal: AbortSignal) => Promise<string[]>;
  request: typeof httpsRequest;
}

function ipv4Number(address: string): number {
  return address.split('.').reduce((value, octet) => value * 256 + Number(octet), 0);
}

function inV4Range(value: number, network: string, prefix: number): boolean {
  const size = 2 ** (32 - prefix);
  return Math.floor(value / size) === Math.floor(ipv4Number(network) / size);
}

function ipv6Words(address: string): number[] | null {
  if (isIP(address) !== 6 || address.includes('%')) return null;
  let input = address.toLowerCase();
  const v4 = /(?:^|:)(\d+\.\d+\.\d+\.\d+)$/.exec(input);
  if (v4) {
    const value = ipv4Number(v4[1]!);
    input = input.slice(0, input.length - v4[1]!.length) + `${Math.floor(value / 65536).toString(16)}:${(value % 65536).toString(16)}`;
  }
  const parts = input.split('::');
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts[1] ? parts[1].split(':') : [];
  const words = parts.length === 2
    ? [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right]
    : left;
  return words.length === 8 ? words.map(word => Number.parseInt(word, 16)) : null;
}

export function publicAddress(address: string): Address | null {
  const words = ipv6Words(address);
  if (words && words.slice(0, 5).every(word => word === 0) && words[5] === 65535) {
    const first = words[6]!;
    const second = words[7]!;
    return publicAddress(`${first >>> 8}.${first & 255}.${second >>> 8}.${second & 255}`);
  }
  if (isIP(address) === 4) {
    const value = ipv4Number(address);
    const denied: [string, number][] = [
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
      ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
      ['203.0.113.0', 24], ['224.0.0.0', 3],
    ];
    return denied.some(([network, prefix]) => inV4Range(value, network, prefix))
      ? null : { address, family: 4 };
  }
  if (!words || (words[0]! & 0xe000) !== 0x2000) return null;
  // Exclude special-purpose protocol assignments, documentation, and transition space.
  if (words[0] === 0x2001 && (words[1]! < 0x0200 || words[1] === 0x0db8)) return null;
  if (words[0] === 0x2002 || (words[0] === 0x3fff && words[1]! < 0x1000)) return null;
  return { address, family: 6 };
}

function validHostname(hostname: string): boolean {
  return hostname.length <= 253 && hostname.includes('.') &&
    hostname.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) &&
    isIP(hostname) === 0;
}

export function configuredHosts(value = ''): ReadonlySet<string> {
  const hosts = value.split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
  if (hosts.some(host => !validHostname(host))) throw new Error('Invalid download host configuration.');
  return new Set(hosts);
}

export function permittedUrl(input: string, hosts: ReadonlySet<string>): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new PilotError('FILE_URL_NOT_ALLOWED'); }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash ||
      !validHostname(hostname)) throw new PilotError('FILE_URL_NOT_ALLOWED');
  if (!hosts.has(hostname)) throw new PilotError('FILE_HOST_NOT_ENABLED', hostname);
  return url;
}

async function resolveAll(hostname: string, signal: AbortSignal): Promise<string[]> {
  const resolver = new Resolver();
  const onAbort = (): void => resolver.cancel();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    signal.throwIfAborted();
    const query = async (family: 4 | 6): Promise<string[]> => {
      try { return family === 4 ? await resolver.resolve4(hostname) : await resolver.resolve6(hostname); }
      catch (error) {
        const code = error instanceof Error && 'code' in error ? error.code : undefined;
        if (code === 'ENODATA' || code === 'ENOTFOUND') return [];
        throw new PilotError('FILE_DOWNLOAD_FAILED');
      }
    };
    const answers = await Promise.all([query(4), query(6)]);
    signal.throwIfAborted();
    return answers.flat();
  } finally {
    signal.removeEventListener('abort', onAbort);
    resolver.cancel();
  }
}

const defaults: DownloadDependencies = { resolve: resolveAll, request: httpsRequest };

export async function downloadFile(
  input: string,
  hosts: ReadonlySet<string>,
  budget: ByteBudget,
  signal: AbortSignal,
  dependencies: DownloadDependencies = defaults,
): Promise<ArrayBuffer> {
  const url = permittedUrl(input, hosts);
  const controller = new AbortController();
  const onCancel = (): void => controller.abort(new PilotError('CANCELLED'));
  const timer = setTimeout(() => controller.abort(new PilotError('DOWNLOAD_TIMEOUT')), LIMITS.downloadMs);
  signal.addEventListener('abort', onCancel, { once: true });
  if (signal.aborted) onCancel();
  try {
    controller.signal.throwIfAborted();
    const answers = await dependencies.resolve(url.hostname, controller.signal);
    controller.signal.throwIfAborted();
    const addresses = answers.map(publicAddress);
    if (addresses.length === 0 || addresses.some(address => !address)) throw new PilotError('FILE_URL_NOT_ALLOWED');
    const chosen = addresses[0]!;
    if (!chosen) throw new PilotError('FILE_URL_NOT_ALLOWED');
    return await new Promise<ArrayBuffer>((resolve, reject) => {
      let finished = false;
      let response: IncomingMessage | undefined;
      const chunks: Buffer[] = [];
      let bytes = 0;
      const cleanup = (): void => {
        controller.signal.removeEventListener('abort', onAbort);
        response?.destroy();
        request.destroy();
        chunks.length = 0;
      };
      const fail = (error: PilotError): void => {
        if (finished) return;
        finished = true;
        cleanup();
        reject(error);
      };
      const onAbort = (): void => fail(controller.signal.reason instanceof PilotError
        ? controller.signal.reason : new PilotError('CANCELLED'));
      const request = dependencies.request(url, {
        method: 'GET', agent: false, family: chosen.family,
        servername: url.hostname, rejectUnauthorized: true,
        lookup: (_hostname, _options, callback) => callback(null, chosen.address, chosen.family),
      }, incoming => {
        response = incoming;
        if (incoming.statusCode !== 200 || incoming.headers['content-encoding'] !== undefined) {
          fail(new PilotError('FILE_DOWNLOAD_FAILED'));
          return;
        }
        const length = incoming.headers['content-length'];
        if (length !== undefined && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) ||
            Number(length) > LIMITS.fileBytes || Number(length) > budget.remaining)) {
          fail(new PilotError('FILE_TOO_LARGE'));
          return;
        }
        incoming.on('data', (chunk: Buffer) => {
          if (finished) return;
          if (chunk.byteLength > LIMITS.fileBytes - bytes || chunk.byteLength > budget.remaining) {
            fail(new PilotError('FILE_TOO_LARGE'));
            return;
          }
          bytes += chunk.byteLength;
          budget.remaining -= chunk.byteLength;
          chunks.push(chunk);
        });
        incoming.on('error', () => fail(new PilotError('FILE_DOWNLOAD_FAILED')));
        incoming.on('aborted', () => fail(new PilotError('FILE_DOWNLOAD_FAILED')));
        incoming.on('end', () => {
          if (finished) return;
          if (bytes === 0 || (length !== undefined && Number(length) !== bytes)) {
            fail(new PilotError('FILE_DOWNLOAD_FAILED'));
            return;
          }
          const output = new Uint8Array(bytes);
          let offset = 0;
          for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
          finished = true;
          cleanup();
          resolve(output.buffer);
        });
      });
      controller.signal.addEventListener('abort', onAbort, { once: true });
      request.on('error', () => fail(new PilotError('FILE_DOWNLOAD_FAILED')));
      if (controller.signal.aborted) onAbort(); else request.end();
    });
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason instanceof PilotError) throw controller.signal.reason;
    throw error instanceof PilotError ? error : new PilotError('FILE_DOWNLOAD_FAILED');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onCancel);
  }
}
