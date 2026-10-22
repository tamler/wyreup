import { Temporal } from '@js-temporal/polyfill';
import { toASCII } from 'tr46';
import { cloneUtilityJson } from '../utilities/common.js';

const encoder = new TextEncoder();
export const DOMAIN_REGISTRATION_LIMITATIONS =
  'Registration age can describe the current registration, rather than first-ever use. Calendar age compares UTC dates; elapsed days count full 24-hour periods.';
export const DOMAIN_STATUSES = [
  'ok',
  'unknown',
  'not-found',
  'unsupported-tld',
  'unsupported-redirect',
  'rate-limited',
  'provider-error',
  'malformed',
] as const;
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];
export interface DomainRegistration {
  domain: string;
  status: DomainStatus;
  observedAt: string;
  registrationAt: string | null;
  ageDays: number | null;
  calendarAge: { years: number; months: number; days: number } | null;
  otherRegistrationInstants: string[];
  ignoredInvalidRegistrationCount: number;
  provider: string | null;
  sourceURL: string | null;
  limitations: string;
}

export function canonicalizeDomain(input: unknown): string {
  if (typeof input !== 'string') throw new Error('Enter one domain name.');
  let domain = input.trim();
  if (encoder.encode(domain).length > 253) throw new Error('Domain input exceeds 253 UTF-8 bytes.');
  if (domain.endsWith('.')) domain = domain.slice(0, -1);
  if (
    !domain ||
    [...domain].some((character) => {
      const code = character.codePointAt(0)!;
      return code < 33 || code === 127 || /\s/u.test(character) || '%/\\@:?#*'.includes(character);
    })
  )
    throw new Error('Enter a domain without a URL, port, credentials, whitespace or wildcard.');
  const ascii = toASCII(domain, {
    checkHyphens: true,
    checkBidi: true,
    checkJoiners: true,
    useSTD3ASCIIRules: true,
    verifyDNSLength: true,
    transitionalProcessing: false,
    ignoreInvalidPunycode: false,
  })?.toLowerCase();
  if (!ascii) throw new Error('Domain fails strict IDNA validation.');
  const labels = ascii.split('.');
  if (
    labels.length < 2 ||
    labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    !/[a-z]/.test(labels.at(-1)!) ||
    ascii.length > 253
  )
    throw new Error('Use a public multi-label domain, not an IP address or local hostname.');
  return ascii;
}

export function registrationInstant(value: unknown): Temporal.Instant {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  )
    throw new Error('Invalid registration timestamp.');
  return Temporal.Instant.from(value);
}

export function domainStatusResult(
  domain: string,
  status: DomainStatus,
  now: Temporal.Instant,
  provider: string | null = null,
  sourceURL: string | null = null,
): DomainRegistration {
  return {
    domain,
    status,
    observedAt: now.toString(),
    registrationAt: null,
    ageDays: null,
    calendarAge: null,
    otherRegistrationInstants: [],
    ignoredInvalidRegistrationCount: 0,
    provider,
    sourceURL,
    limitations: DOMAIN_REGISTRATION_LIMITATIONS,
  };
}

export function extractRegistrationAge(
  response: unknown,
  domain: string,
  now: Temporal.Instant,
  provider: string,
  sourceURL: string,
): DomainRegistration {
  if (canonicalizeDomain(domain) !== domain) throw new Error('Expected a canonical domain.');
  const data = cloneUtilityJson(response, '$rdap');
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Invalid RDAP domain object.');
  const result = domainStatusResult(domain, 'malformed', now, provider, sourceURL);
  if (data.objectClassName !== 'domain' || typeof data.ldhName !== 'string') return result;
  try {
    if (canonicalizeDomain(data.ldhName) !== domain) return result;
  } catch {
    return result;
  }
  if (Object.hasOwn(data, 'unicodeName')) {
    try {
      if (canonicalizeDomain(data.unicodeName) !== domain) return result;
    } catch {
      return result;
    }
  }
  if (data.events === undefined) return { ...result, status: 'unknown' };
  if (!Array.isArray(data.events)) return result;
  const instants: Temporal.Instant[] = [];
  let count = 0,
    invalid = 0;
  for (const event of data.events) {
    if (
      !event ||
      typeof event !== 'object' ||
      Array.isArray(event) ||
      event.eventAction !== 'registration'
    )
      continue;
    if (++count > 32) return result;
    try {
      const instant = registrationInstant(event.eventDate);
      if (Temporal.Instant.compare(instant, now) > 0) return result;
      instants.push(instant);
    } catch {
      invalid++;
    }
  }
  result.ignoredInvalidRegistrationCount = invalid;
  if (!instants.length) return { ...result, status: 'unknown' };
  instants.sort((a, b) => Temporal.Instant.compare(a, b));
  const registration = instants[0]!;
  const duration = registration
    .toZonedDateTimeISO('UTC')
    .toPlainDate()
    .until(now.toZonedDateTimeISO('UTC').toPlainDate(), { largestUnit: 'years' });
  return {
    ...result,
    status: 'ok',
    registrationAt: registration.toString(),
    ageDays: Number((now.epochNanoseconds - registration.epochNanoseconds) / 86400000000000n),
    calendarAge: { years: duration.years, months: duration.months, days: duration.days },
    otherRegistrationInstants: instants.slice(1).map((instant) => instant.toString()),
  };
}

