import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Exercise the existing presentation function directly; the core's HSL fields
// are percentages, as independently fixed input oracles demonstrate here.
const source = readFileSync(
  new URL('../src/components/runners/ColorConverterRunner.svelte', import.meta.url),
  'utf8',
);
const body = source.match(
  /function hslCanonical\(r: ConvertResult\): string \{([\s\S]*?)\n {2}\}/,
)?.[1];
if (!body) throw new Error('Existing HSL presentation function not found.');
const canonical = runInNewContext(
  `(function(r) { ${body} })`,
  {},
  {
    timeout: 1000,
  },
) as (r: { hsl: { h: number; s: number; l: number; a?: number } }) => string;

describe('actual HSL presentation percent units', () => {
  it('preserves core saturation and lightness percent units', () => {
    expect(canonical({ hsl: { h: 41.2, s: 100, l: 50 } })).toBe('hsl(41, 100%, 50%)');
  });
  it('retains alpha and rounds percentages once', () => {
    expect(canonical({ hsl: { h: 210.4, s: 33.6, l: 72.2, a: 0.5 } })).toBe(
      'hsla(210, 34%, 72%, 0.5)',
    );
  });
});
