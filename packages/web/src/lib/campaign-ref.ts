import { PUBLIC_CAMPAIGN_TAGS } from './campaign-tags';

/** Carry only an approved public label to a same-origin navigation. */
export function withCampaignRef(destination: string, current: string): string {
  try {
    const source = new URL(current);
    const target = new URL(destination, source);
    const tag = source.searchParams.get('ref');
    if (!tag || !(PUBLIC_CAMPAIGN_TAGS as readonly string[]).includes(tag) ||
        !['http:', 'https:'].includes(source.protocol) || target.origin !== source.origin ||
        target.searchParams.has('ref')) return destination;
    target.searchParams.set('ref', tag);
    return destination.startsWith('/') && !destination.startsWith('//')
      ? `${target.pathname}${target.search}${target.hash}` : target.href;
  } catch {
    return destination;
  }
}
