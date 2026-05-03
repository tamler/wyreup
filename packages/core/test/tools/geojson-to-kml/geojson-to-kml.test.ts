import { describe, it, expect } from 'vitest';
import { geojsonToKml } from '../../../src/tools/geojson-to-kml/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

async function run(geojson: unknown, params = {}): Promise<string> {
  const file = new File([JSON.stringify(geojson)], 'input.geojson', { type: 'application/geo+json' });
  const [out] = (await geojsonToKml.run([file], params, makeCtx())) as Blob[];
  return out!.text();
}

const POINT_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-74, 40.7] },
      properties: { name: 'NYC', desc: 'big apple' },
    },
  ],
};

describe('geojson-to-kml — metadata', () => {
  it('outputs application/vnd.google-earth.kml+xml', () => {
    expect(geojsonToKml.output.mime).toBe('application/vnd.google-earth.kml+xml');
  });

  it('accepts geojson and json mimes', () => {
    expect(geojsonToKml.input.accept).toContain('application/geo+json');
    expect(geojsonToKml.input.accept).toContain('application/json');
  });
});

describe('geojson-to-kml — run()', () => {
  it('converts a FeatureCollection of points', async () => {
    const kml = await run(POINT_FC);
    expect(kml).toContain('<kml');
    expect(kml).toContain('<Placemark>');
    expect(kml).toContain('NYC');
    expect(kml).toContain('-74,40.7');
  });

  it('wraps a bare Feature in a FeatureCollection', async () => {
    const feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-74, 40.7] },
      properties: { name: 'X' },
    };
    const kml = await run(feature);
    expect(kml).toContain('<Placemark>');
    expect(kml).toContain('-74,40.7');
  });

  it('wraps a bare Geometry in a Feature', async () => {
    const geom = { type: 'Point', coordinates: [-74, 40.7] };
    const kml = await run(geom);
    expect(kml).toContain('<Placemark>');
  });

  it('inserts document name when provided', async () => {
    const kml = await run(POINT_FC, { documentName: 'my map' });
    expect(kml).toContain('<Document><name>my map</name>');
  });

  it('escapes XML special chars in document name', async () => {
    const kml = await run(POINT_FC, { documentName: 'a & b <c>' });
    expect(kml).toContain('a &amp; b &lt;c&gt;');
  });

  it('rejects invalid JSON', async () => {
    const file = new File(['not json'], 'input.json');
    await expect(geojsonToKml.run([file], {}, makeCtx())).rejects.toThrow(/Invalid JSON/);
  });

  it('rejects non-GeoJSON objects', async () => {
    await expect(run({ foo: 'bar' })).rejects.toThrow(/not valid GeoJSON|Unsupported/);
  });
});
