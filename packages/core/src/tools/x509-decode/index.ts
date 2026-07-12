import type { ToolModule, ToolRunContext } from '../../types.js';
import { defaultX509DecodeParams, type X509DecodeParams, type X509DecodeResult } from './types.js';

export type { X509DecodeParams, X509DecodeResult } from './types.js';
export { defaultX509DecodeParams } from './types.js';

type MetadataKey = string | symbol;
type MetadataTarget = object;

interface ReflectMetadataApi {
  defineMetadata?: (
    metadataKey: MetadataKey,
    metadataValue: unknown,
    target: MetadataTarget,
    propertyKey?: MetadataKey,
  ) => void;
  getOwnMetadata?: (
    metadataKey: MetadataKey,
    target: MetadataTarget,
    propertyKey?: MetadataKey,
  ) => unknown;
  hasOwnMetadata?: (
    metadataKey: MetadataKey,
    target: MetadataTarget,
    propertyKey?: MetadataKey,
  ) => boolean;
  getMetadata?: (
    metadataKey: MetadataKey,
    target: MetadataTarget,
    propertyKey?: MetadataKey,
  ) => unknown;
  hasMetadata?: (
    metadataKey: MetadataKey,
    target: MetadataTarget,
    propertyKey?: MetadataKey,
  ) => boolean;
  metadata?: (metadataKey: MetadataKey, metadataValue: unknown) => {
    (target: MetadataTarget, propertyKey?: MetadataKey): void;
  };
}

function ensureReflectMetadata(): void {
  const reflect = Reflect as typeof Reflect & ReflectMetadataApi;
  if (
    reflect.defineMetadata &&
    reflect.getOwnMetadata &&
    reflect.hasOwnMetadata &&
    reflect.getMetadata &&
    reflect.hasMetadata &&
    reflect.metadata
  ) {
    return;
  }

  const classKey = Symbol('class-metadata');
  const store = new WeakMap<MetadataTarget, Map<MetadataKey, Map<MetadataKey, unknown>>>();
  const valuesFor = (target: MetadataTarget, propertyKey?: MetadataKey) => {
    let targetValues = store.get(target);
    if (!targetValues) {
      targetValues = new Map();
      store.set(target, targetValues);
    }
    const key = propertyKey ?? classKey;
    let values = targetValues.get(key);
    if (!values) {
      values = new Map();
      targetValues.set(key, values);
    }
    return values;
  };

  reflect.defineMetadata = (key, value, target, propertyKey) => {
    valuesFor(target, propertyKey).set(key, value);
  };
  reflect.getOwnMetadata = (key, target, propertyKey) =>
    valuesFor(target, propertyKey).get(key);
  reflect.hasOwnMetadata = (key, target, propertyKey) =>
    valuesFor(target, propertyKey).has(key);
  reflect.getMetadata = (key, target, propertyKey) => {
    let current: object | null = target;
    while (current) {
      if (reflect.hasOwnMetadata!(key, current, propertyKey)) {
        return reflect.getOwnMetadata!(key, current, propertyKey);
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
    return undefined;
  };
  reflect.hasMetadata = (key, target, propertyKey) =>
    reflect.getMetadata!(key, target, propertyKey) !== undefined;
  reflect.metadata = (key, value) => (target, propertyKey) => {
    reflect.defineMetadata!(key, value, target, propertyKey);
  };
}

function toFingerprint(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0'))
    .join(':')
    .toUpperCase();
}

function publicKeySize(algorithm: Algorithm): number | null {
  const details = algorithm as Algorithm & { modulusLength?: unknown; namedCurve?: unknown };
  if (typeof details.modulusLength === 'number') return details.modulusLength;
  if (typeof details.namedCurve === 'string') {
    const match = /(\d+)$/.exec(details.namedCurve);
    if (match) return Number(match[1]);
  }
  if (algorithm.name === 'Ed25519' || algorithm.name === 'X25519') return 255;
  if (algorithm.name === 'Ed448' || algorithm.name === 'X448') return 448;
  return null;
}

export const x509Decode: ToolModule<X509DecodeParams> = {
  id: 'x509-decode',
  slug: 'x509-decode',
  name: 'X.509 Certificate Decoder',
  description:
    'Decode a PEM or DER X.509 certificate into a readable JSON report with identity, validity, SAN, key, signature, fingerprint, and self-signed details.',
  llmDescription:
    'Inspect one PEM or DER X.509 certificate and return flat JSON metadata: subject, issuer, serial, validity and days to expiry, SAN strings, public-key algorithm and size, signature algorithm, SHA-1/SHA-256 fingerprints, and subject-equals-issuer status.',
  category: 'inspect',
  categories: ['inspect', 'dev'],
  keywords: [
    'x509',
    'certificate',
    'pem',
    'der',
    'tls',
    'ssl',
    'decode',
    'inspect',
    'fingerprint',
    'san',
  ],

  input: {
    accept: [
      'application/x-pem-file',
      'application/pkix-cert',
      'application/x-x509-ca-cert',
      'text/plain',
    ],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: { mime: 'application/json', multiple: false },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultX509DecodeParams,
  paramSchema: {},

  async run(inputs: File[], _params: X509DecodeParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('x509-decode accepts exactly one certificate.');
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'loading-deps', percent: 10, message: 'Loading X.509 decoder' });
    ensureReflectMetadata();
    const { SubjectAlternativeNameExtension, X509Certificate } = await import('@peculiar/x509');

    ctx.onProgress({ stage: 'processing', percent: 35, message: 'Reading certificate' });
    const buffer = await inputs[0]!.arrayBuffer();
    const text = new TextDecoder().decode(buffer);
    const encoded = text.includes('-----BEGIN') ? text.trim() : buffer;

    try {
      const certificate = new X509Certificate(encoded);
      const subjectAltName = certificate.getExtension(SubjectAlternativeNameExtension);
      const signature = certificate.signatureAlgorithm;
      const signatureAlgorithm = signature.hash?.name
        ? `${signature.hash.name} with ${signature.name}`
        : signature.name;

      ctx.onProgress({ stage: 'processing', percent: 70, message: 'Computing fingerprints' });
      const [sha1, sha256] = await Promise.all([
        certificate.getThumbprint('SHA-1'),
        certificate.getThumbprint('SHA-256'),
      ]);
      const result: X509DecodeResult = {
        subject: certificate.subject,
        issuer: certificate.issuer,
        serial: certificate.serialNumber,
        notBefore: certificate.notBefore.toISOString(),
        notAfter: certificate.notAfter.toISOString(),
        daysUntilExpiry: Math.ceil((certificate.notAfter.getTime() - Date.now()) / 86_400_000),
        subjectAltNames:
          subjectAltName?.names.items.map((name) => `${name.type.toUpperCase()}:${name.value}`) ?? [],
        publicKeyAlgorithm: certificate.publicKey.algorithm.name,
        publicKeySize: publicKeySize(certificate.publicKey.algorithm),
        signatureAlgorithm,
        sha1Fingerprint: toFingerprint(sha1),
        sha256Fingerprint: toFingerprint(sha256),
        isSelfSigned: certificate.subject === certificate.issuer,
      };

      ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
      return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
    } catch (error) {
      throw new Error(`Invalid X.509 certificate: ${(error as Error).message}`);
    }
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
