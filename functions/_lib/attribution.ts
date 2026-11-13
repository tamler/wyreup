import type { Env } from './env';
import { PUBLIC_CAMPAIGN_TAGS } from './campaign-tags';

export const HEARD_OPTIONS = ['youtube', 'rumble', 'reddit', 'x', 'search', 'friend', 'other'] as const;

export function campaignRef(value: unknown, env: Env): string | null {
  if (typeof value !== 'string' || !(PUBLIC_CAMPAIGN_TAGS as readonly string[]).includes(value)) return null;
  const configured = (env.METRICS_REF_TAGS ?? '').split(',').slice(0, 64);
  return configured.some((item) => item.trim() === value) ? value : null;
}

export function heardAnswer(value: unknown): string | null {
  return typeof value === 'string' && (HEARD_OPTIONS as readonly string[]).includes(value) ? value : null;
}
