import { beforeEach, describe, expect, it } from 'vitest';
import { appendHop, clearTrail, getTrail } from '../src/components/runners/hopTrail';

const values = new Map<string, string>();
const storage: Storage = {
  get length() {
    return values.size;
  },
  clear() {
    values.clear();
  },
  getItem(key) {
    return values.get(key) ?? null;
  },
  key(index) {
    return [...values.keys()][index] ?? null;
  },
  removeItem(key) {
    values.delete(key);
  },
  setItem(key, value) {
    values.set(key, value);
  },
};

Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: storage,
});

beforeEach(() => {
  storage.clear();
});

describe('hop trail', () => {
  it('round-trips appended steps', () => {
    appendHop({ toolId: 'image-resize', params: {} });
    appendHop({ toolId: 'image-convert', params: { format: 'webp' } });

    expect(getTrail()).toEqual([
      { toolId: 'image-resize', params: {} },
      { toolId: 'image-convert', params: { format: 'webp' } },
    ]);
  });

  it('returns an empty trail for corrupt JSON', () => {
    storage.setItem('wyreup:hop-trail', '{broken');

    expect(getTrail()).toEqual([]);
  });

  it('caps the trail at 20 steps', () => {
    for (let index = 0; index < 21; index++) {
      appendHop({ toolId: `tool-${index}`, params: {} });
    }

    expect(getTrail()).toHaveLength(20);
    expect(getTrail().at(-1)?.toolId).toBe('tool-19');
  });

  it('clears the trail', () => {
    appendHop({ toolId: 'image-resize', params: {} });

    clearTrail();

    expect(getTrail()).toEqual([]);
  });
});
