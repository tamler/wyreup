import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { canonicalizeDomain, domainStatusResult, extractRegistrationAge, registrationInstant, validateDomainRegistration } from '../../src/lib/domain-registration.js';

const domain = 'example.com', provider = 'rdap.example.net', source = 'https://rdap.example.net/v1/domain/example.com';
const now = Temporal.Instant.from('2025-01-01T11:00:00Z');
const rdap = (...dates: string[]) => ({ objectClassName: 'domain', ldhName: 'EXAMPLE.COM', events: dates.map(eventDate => ({ eventAction: 'registration', eventDate })) });

describe('strict portable domain and registration data', () => {
  it('uses nontransitional IDNA and bounds both source and DNS representation', () => {
    expect(canonicalizeDomain(' EXAMPLE.COM. ')).toBe('example.com');
    expect(canonicalizeDomain('faß.de')).toBe('xn--fa-hia.de');
    expect(canonicalizeDomain('example。com')).toBe('example.com');
    for (const input of ['', 'localhost', '127.0.0.1', '[::1]', 'example.com..', 'https://example.com', 'example.com:443', 'user@example.com', '*.example.com', 'example%2f.com', 'example.com/x', 'example\\.com', 'exa\tmple.com', 'bad_.com', '-bad.com', 'bad-.com', 'xn--.com', 'a'.repeat(64) + '.com', '中'.repeat(90) + '.com'])
      expect(() => canonicalizeDomain(input)).toThrow();
  });

  it('retains timestamp nanoseconds, rejects invalid dates and detects any future event', () => {
    expect(registrationInstant('2024-01-01T13:00:00.123456789+01:00').toString()).toBe('2024-01-01T12:00:00.123456789Z');
    for (const date of ['2024-02-30T00:00:00Z', '2024-01-01', '2024-01-01T00:00:60Z', '2024-01-01T00:00:00.1234567890Z', '2024-01-01T24:00:00Z', '2024-01-01T00:00:00+24:00'])
      expect(() => registrationInstant(date)).toThrow();
    expect(extractRegistrationAge(rdap('2024-01-01T00:00:00Z', '2025-01-01T11:00:00.000000001Z'), domain, now, provider, source).status).toBe('malformed');
  });

  it('distinguishes full elapsed days from UTC calendar dates and minimizes registrant details', () => {
    const data = { ...rdap('2024-01-01T12:00:00Z', '2024-06-01T00:00:00Z', 'bad'), entities: [{ vcardArray: ['secret@example.com'] }], links: [{ href: 'https://private.example' }] };
    const result = extractRegistrationAge(data, domain, now, provider, source);
    expect(result).toMatchObject({ status: 'ok', registrationAt: '2024-01-01T12:00:00Z', ageDays: 365, calendarAge: { years: 1, months: 0, days: 0 }, otherRegistrationInstants: ['2024-06-01T00:00:00Z'], ignoredInvalidRegistrationCount: 1 });
    expect(JSON.stringify(result)).not.toContain('secret@example.com');
    expect(JSON.stringify(result)).not.toContain('private.example');
    expect(validateDomainRegistration(result, domain)).toEqual(result);
    const leap = extractRegistrationAge(rdap('2024-02-29T00:00:00Z'), domain, Temporal.Instant.from('2025-02-28T00:00:00Z'), provider, source);
    expect(leap.calendarAge).toEqual({ years: 0, months: 11, days: 30 });
    const month = extractRegistrationAge(rdap('2024-01-31T00:00:00Z'), domain, Temporal.Instant.from('2024-02-29T00:00:00Z'), provider, source);
    expect(month.calendarAge).toEqual({ years: 0, months: 0, days: 29 });
  });

  it('reports unknown or malformed instead of inventing a registration age', () => {
    expect(extractRegistrationAge({ objectClassName: 'domain', ldhName: domain }, domain, now, provider, source).status).toBe('unknown');
    expect(extractRegistrationAge(rdap('invalid'), domain, now, provider, source)).toMatchObject({ status: 'unknown', ignoredInvalidRegistrationCount: 1, ageDays: null });
    expect(extractRegistrationAge({ ...rdap('2024-01-01T00:00:00Z'), ldhName: 'other.com' }, domain, now, provider, source).status).toBe('malformed');
    expect(extractRegistrationAge(rdap(...Array.from({ length: 33 }, () => '2024-01-01T00:00:00Z')), domain, now, provider, source).status).toBe('malformed');
    const deep: Record<string, unknown> = {}; deep.self = deep;
    expect(() => extractRegistrationAge(deep, domain, now, provider, source)).toThrow();
  });

  it('rejects mismatched, overclaimed or unsafe public response fields', () => {
    const good = extractRegistrationAge(rdap('2024-01-01T12:00:00Z'), domain, now, provider, source);
    for (const invalid of [{ ...good, ageDays: 366 }, { ...good, domain: 'other.com' }, { ...good, sourceURL: 'javascript:alert(1)' }, { ...good, provider: '127.0.0.1' }, { ...good, extra: true }, { ...good, status: 'unknown' }])
      expect(() => validateDomainRegistration(invalid, domain)).toThrow();
    expect(validateDomainRegistration(domainStatusResult(domain, 'unsupported-tld', now), domain).registrationAt).toBeNull();
  });
});
