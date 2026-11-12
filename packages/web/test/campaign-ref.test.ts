import { describe, expect, it } from 'vitest';
import { withCampaignRef } from '../src/lib/campaign-ref';

describe('campaign ref navigation', () => {
  it('preserves an existing query and fragment on same-origin destinations', () => {
    expect(withCampaignRef('/tools?q=hello%20world#results', 'https://wyreup.com/?ref=youtube'))
      .toBe('/tools?q=hello+world&ref=youtube#results');
    expect(withCampaignRef('https://wyreup.com/path?x=1#part', 'https://wyreup.com/?ref=rumble'))
      .toBe('https://wyreup.com/path?x=1&ref=rumble#part');
  });
  it('never adds personal-looking or unknown values, or adds tags to external URLs', () => {
    expect(withCampaignRef('/target', 'https://wyreup.com/?ref=person-123')).toBe('/target');
    expect(withCampaignRef('https://external.test/target', 'https://wyreup.com/?ref=youtube')).toBe('https://external.test/target');
    expect(withCampaignRef('//external.test/target', 'https://wyreup.com/?ref=youtube')).toBe('//external.test/target');
    expect(withCampaignRef('mailto:hello@example.com', 'https://wyreup.com/?ref=youtube')).toBe('mailto:hello@example.com');
  });
  it('preserves an explicit destination ref and fails closed on malformed source', () => {
    expect(withCampaignRef('/target?ref=reddit', 'https://wyreup.com/?ref=youtube')).toBe('/target?ref=reddit');
    expect(withCampaignRef('/target', 'not a URL')).toBe('/target');
    expect(withCampaignRef('/target', 'file:///tmp/a?ref=youtube')).toBe('/target');
  });
});
