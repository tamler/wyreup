import { describe, expect, it } from 'vitest';
import { createDefaultRegistry, defaultTools } from '../src/default-registry.js';
import { createRegistry } from '../src/registry.js';
import { financeTools } from '../src/utilities/finance.js';
import { planningTools } from '../src/utilities/planning.js';
import { nameTools } from '../src/utilities/names.js';
import { textDeveloperTools } from '../src/utilities/text-developer.js';
import { buildingTools } from '../src/utilities/building.js';
import { hardwareTools } from '../src/utilities/hardware.js';
import { codeBeautifier } from '../src/utilities/code-beautifier.js';
import { aspectRatioCalculator } from '../src/utilities/aspect-ratio.js';
import { csvViewer, psdToPng } from '../src/utilities/files.js';
import { bankStatementToCsv } from '../src/utilities/bank-module.js';
import { stlToGcode } from '../src/utilities/stl-module.js';
import { mp3ToMidi } from '../src/utilities/mp3-to-midi.js';
import { domainAgeChecker } from '../src/utilities/domain-age.js';
import { CURATED_CHAIN_SUGGESTIONS } from '../src/chain/curated-suggestions.js';

const additions = [
  ...financeTools,
  ...planningTools,
  ...nameTools,
  ...textDeveloperTools,
  codeBeautifier,
  aspectRatioCalculator,
  psdToPng,
  csvViewer,
  bankStatementToCsv,
  stlToGcode,
  mp3ToMidi,
  domainAgeChecker,
  ...buildingTools,
  ...hardwareTools,
];

describe('actual catalog default registry integration', () => {
  it('registers every member of the independently counted 139-tool source groups once', () => {
    expect([
      financeTools.length, planningTools.length, nameTools.length, textDeveloperTools.length,
      buildingTools.length, hardwareTools.length,
    ]).toEqual([41, 29, 4, 13, 28, 16]);
    expect(additions).toHaveLength(139);
    expect(new Set(additions.map(tool => tool.id)).size).toBe(139);
    const registry = createDefaultRegistry();
    for (const tool of additions) {
      expect(registry.tools.filter(item => item.id === tool.id), tool.id).toHaveLength(1);
      expect(registry.toolsById.get(tool.id)?.surfaces, tool.id).toEqual(tool.surfaces);
    }
    expect(registry.toolsById.has('dwg-to-pdf')).toBe(false);
  });

  it('refuses duplicate first-party IDs without changing third-party registry Map behaviour', () => {
    const tool = defaultTools[0]!;
    defaultTools.push(tool);
    try {
      expect(() => createDefaultRegistry()).toThrow(/duplicate/i);
    } finally {
      defaultTools.pop();
    }
    expect(createRegistry([tool, tool]).toolsById.get(tool.id)).toBe(tool);
  });

  it('preserves explicit empty suggestions even when curated suggestions exist', () => {
    const tool = defaultTools.find(item => CURATED_CHAIN_SUGGESTIONS[item.id]?.length);
    expect(tool).toBeDefined();
    const original = tool!.chainSuggestions;
    tool!.chainSuggestions = [];
    try {
      expect(createDefaultRegistry().toolsById.get(tool!.id)?.chainSuggestions).toEqual([]);
    } finally {
      if (original === undefined) delete tool!.chainSuggestions;
      else tool!.chainSuggestions = original;
    }
  });
});
