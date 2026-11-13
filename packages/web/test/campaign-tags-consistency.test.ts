import { expect, it } from 'vitest';
import { PUBLIC_CAMPAIGN_TAGS as browserTags } from '../src/lib/campaign-tags';
import { PUBLIC_CAMPAIGN_TAGS as serverTags } from '../../../functions/_lib/campaign-tags';

it('uses the exact protected Functions public campaign allowlist in browser navigation', () => {
  expect(browserTags).toEqual(serverTags);
  expect(new Set(serverTags).size).toBe(serverTags.length);
  expect(serverTags.every((tag) => /^[a-z][a-z0-9-]{0,31}$/.test(tag))).toBe(true);
});
