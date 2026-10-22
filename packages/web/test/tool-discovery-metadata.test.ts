import { expect, it } from 'vitest';
import { createDefaultRegistry } from '@wyreup/core';
import { projectToolDiscoveryMetadata } from '../src/lib/tool-discovery-metadata';
import { createToolSearch, searchTools } from '../src/lib/tool-search';
import { GET } from '../src/pages/tools-index.json';

it('search uses final metadata and finds every registered task by its primary name in the first six results', async () => {
  const tools = [...createDefaultRegistry().toolsById.values()];
  const response = await GET({} as Parameters<typeof GET>[0]);
  const index = await response.json() as { id: string; name: string; description: string; category: string; keywords: string[] }[];
  const search = createToolSearch(index);
  expect(index).toHaveLength(tools.length);
  for (const tool of tools) {
    const metadata = projectToolDiscoveryMetadata(tool);
    expect(index.find((entry) => entry.id === tool.id)?.description, tool.id).toBe(metadata.description);
    expect(searchTools(search, tool.name, 6).map((result) => result.tool.id), tool.name).toContain(tool.id);
    expect(metadata.seoContent?.intro, tool.id).toBeTruthy();
    expect(metadata.seoContent?.faq?.length, tool.id).toBeGreaterThan(0);
    expect(metadata.seoContent?.alsoTry?.every((entry) => tools.some((candidate) => candidate.id === entry.id)), tool.id).not.toBe(false);
  }
}, 30000);

it('merges partial inline fields and preserves explicit empty arrays before final overrides', () => {
  const tool = createDefaultRegistry().toolsById.get('compress')!;
  const metadata = projectToolDiscoveryMetadata({ ...tool, seoContent: { faq: [], alsoTry: [] } });
  expect(metadata.seoContent?.intro).toContain('when a same-format encode is larger');
  expect(metadata.seoContent?.faq).toEqual([]);
  expect(metadata.seoContent?.alsoTry).toEqual([]);
  expect(metadata.seoContent?.useCases?.length).toBeGreaterThan(0);
  const face = projectToolDiscoveryMetadata(createDefaultRegistry().toolsById.get('face-blur')!);
  expect(face.seoContent?.faq?.map((entry) => entry.q)).toEqual([
    'Where does face detection run?', 'How should I review the result?',
  ]);
  expect(face.seoContent?.faq?.[0].a).toContain('model and runtime download');
  expect(face.seoContent?.intro).toContain('Automatic detection can miss people');
});

it('keeps domain disclosure unique and construction output factual', () => {
  const tools = [...createDefaultRegistry().toolsById.values()];
  expect(tools.filter((tool) => projectToolDiscoveryMetadata(tool).networkAccess).map((tool) => tool.id))
    .toEqual(['domain-age-checker']);
  expect(projectToolDiscoveryMetadata(createDefaultRegistry().toolsById.get('domain-age-checker')!).seoContent?.alsoTry)
    .toEqual([{ id: 'url-parse', why: 'Inspect the components of a URL locally.' }]);
  expect(projectToolDiscoveryMetadata(createDefaultRegistry().toolsById.get('construction-estimate-generator')!).outputLabel)
    .toBe('Outputs: JSON or PDF, according to the selected format.');
});
