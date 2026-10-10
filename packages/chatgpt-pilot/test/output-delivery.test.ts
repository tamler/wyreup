import assert from 'node:assert/strict';
import { test } from 'vitest';
import { configuredOutputOrigins, inspectDownloadUrl } from '../scripts/output-delivery.mjs';

const origin = 'https://files.example.test';
const signed = origin + '/download/PRIVATE_PATH_CANARY?signature=%2F%2b%3D&file_id=PRIVATE_ID_CANARY';

test('default empty and exact bounded frozen output configuration', () => {
  for (const raw of [undefined, '']) {
    const origins = configuredOutputOrigins(raw);
    assert.deepEqual(origins, []);
    assert(Object.isFrozen(origins));
  }
  const origins = configuredOutputOrigins(origin + ',https://second.example.test');
  assert.deepEqual(origins, [origin, 'https://second.example.test']);
  assert(Object.isFrozen(origins));
  assert.throws(() => Array.prototype.push.call(origins, 'https://evil.example.test'));
});

test('unsafe, duplicate, noncanonical, and over-bound configured origins fail closed', () => {
  for (const value of ['http://files.example.test', origin + ':443', origin + '/', origin + '?x=1', origin + '#x',
    'https://FILES.EXAMPLE.TEST', 'https://*.example.test', 'https://localhost', 'https://127.0.0.1', 'https://[::1]',
    'https://files.example.test.', 'https://-bad.example.test', 'https://bad-.example.test', 'https://a..example.test',
    'https://user@files.example.test', ' ' + origin, origin + ' ', origin + ',' + origin,
    Array.from({ length: 5 }, (_, i) => 'https://f' + i + '.example.test').join(','), 'x'.repeat(1025)]) {
    assert.throws(() => configuredOutputOrigins(value), 'Configuration accepted unsafe origin');
  }
});

test('allowed signed strings retain exact bytes including host case and signed query', () => {
  const origins = configuredOutputOrigins(origin);
  for (const value of [signed, signed.replace('files.example.test', 'FILES.EXAMPLE.TEST')]) {
    const inspected = inspectDownloadUrl(value, origins);
    assert.deepEqual(inspected, { origin, url: value });
    assert(Object.isFrozen(inspected));
    assert.equal(inspectDownloadUrl(value, origins).url, value, 'Synchronous revalidation changed signed URL bytes');
  }
});

test('default denied and suffix lookalike expose only a bounded origin, never the URL', () => {
  const cases: Array<[string, readonly string[], string]> = [[signed, [], origin],
    [signed.replace('files.example.test', 'files.example.test.evil.invalid'), [origin], 'https://files.example.test.evil.invalid']];
  for (const [value, allowed, expected] of cases) {
    const inspected = inspectDownloadUrl(value, allowed);
    assert.deepEqual(inspected, { origin: expected });
    assert(Object.isFrozen(inspected));
    assert(!Object.hasOwn(inspected, 'url'));
    assert(!JSON.stringify(inspected).includes('PRIVATE_'));
  }
});

test('raw ambiguity, controls and unsafe destinations are rejected without URL leakage', () => {
  const values = [null, {}, [], '', 'x'.repeat(8193), signed.replace('https:', 'http:'),
    'javascript:alert(1)', 'data:text/plain,PRIVATE_PATH_CANARY', 'blob:' + signed,
    signed.replace('https://', 'https://user:pass@'), signed + '#PRIVATE_FRAGMENT_CANARY',
    signed.replace(origin, origin + ':443'), signed.replace(origin, origin + ':444'),
    signed.replace(origin, 'https://files.example.test.'), signed.replace(origin, 'https://127.0.0.1'),
    signed.replace(origin, 'https://[::1]'), signed.replace(origin, 'https://localhost'),
    'https:\\files.example.test/download', origin + '\\download?signature=PRIVATE_QUERY_CANARY',
    'https://files.example.test\\@evil.invalid/download', 'https://files.example.test%2Fevil.invalid/download',
    signed.replace('files', 'fi\tles'), signed.replace('files', 'fi\nles'), signed.replace('files', 'fi\rles'),
    '\u0000' + signed, signed + '\u007f', signed + '\u001f', ' ' + signed, signed + ' ',
    signed.replace('files', 'fi les'), signed.replace('/download', '/down\u00a0load')];
  for (const value of values) {
    assert.throws(() => inspectDownloadUrl(value, [origin]), error => {
      assert(error instanceof Error);
      assert(!/PRIVATE_|signature=|https:|files\.example\.test/.test(error.message), 'Rejected signed URL leaked into error');
      return true;
    }, 'Unsafe raw URL accepted');
  }
});
