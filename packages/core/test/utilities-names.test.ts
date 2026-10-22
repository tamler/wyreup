import { describe, expect, it } from 'vitest';
import { nameTools, buildNamePool, drawNameIdeas } from '../src/utilities/names.js';

describe('independent local name vocabularies', () => {
  it('locks descriptive empty/topic patterns and 64-cardinality pools', () => {
    for (const topic of ['', 'Gardening']) { const pool = buildNamePool('podcast-name-generator', { topic, style: 'descriptive' }); expect(pool).toHaveLength(64); expect(pool[0]!.name).toBe(topic ? 'Quiet Gardening Harbor' : 'Quiet Harbor'); expect(new Set(drawNameIdeas(pool, 63, () => 0).map(row => row.name)).size).toBe(63); expect(new Set(drawNameIdeas(pool, 64, () => 0).map(row => row.name)).size).toBe(64); expect(() => drawNameIdeas(pool, 65, () => 0)).toThrow('64'); }
  });
  it('all podcast styles keep both vocabularies with and without a fixed topic', () => { for (const style of ['descriptive', 'conversational', 'punchy']) for (const topic of ['', 'Gardening']) { const pool = buildNamePool('podcast-name-generator', { topic, style }); expect(pool).toHaveLength(64); expect(new Set(pool.map(row => row.name)).size).toBe(64); expect(pool[0]!.name).toContain('Quiet'); expect(pool[0]!.name).toContain('Harbor'); if (topic) expect(pool[0]!.name).toContain(topic); } });
  it('all band, clan and ancestry selectors affect actual distinct vocabularies', () => {
    for (const genre of ['rock', 'electronic', 'folk']) expect(buildNamePool('band-name-generator', { genre, topic: '' })).toHaveLength(64);
    for (const style of ['tactical', 'fantasy', 'playful']) { const pool = buildNamePool('clan-name-generator', { style, topic: '', tagLength: 5 }); expect(pool).toHaveLength(64); expect(pool.every(row => /^[A-Z0-9]{5}$/.test(row.tag))).toBe(true); }
    for (const ancestry of ['human', 'elf', 'dwarf', 'orc']) { expect(buildNamePool('dnd-name-generator', { ancestry, surname: false })).toHaveLength(64); const pool = buildNamePool('dnd-name-generator', { ancestry, surname: true }); expect(pool).toHaveLength(512); expect(new Set(pool.map(row => row.name)).size).toBe(512); }
  });
  it('preserves literal topics, rejects bad choices/oversized topics and generates actual module outputs', async () => {
    const hostile = '<img src=x onerror=alert(1)>'; expect(buildNamePool('podcast-name-generator', { style: 'descriptive', topic: hostile })[0]!.name).toContain(hostile);
    expect(() => buildNamePool('band-name-generator', { genre: '__proto__', topic: '' })).toThrow(); expect(() => buildNamePool('podcast-name-generator', { style: 'unknown', topic: '' })).toThrow(); expect(() => buildNamePool('podcast-name-generator', { style: 'descriptive', topic: '😀'.repeat(81) })).toThrow();
    expect(nameTools).toHaveLength(4);
    for (const tool of nameTools) { const output = await tool.run([], tool.defaults, { signal: new AbortController().signal, executionId: 'names-test', cache: new Map(), onProgress: () => {} }); const blobs = Array.isArray(output) ? output : [output]; expect(blobs).toHaveLength(1); const result = JSON.parse(await blobs[0]!.text()) as { ideas: { name: string }[]; notice: string }; expect(result.ideas).toHaveLength(12); expect(new Set(result.ideas.map(row => row.name)).size).toBe(12); expect(result.notice).toContain('not been checked'); }
  });
});
