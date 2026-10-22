import { expect, it } from 'vitest';
import { createDefaultRegistry } from '@wyreup/core';
import { acceptsBrowserFile, fileToolCandidates } from '../src/lib/file-tool-candidates';

it('uses positive file contracts and browser surfaces rather than wildcard metadata alone', () => {
  const tools = [...createDefaultRegistry().toolsById.values()];
  const file = { name: 'input.json', type: 'application/json' };
  const candidates = fileToolCandidates(tools, file).map((tool) => tool.id);
  for (const id of ['calculator', 'tip-calculator', 'otpauth-uri', 'regex-visualize', 'domain-age-checker'])
    expect(candidates, id).not.toContain(id);
  expect(candidates).toContain('json-formatter');
  const hash = tools.find((tool) => tool.id === 'hash')!;
  expect(acceptsBrowserFile({ ...hash, surfaces: ['cli'] }, file)).toBe(false);
  expect(acceptsBrowserFile({ ...hash, id: 'unreviewed-file-reader' }, file)).toBe(false);
});

it('matches actual MIME parameters in the correct direction and case-insensitive accepted suffixes', () => {
  const registry = createDefaultRegistry();
  expect(acceptsBrowserFile(registry.toolsById.get('csv-viewer')!, { name: 'table.CSV', type: '' })).toBe(true);
  expect(acceptsBrowserFile(registry.toolsById.get('camera-shutter-count-checker')!, { name: 'original.NEF', type: '' })).toBe(true);
  expect(acceptsBrowserFile(registry.toolsById.get('camera-shutter-count-checker')!, { name: 'original.NEF', type: 'image/x-nikon-nef' })).toBe(true);
  expect(acceptsBrowserFile(registry.toolsById.get('compress')!, { name: 'photo.jpg', type: 'image/jpeg;example=1' })).toBe(true);
  expect(acceptsBrowserFile(registry.toolsById.get('compress')!, { name: 'photo.heic', type: 'image/heic' })).toBe(false);
  expect(acceptsBrowserFile(registry.toolsById.get('csv-viewer')!, { name: 'table.csv.exe', type: '' })).toBe(false);
});
