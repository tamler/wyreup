import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { selectQualificationRevision, type SourcePin } from './fixtures/domainLifecyclePrimitives';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected root-owned qualification object.');
  return Object.fromEntries(Object.entries(value));
}
function document(name: string) {
  const bytes = readFileSync(new URL(`fixtures/${name}`, import.meta.url));
  const value = record(JSON.parse(bytes.toString('utf8')) as unknown);
  if (value.schemaVersion !== 1 || !Array.isArray(value.revisions)) throw new Error('Expected root-owned qualification document.');
  const rawRows: unknown[] = value.revisions;
  return { bytes, value: { schemaVersion: 1, revisions: rawRows.map(record) } };
}
function pins(row: Record<string, unknown>): SourcePin[] {
  if (!Array.isArray(row.sourcePins)) throw new Error('Expected original source pins.');
  const values: unknown[] = row.sourcePins;
  return values.map(value => {
    const pin = record(value);
    if (typeof pin.path !== 'string' || typeof pin.bytes !== 'number' || typeof pin.sha256 !== 'string') throw new Error('Expected root-owned source pin fields.');
    return { path: pin.path, bytes: pin.bytes, sha256: pin.sha256 };
  });
}
function inputs() {
  const historical = document('domainLifecycleExpectations.json');
  const current = document('domainLifecycleCurrentExpectations.json');
  const matches = current.value.revisions.filter(row => row.revisionId === 'after-source3-suite-lifecycle-178');
  const row = matches[0];
  if (matches.length !== 1 || !row) throw new Error('Expected exactly one approved current row.');
  return { historical, current, row, sources: pins(row) };
}
const digest = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');

it('selects the exact approved current four-source tuple while preserving all historical bytes and row digests', () => {
  const { historical, current, row, sources } = inputs();
  const beforeRows = historical.value.revisions.map(item => digest(JSON.stringify(item)));
  expect(digest(historical.bytes)).toBe('afbde92bf01a7ab1736f065ab60c88c5b38f4b5724f16d7a80e2f7abf4ae8734');
  expect(digest(current.bytes)).toBe('af2413e836aa92e693fe2d69d7bb22d88aacb92bc0b665d43a915bbdc30054f5');
  expect(current.value.revisions).toHaveLength(3);
  const oldRows = current.value.revisions.filter(item => item.revisionId === 'after-source0-followup-browser-binding-0');
  expect(oldRows).toHaveLength(1);
  const oldRow = oldRows[0];
  if (!oldRow) throw new Error('Original current row absent.');
  expect(digest(JSON.stringify(oldRow))).toBe('4b42527913eb8047758349d3f94e2d63c5957bdb637859ea5102c1ef6b0e2049');
  expect(selectQualificationRevision(sources, historical.value, current.value)).toEqual(row);
  expect(historical.value.revisions.map(item => digest(JSON.stringify(item)))).toEqual(beforeRows);
  expect(digest(readFileSync(new URL('fixtures/domainLifecycleExpectations.json', import.meta.url)))).toBe(digest(historical.bytes));
});

it('still resolves each of the three exact historical tuples to its original row', () => {
  const { historical, current } = inputs();
  expect(historical.value.revisions).toHaveLength(3);
  for (const row of historical.value.revisions) {
    expect(selectQualificationRevision(pins(row), historical.value, current.value)).toEqual(row);
  }
});

it.each(['bytes', 'sha256'] as const)('refuses current browser source %s drift without a pair-only fallback', field => {
  const { historical, current, sources } = inputs();
  const browser = sources.find(pin => pin.path === 'productionBrowserHarness.ts');
  if (!browser) throw new Error('Current browser source absent.');
  if (field === 'bytes') browser.bytes++;
  else browser.sha256 = '0'.repeat(64);
  expect(() => selectQualificationRevision(sources, historical.value, current.value)).toThrow('Unknown or ambiguous complete source revision');
});

it('refuses a duplicate complete tuple even when that duplicate is not the requested current tuple', () => {
  const { historical, current, sources } = inputs();
  const first = historical.value.revisions[0];
  if (!first) throw new Error('Historical row absent.');
  historical.value.revisions.push(structuredClone(first));
  expect(() => selectQualificationRevision(sources, historical.value, current.value)).toThrow('Duplicate complete qualification source tuple');
});

it('refuses root pair hashes that disagree with their complete source pins', () => {
  const { historical, current, row, sources } = inputs();
  row.helperSha256 = '0'.repeat(64);
  expect(() => selectQualificationRevision(sources, historical.value, current.value)).toThrow('Qualification row hashes disagree with source pins');
});

it.each(['duplicate', 'unknown'] as const)('refuses %s canonical source names in a row', mode => {
  const { historical, current, row, sources } = inputs();
  const replacement = pins(row);
  const first = replacement[0];
  const last = replacement[replacement.length - 1];
  if (!first || !last) throw new Error('Root row source pins absent.');
  last.path = mode === 'duplicate' ? first.path : 'unreviewed.ts';
  row.sourcePins = replacement;
  expect(() => selectQualificationRevision(sources, historical.value, current.value)).toThrow('Qualification requires exactly the four canonical original source pins');
});

it.each([undefined, { schemaVersion: 2, revisions: [] }, { schemaVersion: 1, revisions: [] }])('refuses a missing or malformed current sidecar %#', current => {
  const { historical, sources } = inputs();
  expect(() => selectQualificationRevision(sources, historical.value, current)).toThrow();
});

it('refuses a malformed SHA256 even in an unselected historical row', () => {
  const { historical, current, sources } = inputs();
  const first = historical.value.revisions[0];
  if (!first) throw new Error('Historical row absent.');
  const replacement = pins(first);
  const pin = replacement[0];
  if (!pin) throw new Error('Historical source pin absent.');
  pin.sha256 = 'not-a-source-digest';
  first.sourcePins = replacement;
  expect(() => selectQualificationRevision(sources, historical.value, current.value)).toThrow('Qualification source SHA256 is malformed');
});
