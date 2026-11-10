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

  it('surfaces the server message and a sign-in hint', async () => {
    const limited = () => Promise.resolve(Response.json({ error: 'You have 20 active links.' }, { status: 429 }));
    await expect(createShareLink('ocr-hq', 'x', limited)).rejects.toThrow('You have 20 active links.');
    const signedOut = () => Promise.resolve(Response.json({ error: 'Unauthorized' }, { status: 401 }));
    await expect(createShareLink('ocr-hq', 'x', signedOut)).rejects.toThrow('Sign in to create a share link.');
    const missing = () => Promise.resolve(Response.json({ error: 'Link not found' }, { status: 404 }));
    await expect(deleteShareLink('a'.repeat(22), missing)).rejects.toThrow('Link not found');
  });
});