export function validateRegistrationSource(
  provider: unknown,
  sourceURL: unknown,
  domain: string,
): void {
  if (provider === null && sourceURL === null) return;
  if (
    typeof provider !== 'string' ||
    canonicalizeDomain(provider) !== provider ||
    typeof sourceURL !== 'string' ||
    sourceURL.length > 2048
  )
    throw new Error('Invalid registration source.');
  const url = new URL(sourceURL);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== provider ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith('/domain/' + domain)
  )
    throw new Error('Invalid registration source URL.');
}

export function validateDomainRegistration(
  value: unknown,
  expectedDomain: string,
): DomainRegistration {
  const sanitized = cloneUtilityJson(value, '$response');
  if (
    !sanitized ||
    typeof sanitized !== 'object' ||
    Array.isArray(sanitized) ||
    encoder.encode(JSON.stringify(sanitized)).length > 16384
  )
    throw new Error('Invalid bounded registration response.');
  const data = sanitized as Record<string, unknown>;
  if (
    Object.keys(data).sort().join(',') !==
      'ageDays,calendarAge,domain,ignoredInvalidRegistrationCount,limitations,observedAt,otherRegistrationInstants,provider,registrationAt,sourceURL,status' ||
    data.domain !== expectedDomain ||
    canonicalizeDomain(data.domain) !== expectedDomain ||
    typeof data.status !== 'string' ||
    !DOMAIN_STATUSES.includes(data.status as DomainStatus) ||
    data.limitations !== DOMAIN_REGISTRATION_LIMITATIONS ||
    !Number.isInteger(data.ignoredInvalidRegistrationCount) ||
    typeof data.ignoredInvalidRegistrationCount !== 'number' ||
    data.ignoredInvalidRegistrationCount < 0 ||
    data.ignoredInvalidRegistrationCount > 32 ||
    !Array.isArray(data.otherRegistrationInstants) ||
    data.otherRegistrationInstants.length > 31
  )
    throw new Error('Invalid registration response fields.');
  validateRegistrationSource(data.provider, data.sourceURL, expectedDomain);
  const now = registrationInstant(data.observedAt);
  const otherValues = data.otherRegistrationInstants as unknown[];
  const others = otherValues.map(registrationInstant);
  if (others.some((instant) => Temporal.Instant.compare(instant, now) > 0))
    throw new Error('Future registration event in response.');
  if (data.status === 'ok') {
    if (
      data.provider === null ||
      data.sourceURL === null ||
      typeof data.registrationAt !== 'string'
    )
      throw new Error('Successful age requires registration and source.');
    const registration = registrationInstant(data.registrationAt);
    const expected = extractRegistrationAge(
      {
        objectClassName: 'domain',
        ldhName: expectedDomain,
        events: [data.registrationAt, ...otherValues].map((eventDate) => ({
          eventAction: 'registration',
          eventDate,
        })),
      },
      expectedDomain,
      now,
      data.provider as string,
      data.sourceURL as string,
    );
    if (
      expected.status !== 'ok' ||
      expected.registrationAt !== registration.toString() ||
      expected.ageDays !== data.ageDays ||
      JSON.stringify(expected.calendarAge) !== JSON.stringify(data.calendarAge) ||
      JSON.stringify(expected.otherRegistrationInstants) !==
        JSON.stringify(data.otherRegistrationInstants)
    )
      throw new Error('Registration age does not match its source timestamps.');
  } else if (
    data.registrationAt !== null ||
    data.ageDays !== null ||
    data.calendarAge !== null ||
    others.length
  )
    throw new Error('Unknown or failed lookup cannot claim an age.');
  return data as unknown as DomainRegistration;
}
