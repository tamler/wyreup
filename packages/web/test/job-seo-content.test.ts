import { describe, expect, it } from 'vitest';
import { JOBS } from '../src/data/jobs';
import { JOB_SEO_CONTENT, type JobSeoContent } from '../src/lib/job-seo-content';

const BLANKET_NEEDLES = [
  'nothing uploads',
  '0 uploads',
  'never leave your machine',
  'never leaves your machine',
  'never leave your computer',
  'never leaves your computer',
  'runs every tool on your device',
  'every tool runs on your device',
  'nothing is sent to a server',
  'no uploads. no signup',
  'never upload, never cache',
  'files never upload',
  'no upload, no signup',
  'like every other wyreup tool',
  'no cookies',
] as const;

function flattenContent(content: JobSeoContent): string[] {
  return [
    content.intro,
    ...content.useCases,
    ...content.faq.flatMap((entry) => [entry.q, entry.a]),
  ];
}

describe('job landing-page SEO content', () => {
  it('has one entry for every job and no orphan entries', () => {
    const jobSlugs = JOBS.map((job) => job.slug).sort();
    const contentSlugs = Object.keys(JOB_SEO_CONTENT).sort();

    expect(contentSlugs).toEqual(jobSlugs);
  });

  it('has the required shape and intro length for every job', () => {
    for (const job of JOBS) {
      const content = JOB_SEO_CONTENT[job.slug];
      expect(content, job.slug).toBeDefined();

      const wordCount = content!.intro.trim().split(/\s+/).length;
      expect(wordCount, `${job.slug} intro word count`).toBeGreaterThanOrEqual(90);
      expect(wordCount, `${job.slug} intro word count`).toBeLessThanOrEqual(140);
      expect(content!.intro, `${job.slug} intro`).not.toMatch(/\n/);
      expect(content!.useCases, `${job.slug} use cases`).toHaveLength(4);
      expect(content!.faq, `${job.slug} FAQs`).toHaveLength(4);
    }
  });

  it('contains none of the banned blanket privacy claims', () => {
    const failures: string[] = [];

    for (const [slug, content] of Object.entries(JOB_SEO_CONTENT)) {
      for (const text of flattenContent(content)) {
        const lower = text.toLowerCase();
        for (const needle of BLANKET_NEEDLES) {
          if (lower.includes(needle)) {
            failures.push(`${slug}: contains ${JSON.stringify(needle)}`);
          }
        }
      }
    }

    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('does not mention prices or dollar amounts', () => {
    const failures: string[] = [];

    for (const [slug, content] of Object.entries(JOB_SEO_CONTENT)) {
      for (const text of flattenContent(content)) {
        if (/\bprices?\b|\$/i.test(text)) {
          failures.push(`${slug}: ${JSON.stringify(text)}`);
        }
      }
    }

    expect(failures, failures.join('\n')).toEqual([]);
  });
});
