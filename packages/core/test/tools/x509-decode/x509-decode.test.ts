import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { x509Decode } from '../../../src/tools/x509-decode/index.js';
import type { X509DecodeResult } from '../../../src/tools/x509-decode/types.js';
import type { ToolRunContext } from '../../../src/types.js';

type MetadataKey = string | symbol;

function installReflectMetadata(): void {
  const reflect = Reflect as typeof Reflect & {
    defineMetadata?: (key: MetadataKey, value: unknown, target: object) => void;
    getOwnMetadata?: (key: MetadataKey, target: object) => unknown;
    hasOwnMetadata?: (key: MetadataKey, target: object) => boolean;
    getMetadata?: (key: MetadataKey, target: object) => unknown;
    hasMetadata?: (key: MetadataKey, target: object) => boolean;
    metadata?: (key: MetadataKey, value: unknown) => (target: object) => void;
  };
  if (reflect.getMetadata) return;

  const values = new WeakMap<object, Map<MetadataKey, unknown>>();
  const forTarget = (target: object) => {
    let targetValues = values.get(target);
    if (!targetValues) {
      targetValues = new Map();
      values.set(target, targetValues);
    }
    return targetValues;
  };
  reflect.defineMetadata = (key, value, target) => forTarget(target).set(key, value);
  reflect.getOwnMetadata = (key, target) => forTarget(target).get(key);
  reflect.hasOwnMetadata = (key, target) => forTarget(target).has(key);
  reflect.getMetadata = (key, target) => {
    let current: object | null = target;
    while (current) {
      if (reflect.hasOwnMetadata!(key, current)) return reflect.getOwnMetadata!(key, current);
      current = Object.getPrototypeOf(current) as object | null;
    }
    return undefined;
  };
  reflect.hasMetadata = (key, target) => reflect.getMetadata!(key, target) !== undefined;
  reflect.metadata = (key, value) => (target) => reflect.defineMetadata!(key, value, target);
}

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

let certificatePem: string;
let certificateDer: ArrayBuffer;

beforeAll(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'));
  installReflectMetadata();
  const { SubjectAlternativeNameExtension, X509CertificateGenerator } = await import(
    '@peculiar/x509'
  );
  const keys = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const certificate = await X509CertificateGenerator.createSelfSigned({
    name: 'CN=Wyreup Test,O=Wyreup',
    keys,
    serialNumber: '01AB23',
    notBefore: new Date('2026-01-01T00:00:00.000Z'),
    notAfter: new Date('2027-01-01T00:00:00.000Z'),
    signingAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    extensions: [
      new SubjectAlternativeNameExtension([
        { type: 'dns', value: 'wyreup.test' },
        { type: 'dns', value: 'www.wyreup.test' },
        { type: 'ip', value: '127.0.0.1' },
      ]),
    ],
  });
  certificatePem = certificate.toString('pem');
  certificateDer = certificate.rawData;
});

afterAll(() => {
  vi.useRealTimers();
});

async function decode(parts: BlobPart[], type: string): Promise<{ blob: Blob; report: X509DecodeResult }> {
  const file = new File(parts, 'certificate', { type });
  const [blob] = (await x509Decode.run([file], {}, makeCtx())) as Blob[];
  return { blob: blob!, report: JSON.parse(await blob!.text()) as X509DecodeResult };
}

describe('x509-decode — metadata', () => {
  it('declares inspect and developer metadata', () => {
    expect(x509Decode.id).toBe('x509-decode');
    expect(x509Decode.category).toBe('inspect');
    expect(x509Decode.categories).toEqual(['inspect', 'dev']);
    expect(x509Decode.cost).toBe('free');
    expect(x509Decode.defaults).toEqual({});
    expect(x509Decode.llmDescription).toBeTruthy();
  });
});

describe('x509-decode — run()', () => {
  it('decodes every requested field from a PEM certificate', async () => {
    const { blob, report } = await decode([certificatePem], 'application/x-pem-file');

    expect(blob.type).toBe('application/json');
    expect(report.subject).toBe('CN=Wyreup Test, O=Wyreup');
    expect(report.issuer).toBe(report.subject);
    expect(report.serial).toBe('01ab23');
    expect(report.notBefore).toBe('2026-01-01T00:00:00.000Z');
    expect(report.notAfter).toBe('2027-01-01T00:00:00.000Z');
    expect(report.daysUntilExpiry).toBe(214);
    expect(report.subjectAltNames).toEqual([
      'DNS:wyreup.test',
      'DNS:www.wyreup.test',
      'IP:127.0.0.1',
    ]);
    expect(report.publicKeyAlgorithm).toBe('RSASSA-PKCS1-v1_5');
    expect(report.publicKeySize).toBe(2048);
    expect(report.signatureAlgorithm).toBe('SHA-256 with RSASSA-PKCS1-v1_5');
    expect(report.sha1Fingerprint).toMatch(/^(?:[0-9A-F]{2}:){19}[0-9A-F]{2}$/);
    expect(report.sha256Fingerprint).toMatch(/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(report.isSelfSigned).toBe(true);
  });

  it('decodes raw DER input', async () => {
    const { report } = await decode([certificateDer], 'application/pkix-cert');

    expect(report.subject).toBe('CN=Wyreup Test, O=Wyreup');
    expect(report.serial).toBe('01ab23');
    expect(report.publicKeySize).toBe(2048);
  });

  it('rejects invalid certificate input', async () => {
    const file = new File(['not a certificate'], 'invalid.pem', { type: 'text/plain' });
    await expect(x509Decode.run([file], {}, makeCtx())).rejects.toThrow(
      'Invalid X.509 certificate',
    );
  });
});
