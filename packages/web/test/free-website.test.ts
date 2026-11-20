import { describe, expect, it, vi } from 'vitest';
import { createDefaultRegistry as createCoreRegistry } from '@wyreup/core/execution';
import { createDefaultRegistry, runChain } from '../src/lib/core-execution';
import { decodeChainSteps, encodeChainSteps } from '../src/components/runners/chainUrl';
import { getAllChains, importChainsJson, validateToolbeltChain } from '../src/components/runners/toolbeltStorage';
import { hasBrowserFileImport } from '../src/lib/file-tool-candidates';
import { displayName } from '../src/data/display-names';
import { projectToolDiscoveryMetadata } from '../src/lib/tool-discovery-metadata';
import { JOBS } from '../src/data/jobs';
import { GET as toolIndex } from '../src/pages/tools-index.json';
import { GET as sitemap } from '../src/pages/sitemap.xml';
import type { APIRoute } from 'astro';

const context = {} as Parameters<APIRoute>[0];

describe('free website catalog', () => {
  it('admits only free browser tools through every registry lookup', () => {
    const registry = createDefaultRegistry();
    const free = ['compress', 'transcribe', 'audio-enhance', 'domain-age-checker'];
    const core = createCoreRegistry();
    const retired = core.tools.filter(tool => tool.cost === 'credit').map(tool => tool.id);
    expect(retired).toHaveLength(31);
    expect(registry.tools).toHaveLength(384);
    expect(registry.tools.every(tool => tool.cost === 'free' && (!tool.surfaces || tool.surfaces.includes('web')))).toBe(true);
    for (const id of free) expect(registry.toolsById.has(id)).toBe(true);
    for (const id of retired) {
      expect(registry.toolsById.has(id)).toBe(false);
      expect(registry.searchTools(id).some(tool => tool.id === id)).toBe(false);
      expect(hasBrowserFileImport(core.toolsById.get(id)!)).toBe(false);
    }
    const file = new File(['fixture'], 'fixture.png', { type: 'image/png' });
    expect(registry.toolsForFiles([file]).map(tool => tool.id)).toContain('compress');
    expect(registry.toolsForFiles([file]).every(tool => tool.cost === 'free')).toBe(true);
    expect(registry.tools.every(tool => registry.toolsByCategory(tool.category).every(match => match.cost === 'free'))).toBe(true);
  });

  it('presents the same free Neural OCR tool through every website lookup', async () => {
    const registry = createDefaultRegistry();
    const tool = registry.toolsById.get('ocr-pro')!;
    const file = new File(['fixture'], 'fixture.png', { type: 'image/png' });
    expect(tool.name).toBe('Neural OCR');
    expect(tool.cost).toBe('free');
    expect(registry.tools.find(candidate => candidate.id === tool.id)).toBe(tool);
    expect(registry.toolsByCategory(tool.category)).toContain(tool);
    expect(registry.toolsForFiles([file])).toContain(tool);
    for (const query of ['Neural OCR', 'ocr-pro', 'extract text', 'handwriting']) {
      expect(registry.searchTools(query), query).toContain(tool);
    }
    expect(displayName(tool.id)).toBe(tool.name);
    const metadata = projectToolDiscoveryMetadata(tool);
    expect(metadata.heading).toBe(tool.name);
    expect(metadata.seoContent?.intro).toContain(tool.name);
    const index: unknown = await (await toolIndex(context)).json();
    expect(index).toContainEqual(expect.objectContaining({ id: tool.id, name: tool.name }));
    expect(createCoreRegistry().toolsById.get(tool.id)?.name).toBe('OCR Pro');
  });

  it('rejects a retired URL-chain step before dispatching its earlier valid step', async () => {
    const core = createCoreRegistry();
    const tool = core.toolsById.get('compress')!;
    const run = vi.fn(() => Promise.resolve([new Blob(['processed'], { type: 'image/png' })]));
    const toolsById = new Map(core.toolsById);
    toolsById.set(tool.id, { ...tool, run });
    const registry = { ...core, toolsById };
    const file = new File(['fixture'], 'fixture.png', { type: 'image/png' });
    const context = { signal: new AbortController().signal, cache: new Map(), onProgress: vi.fn(), executionId: 'fixture' };
    const local = [{ toolId: tool.id, params: {} }];
    const serialized = encodeChainSteps([...local, { toolId: 'ocr-hq', params: {} }]);
    const oldChain = decodeChainSteps(serialized)!;
    expect(oldChain.map(step => step.toolId)).toEqual(['compress', 'ocr-hq']);
    await expect(runChain(oldChain, [file], context, registry)).rejects.toThrow('Tool is unavailable on Wyreup: ocr-hq');
    expect(run).not.toHaveBeenCalled();
    await expect(runChain(local, [file], context, registry)).resolves.toHaveLength(1);
    expect(run).toHaveBeenCalledOnce();
  });

  it('leaves no sales copy or hosted recommendations in retained tool metadata', () => {
    const registry = createDefaultRegistry();
    for (const tool of registry.tools) {
      const metadata = projectToolDiscoveryMetadata(tool);
      expect(JSON.stringify(metadata), tool.id).not.toMatch(/hosted PRO|(?:transcribe|sentiment|summarize|translate) PRO|credit-metered|credits? per run/i);
      for (const entry of metadata.seoContent?.alsoTry ?? []) {
        expect(registry.toolsById.has(entry.id), `${tool.id} -> ${entry.id}`).toBe(true);
      }
    }
  });

  it('preserves a saved retired chain but declines to admit or import its steps', () => {
    const retired = {
      id: 'saved-fixture', name: 'Saved test chain', schemaVersion: 1,
      steps: [{ toolId: 'compress', params: {} }, { toolId: 'ocr-hq', params: {} }],
      createdAt: '2026-11-19T00:00:00Z', updatedAt: '2026-11-19T00:00:00Z',
    };
    let stored = JSON.stringify([retired]);
    vi.stubGlobal('localStorage', { getItem: () => stored, setItem: (_key: string, value: string) => { stored = value; } });
    try {
      expect(getAllChains()).toEqual([retired]);
      expect(validateToolbeltChain(retired)).toEqual({ ok: false, unknownTools: ['ocr-hq'] });
      const local = { ...retired, id: 'local-fixture', steps: retired.steps.slice(0, 1) };
      const imported = importChainsJson(JSON.stringify([{ ...retired, id: 'retired-copy' }, local]));
      expect(imported).toMatchObject({ added: 1, updated: 0, errors: [expect.stringContaining('ocr-hq')] });
      expect(getAllChains()).toEqual([retired, local]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('publishes only free tool and job IDs in search data and sitemap', async () => {
    const registry = createDefaultRegistry();
    const indexResponse = await toolIndex(context);
    const index = await indexResponse.json() as { id: string; cost?: string }[];
    expect(index.some(tool => tool.id === 'domain-age-checker')).toBe(true);
    expect(index.some(tool => tool.id === 'transcribe-pro')).toBe(false);
    expect(index.every(tool => registry.toolsById.has(tool.id) && tool.cost !== 'credit')).toBe(true);
    for (const job of JOBS) {
      const ids = job.action.kind === 'tool' ? [job.action.toolId] : job.action.steps.map(step => step.toolId);
      expect(ids.every(id => registry.toolsById.has(id)), job.slug).toBe(true);
    }
    const sitemapResponse = await sitemap(context);
    const xml = await sitemapResponse.text();
    expect(xml).toContain('/tools/domain-age-checker/');
    expect(xml).not.toContain('/tools/transcribe-pro/');
    expect(xml).not.toContain('wyreup.com/pro/');
    expect(xml).not.toContain('wyreup.com/account/');
  });
});
