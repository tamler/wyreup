import { describe, it, expect } from 'vitest';
import { validateChain } from '../../src/chain/validate.js';
import { createDefaultRegistry } from '../../src/default-registry.js';

const registry = createDefaultRegistry();

describe('validateChain', () => {
  it('approves a chain of known tools', () => {
    const result = validateChain(
      [
        { toolId: 'strip-exif', params: {} },
        { toolId: 'compress', params: {} },
      ],
      registry,
    );
    expect(result.ok).toBe(true);
    expect(result.unknownTools).toEqual([]);
    expect(result.unknownStepIndices).toEqual([]);
  });

  it('rejects a chain with an unknown tool', () => {
    const result = validateChain(
      [
        { toolId: 'strip-exif', params: {} },
        { toolId: 'evil-tool', params: {} },
      ],
      registry,
    );
    expect(result.ok).toBe(false);
    expect(result.unknownTools).toEqual(['evil-tool']);
    expect(result.unknownStepIndices).toEqual([1]);
  });

  it('reports every unknown tool ID and step index, deduplicated', () => {
    const result = validateChain(
      [
        { toolId: 'fake-a', params: {} },
        { toolId: 'compress', params: {} },
        { toolId: 'fake-b', params: {} },
        { toolId: 'fake-a', params: {} },
      ],
      registry,
    );
    expect(result.ok).toBe(false);
    expect(result.unknownTools).toEqual(['fake-a', 'fake-b']);
    expect(result.unknownStepIndices).toEqual([0, 2, 3]);
  });

  it('approves an empty chain (vacuously)', () => {
    const result = validateChain([], registry);
    expect(result.ok).toBe(true);
  });

  it('catches the prototype-pollution-shape ID', () => {
    // Confirm the toolsById Map does not have a magical __proto__ entry
    // that would let a chain reference Object.prototype keys as if they
    // were tools.
    const result = validateChain(
      [{ toolId: '__proto__', params: {} }],
      registry,
    );
    expect(result.ok).toBe(false);
    expect(result.unknownTools).toEqual(['__proto__']);
  });

  it('catches constructor as a tool ID', () => {
    const result = validateChain(
      [{ toolId: 'constructor', params: {} }],
      registry,
    );
    expect(result.ok).toBe(false);
  });
});
