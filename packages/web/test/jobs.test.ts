import { describe, expect, it } from 'vitest';
import { createDefaultRegistry, mimeMatches } from '@wyreup/core';
import { JOBS, jobsForMime } from '../src/data/jobs';

const registry = createDefaultRegistry();

function toolIdsFor(job: (typeof JOBS)[number]): string[] {
  return job.action.kind === 'tool'
    ? [job.action.toolId]
    : job.action.steps.map((step) => step.toolId);
}

function mimePatternsOverlap(left: string, right: string): boolean {
  return mimeMatches(left, right) || mimeMatches(right, left);
}

describe('consumer jobs', () => {
  it('references registered tools', () => {
    for (const job of JOBS) {
      for (const toolId of toolIdsFor(job)) {
        expect(registry.toolsById.has(toolId), `${job.slug} references ${toolId}`).toBe(true);
      }
    }
  });

  it('only recommends MIME patterns accepted by an action tool', () => {
    for (const job of JOBS) {
      const actionTools = toolIdsFor(job).map((toolId) => registry.toolsById.get(toolId)!);
      for (const pattern of job.acceptMimes) {
        const accepted = actionTools.some((tool) =>
          tool.input.accept.some((toolPattern) => mimePatternsOverlap(pattern, toolPattern)),
        );
        expect(accepted, `${job.slug} cannot accept ${pattern}`).toBe(true);
      }
    }
  });

  it('has unique kebab-case slugs and unique priorities', () => {
    expect(new Set(JOBS.map((job) => job.slug)).size).toBe(JOBS.length);
    expect(new Set(JOBS.map((job) => job.priority)).size).toBe(JOBS.length);
    for (const job of JOBS) {
      expect(job.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it('returns image jobs in stable priority order', () => {
    const jobs = jobsForMime('image/jpeg');
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((job) => job.acceptMimes.some((pattern) => mimeMatches('image/jpeg', pattern))))
      .toBe(true);
    expect(jobs.map((job) => [job.priority, job.slug])).toEqual(
      [...jobs]
        .sort((a, b) => a.priority - b.priority || a.slug.localeCompare(b.slug))
        .map((job) => [job.priority, job.slug]),
    );
  });
});
