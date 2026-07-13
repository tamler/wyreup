import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeChainSteps, encodeChainSteps } from '../src/components/runners/chainUrl';
import { JOBS } from '../src/data/jobs';

const RESERVED_ROUTES = new Set([
  'tools',
  'about',
  'pro',
  'cli',
  'mcp',
  'skill',
  'settings',
  'toolbelt',
  'triggers',
  'chain',
  'category',
  'legal',
  'account',
  'admin',
  'share',
  'share-receive',
  '404',
]);

describe('job landing pages', () => {
  it('uses unreserved kebab-case slugs', () => {
    for (const job of JOBS) {
      expect(job.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(RESERVED_ROUTES.has(job.slug), job.slug).toBe(false);
    }
  });

  it('round-trips the launcher job subset and chain tool IDs', () => {
    for (const job of JOBS) {
      const serialized = {
        slug: job.slug,
        title: job.title,
        action: job.action,
        acceptMimes: job.acceptMimes,
      };
      const roundTripped = JSON.parse(JSON.stringify(serialized)) as typeof serialized;

      expect(roundTripped).toEqual(serialized);
      if (roundTripped.action.kind === 'chain') {
        const encoded = encodeChainSteps(roundTripped.action.steps);
        expect(encoded).not.toBe('');
        expect(decodeChainSteps(encoded)?.map((step) => step.toolId)).toEqual(
          roundTripped.action.steps.map((step) => step.toolId),
        );
      }
    }
  });

  it('keeps jobs sourced into the sitemap', () => {
    const source = readFileSync(new URL('../src/pages/sitemap.xml.ts', import.meta.url), 'utf8');

    expect(source).toMatch(/import\s+\{\s*JOBS\s*\}\s+from\s+['"]\.\.\/data\/jobs['"]/);
  });
});
