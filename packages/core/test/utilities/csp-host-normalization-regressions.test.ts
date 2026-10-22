import { describe, expect, it } from 'vitest';
import { cspHeader } from '../../src/utilities/text-developer.js';

const params = (sources: string) => ({
  directivesJson: JSON.stringify([{ directive: 'script-src', sources }]),
  reportOnly: false,
});

describe('CSP raw host spelling before WHATWG normalization', () => {
  it.each([
    'https://%65xample.com',
    'https://exam%70le.com/',
    'https://example%2ecom:443',
    'https://%62%C3%BCcher.example',
  ])('refuses a percent-encoded host %s', (source) => {
    expect(() => cspHeader(params(source))).toThrow(/origin|host|source|HTTPS/i);
  });

  it.each([
    'https://example.com\t.evil.com',
    'https://example.com\n.evil.com',
    'https://example.com\r.evil.com',
    'https://example.com\u0000.evil.com',
  ])('retains raw control-character refusal %s', (source) => {
    expect(() => cspHeader(params(source))).toThrow(/control|origin|host|source|HTTPS/i);
  });

  it.each([
    ['https://example.com', 'https://example.com'],
    ['HTTPS://EXAMPLE.com:443/', 'https://example.com'],
    ['https://example.com:8443/', 'https://example.com:8443'],
    ['https://bücher.example/', 'https://xn--bcher-kva.example'],
    ['HTTPS://BÜCHER.example:443/', 'https://xn--bcher-kva.example'],
  ])('keeps supported ASCII/IDN origin %s', (source, normalized) => {
    expect(cspHeader(params(source))).toBe(`Content-Security-Policy: script-src ${normalized}`);
  });
});
