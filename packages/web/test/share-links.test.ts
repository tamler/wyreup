import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultRegistry } from '@wyreup/core';
import { SHAREABLE_TOOLS } from '../../../functions/_lib/shares';
import {
  createShareLink,
  deleteShareLink,
  isShareableTool,
  SHARE_LINKS_ENABLED,
  SHAREABLE_TOOL_IDS,
  showShareFor,
} from '../src/lib/shareLinks';

describe('share link client', () => {
  it('offers sharing for exactly the tools the server accepts, all hosted text tools', () => {
    expect([...SHAREABLE_TOOL_IDS].sort()).toEqual(Object.keys(SHAREABLE_TOOLS).sort());
    const registry = createDefaultRegistry();
    for (const id of SHAREABLE_TOOL_IDS) {
      const tool = registry.toolsById.get(id);
      expect(tool?.cost, id).toBe('credit');
      expect(tool?.output.mime, id).toBe('text/plain');
    }
    expect(isShareableTool('ocr')).toBe(false);
  });

  it('shows the button only when enabled, for shareable hosted tools', () => {
    expect(SHARE_LINKS_ENABLED).toBe(false);
    expect(showShareFor('ocr-hq', 'credit')).toBe(false);
    expect(showShareFor('ocr-hq', 'credit', true)).toBe(true);
    expect(showShareFor('ocr', 'free', true)).toBe(false);
    expect(showShareFor('image-generate-pro', 'credit', true)).toBe(false);
  });

  it('posts the result with the CSRF header and returns the link', async () => {
    const fetchImpl = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(Response.json({ id: 'a'.repeat(22), url: 'https://wyreup.com/s/x', expiresAt: 1 }, { status: 201 })),
    );
    const link = await createShareLink('ocr-hq', 'hello', fetchImpl);
    expect(link.url).toBe('https://wyreup.com/s/x');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/shares');
    expect((init!.headers as Record<string, string>)['X-Wyreup-CSRF']).toBe('1');
    expect(JSON.parse(init!.body as string)).toEqual({ toolId: 'ocr-hq', text: 'hello' });
  });

  it('describes what a share link stores, for how long, and what deletion can and cannot do', () => {
    const src = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\s+/g, ' ');
    const button = src('../src/components/runners/ShareResultLink.svelte');
    const account = src('../src/components/AccountShareLinks.svelte');
    const privacy = src('../src/pages/legal/privacy.astro');
    const publicPage = readFileSync(new URL('../../../functions/s/[id].ts', import.meta.url), 'utf8');

    expect(button).toContain('Anyone with the link can read it without signing in.');
    expect(button).toContain('expires 30 days after creation, and Wyreup then deletes the text.');
    expect(button).toContain('Each link uses up one PRO run of this tool from the last 24 hours.');
    expect(button).toContain('Copies people make cannot be taken back.');
    expect(button).not.toContain('Nothing is stored unless you click');
    expect(button).not.toContain('Delete it any time');

    expect(account).toContain('Only active links appear here.');
    expect(account).toContain("Expired links are deleted from Wyreup's database and are not listed.");
    expect(account).toContain('Expires {when(s.expiresAt)}');
    // The explanation sits outside the loading / empty / list branches.
    expect(account.indexOf('Only active links appear here.')).toBeLessThan(account.indexOf('{#if loading}'));

    expect(privacy).toContain('id="share-links"');
    expect(privacy).toContain('Each link uses up one PRO run of that tool');
    expect(privacy).toContain('This is not a guaranteed deletion timer');
    expect(privacy).toContain('Deleting your account deletes all of your links.');
    expect(privacy).not.toContain('We do not retain the input or output beyond the request. We do log');
    expect(privacy).not.toContain('<h3>What we never store</h3>');

    expect(publicPage).toContain('and Wyreup then deletes the text.');
    // The pages are no-store now, so no copy may promise or warn about a browser cache window.
    for (const copy of [button, account, privacy, publicPage]) {
      expect(copy).not.toMatch(/five minutes|max-age=300/);
    }
    // New share copy carries no em dashes.
    const shareParagraph = privacy.slice(privacy.indexOf('id="share-links"'), privacy.indexOf('</p>', privacy.indexOf('id="share-links"')));
    for (const copy of [button, account, shareParagraph, publicPage]) expect(copy).not.toContain('—');
  });

  it('surfaces the server message and a sign-in hint', async () => {
    const limited = () => Promise.resolve(Response.json({ error: 'You have 20 active links.' }, { status: 429 }));
    await expect(createShareLink('ocr-hq', 'x', limited)).rejects.toThrow('You have 20 active links.');
    const signedOut = () => Promise.resolve(Response.json({ error: 'Unauthorized' }, { status: 401 }));
    await expect(createShareLink('ocr-hq', 'x', signedOut)).rejects.toThrow('Sign in to create a share link.');
    const missing = () => Promise.resolve(Response.json({ error: 'Link not found' }, { status: 404 }));
    await expect(deleteShareLink('a'.repeat(22), missing)).rejects.toThrow('Link not found');
  });
});
