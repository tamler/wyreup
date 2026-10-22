import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../src/default-registry.js';

type Classification = 'existing-equivalent' | 'new-task' | 'extension';
type Evidence = { command: string; exitCode: number; tests: { file: string; name: string }[] };
type CoverageRow = {
  sourceSlug: string;
  sourceCategory: string;
  classification: Classification;
  wyreupIds: string[];
  engineIds: string[];
  reviewGates: string[];
  implementationStatus: 'pending' | 'verified' | 'unresolved';
  checkEvidence: Evidence | null;
};
const sourceBytes = readFileSync(new URL('../../../docs/CATALOG-SOURCE.json', import.meta.url));
const source = JSON.parse(sourceBytes.toString()) as {
  tools: {
    category: string;
    slug: string;
    classification: Classification;
    existingId: string | null;
  }[];
};
const coverage = JSON.parse(
  readFileSync(new URL('../../../docs/CATALOG-COVERAGE.json', import.meta.url), 'utf8'),
) as { sourceSha256: string; tools: CoverageRow[] };
const PINNED_SOURCE_SHA256 = '7eba81637f787b495498e3de69153fc30014ceb6da335653be27abf8b3f0147e';

function validate(rows: CoverageRow[], registered: Set<string>): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const expected = new Map(source.tools.map((row) => [`${row.category}/${row.slug}`, row]));
  if (rows.length !== 193) problems.push('Expected 193 source rows.');
  for (const row of rows) {
    const key = `${row.sourceCategory}/${row.sourceSlug}`;
    if (seen.has(key)) problems.push(`Duplicate ${key}.`);
    seen.add(key);
    const original = expected.get(key);
    if (!original) problems.push(`Unknown ${key}.`);
    else if (row.classification !== original.classification)
      problems.push(`Classification drift ${key}.`);
    if (!['pending', 'verified', 'unresolved'].includes(row.implementationStatus))
      problems.push(`Invalid status ${key}.`);
    for (const list of [row.wyreupIds, row.engineIds, row.reviewGates]) {
      if (
        !Array.isArray(list) ||
        list.some((item) => typeof item !== 'string' || !item) ||
        new Set(list).size !== list.length
      )
        problems.push(`Invalid references ${key}.`);
    }
    if (row.implementationStatus !== 'verified') {
      if (row.checkEvidence !== null) problems.push(`Unverified evidence ${key}.`);
      continue;
    }
    if (
      !row.wyreupIds.length ||
      !row.engineIds.length ||
      [...row.wyreupIds, ...row.engineIds].some((id) => !registered.has(id))
    )
      problems.push(`Missing registered engine ${key}.`);
    if (row.classification !== 'existing-equivalent' && !row.reviewGates.length)
      problems.push(`Missing review gate ${key}.`);
    const evidence = row.checkEvidence;
    if (
      !evidence ||
      evidence.exitCode !== 0 ||
      !evidence.command ||
      !evidence.tests.length ||
      evidence.tests.some((test) => !/^packages\/.+\.test\.(ts|mjs)$/.test(test.file) || !test.name)
    )
      problems.push(`Missing executed behavior evidence ${key}.`);
  }
  for (const key of expected.keys()) if (!seen.has(key)) problems.push(`Missing ${key}.`);
  return problems;
}

describe('protected competitor coverage ledger', () => {
  const registered = new Set(createDefaultRegistry().tools.map((tool) => tool.id));
  it('pins the independently captured source identity and classifications', () => {
    expect(createHash('sha256').update(sourceBytes).digest('hex')).toBe(PINNED_SOURCE_SHA256);
    expect(coverage.sourceSha256).toBe(PINNED_SOURCE_SHA256);
    expect(source.tools).toHaveLength(193);
    expect(new Set(source.tools.map((row) => `${row.category}/${row.slug}`)).size).toBe(193);
    expect(source.tools.filter((row) => row.classification === 'new-task')).toHaveLength(138);
    expect(source.tools.filter((row) => row.classification === 'extension')).toHaveLength(14);
    expect(source.tools.filter((row) => row.classification === 'existing-equivalent')).toHaveLength(
      41,
    );
  });
  it('retains every source row without pretending pending work is verified', () => {
    expect(validate(coverage.tools, registered)).toEqual([]);
  });
  it('rejects missing, duplicate, unknown and changed-classification rows', () => {
    expect(validate(coverage.tools.slice(1), registered).length).toBeGreaterThan(0);
    const rows = structuredClone(coverage.tools);
    rows[1] = structuredClone(rows[0]!);
    expect(validate(rows, registered).some((problem) => problem.startsWith('Duplicate'))).toBe(
      true,
    );
    rows[1].sourceSlug = 'invented-competitor-tool';
    expect(validate(rows, registered).some((problem) => problem.startsWith('Unknown'))).toBe(true);
    const drift = structuredClone(coverage.tools);
    drift[0]!.classification = 'new-task';
    expect(
      validate(drift, registered).some((problem) => problem.startsWith('Classification drift')),
    ).toBe(true);
  });
  it('rejects unsupported states and evidence attached to unverified rows', () => {
    const rows = structuredClone(coverage.tools);
    rows[0]!.implementationStatus = 'invented' as CoverageRow['implementationStatus'];
    rows[0]!.checkEvidence = { command: 'not run', exitCode: 0, tests: [] };
    expect(validate(rows, registered).some((problem) => problem.startsWith('Invalid status'))).toBe(
      true,
    );
    expect(
      validate(rows, registered).some((problem) => problem.startsWith('Unverified evidence')),
    ).toBe(true);
  });
  it('requires real registration, review and behavior receipts for verified additions', () => {
    const rows = structuredClone(coverage.tools);
    rows[1]!.implementationStatus = 'verified';
    expect(validate(rows, registered)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Missing registered engine'),
        expect.stringContaining('Missing review gate'),
        expect.stringContaining('Missing executed behavior evidence'),
      ]),
    );
    rows[1]!.wyreupIds = ['fabricated'];
    rows[1]!.engineIds = ['fabricated'];
    expect(
      validate(rows, registered).some((problem) => problem.startsWith('Missing registered engine')),
    ).toBe(true);
  });
});
