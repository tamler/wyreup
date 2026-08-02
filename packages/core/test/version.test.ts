import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { WYREUP_CORE_VERSION } from '../src/index.js';

/**
 * WYREUP_CORE_VERSION shipped as a hardcoded '0.0.0' from the scaffold commit
 * all the way through the 1.0.0 release. Nothing caught it because nothing
 * asserted on it, and changesets rewrites package.json on release without ever
 * touching a string literal in source.
 *
 * The fix moved the value into tsup's `define`, sourced from package.json at
 * build time. These tests guard the two halves of that: the build wiring is
 * actually pointed at the manifest, and the source-run fallback stays an
 * obviously-unbuilt sentinel rather than drifting back to a plausible number.
 */
describe('WYREUP_CORE_VERSION', () => {
  it('is the unbuilt sentinel when imported from source', () => {
    // vitest imports src directly and applies no tsup define, so this is the
    // fallback path. It must not look like a real version — a believable but
    // wrong number is exactly the failure being prevented.
    expect(WYREUP_CORE_VERSION).toBe('0.0.0-src');
  });

  it('has build-time injection wired to package.json', async () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };

    const configs = (await import('../tsup.config.js')).default as Array<{
      define?: Record<string, string>;
    }>;

    expect(configs.length).toBeGreaterThan(0);
    for (const config of configs) {
      // Every build output must carry the version, not just one of them —
      // the browser and node bundles are published from the same package.
      expect(config.define?.__WYREUP_CORE_VERSION__).toBe(JSON.stringify(pkg.version));
    }
  });
});
