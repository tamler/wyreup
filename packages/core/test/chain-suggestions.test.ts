import { describe, it, expect } from 'vitest';
import { createDefaultRegistry } from '../src/default-registry.js';
import { couldFlowTo } from '../src/registry.js';

describe('chainSuggestions curation', () => {
  const registry = createDefaultRegistry();

  const toolsWithSuggestions = registry.tools.filter(
    (t) => t.chainSuggestions && t.chainSuggestions.length > 0,
  );

  it('at least 40 tools declare a non-empty chainSuggestions list', () => {
    expect(toolsWithSuggestions.length).toBeGreaterThanOrEqual(40);
  });

  it('every suggestion id exists, is flow-compatible, unique, non-self, and length <= 6', () => {
    for (const tool of toolsWithSuggestions) {
      const suggestions = tool.chainSuggestions!;

      expect(suggestions.length, `${tool.id}: length`).toBeLessThanOrEqual(6);
      expect(suggestions.length, `${tool.id}: non-empty`).toBeGreaterThan(0);
      expect(new Set(suggestions).size, `${tool.id}: no duplicates`).toBe(suggestions.length);
      expect(suggestions.includes(tool.id), `${tool.id}: no self-suggestion`).toBe(false);

      for (const id of suggestions) {
        const target = registry.toolsById.get(id);
        expect(target, `${tool.id} → ${id}: resolves in toolsById`).toBeDefined();
        expect(
          couldFlowTo(tool.output.mime, target!.input.accept),
          `${tool.id} → ${id}: couldFlowTo`,
        ).toBe(true);
      }
    }
  });

  it('at most one credit suggestion, and if present it is last', () => {
    for (const tool of toolsWithSuggestions) {
      const suggestions = tool.chainSuggestions!;
      const creditIndexes: number[] = [];

      for (let i = 0; i < suggestions.length; i++) {
        const target = registry.toolsById.get(suggestions[i]!);
        if (target?.cost === 'credit') creditIndexes.push(i);
      }

      expect(
        creditIndexes.length,
        `${tool.id}: at most one credit suggestion`,
      ).toBeLessThanOrEqual(1);

      if (creditIndexes.length === 1) {
        expect(
          creditIndexes[0],
          `${tool.id}: credit suggestion must be last`,
        ).toBe(suggestions.length - 1);
      }
    }
  });
});
