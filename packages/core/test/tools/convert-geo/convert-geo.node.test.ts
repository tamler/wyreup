// Node-only integration test for convert-geo. Runs the full pipeline
// (init gdal3.js, open input, ogr2ogr, read output) under Node so that
// CLI/MCP regressions are caught before shipping.

import { describe, it, expect } from 'vitest';
import { convertGeo } from '../../../src/tools/convert-geo/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

const POINT_FC = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-74, 40.7] },
      properties: { name: 'NYC' },
    },
  ],
});

describe('convert-geo — Node integration', () => {
  it(
    'converts GeoJSON to KML in Node',
    async () => {
      const file = new File([POINT_FC], 'nyc.geojson', { type: 'application/geo+json' });
      const [out] = (await convertGeo.run([file], { to: 'KML' }, makeCtx())) as Blob[];
      const kml = await out!.text();
      expect(kml).toContain('<kml');
      expect(kml).toContain('<Placemark>');
      expect(kml).toContain('-74,40.7');
      expect(out!.type).toBe('application/vnd.google-earth.kml+xml');
    },
    30_000,
  );

  it(
    'converts GeoJSON to GPX in Node',
    async () => {
      const file = new File([POINT_FC], 'nyc.geojson', { type: 'application/geo+json' });
      const [out] = (await convertGeo.run([file], { to: 'GPX' }, makeCtx())) as Blob[];
      const gpx = await out!.text();
      expect(gpx).toContain('<gpx');
      expect(out!.type).toBe('application/gpx+xml');
    },
    30_000,
  );

  it(
    'wraps Shapefile output in a zip',
    async () => {
      const file = new File([POINT_FC], 'nyc.geojson', { type: 'application/geo+json' });
      const [out] = (await convertGeo.run([file], { to: 'Shapefile' }, makeCtx())) as Blob[];
      expect(out!.type).toBe('application/zip');
      // Zip magic number "PK\x03\x04"
      const buf = new Uint8Array(await out!.arrayBuffer());
      expect(buf[0]).toBe(0x50);
      expect(buf[1]).toBe(0x4b);
      expect(buf[2]).toBe(0x03);
      expect(buf[3]).toBe(0x04);
    },
    30_000,
  );
});
