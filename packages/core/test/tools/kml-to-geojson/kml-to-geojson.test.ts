import { describe, it, expect } from 'vitest';
import { kmlToGeojson } from '../../../src/tools/kml-to-geojson/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

interface FC {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: string; coordinates: unknown };
    properties: Record<string, unknown>;
  }>;
}

async function run(text: string): Promise<FC> {
  const file = new File([text], 'input.kml', { type: 'application/vnd.google-earth.kml+xml' });
  const [out] = (await kmlToGeojson.run([file], {}, makeCtx())) as Blob[];
  return JSON.parse(await out!.text()) as FC;
}

const POINT_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>NYC</name>
      <description>The big apple</description>
      <Point><coordinates>-74.0,40.7</coordinates></Point>
    </Placemark>
  </Document>
</kml>`;

const LINE_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>route</name>
      <LineString><coordinates>-74,40 -75,41 -76,42</coordinates></LineString>
    </Placemark>
  </Document>
</kml>`;

describe('kml-to-geojson — metadata', () => {
  it('outputs application/geo+json', () => {
    expect(kmlToGeojson.output.mime).toBe('application/geo+json');
  });
});

describe('kml-to-geojson — run()', () => {
  it('converts a Point placemark', async () => {
    const fc = await run(POINT_KML);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.geometry.type).toBe('Point');
    expect(fc.features[0]!.geometry.coordinates).toEqual([-74, 40.7]);
    expect(fc.features[0]!.properties['name']).toBe('NYC');
    expect(fc.features[0]!.properties['description']).toBe('The big apple');
  });

  it('converts a LineString', async () => {
    const fc = await run(LINE_KML);
    expect(fc.features[0]!.geometry.type).toBe('LineString');
    expect((fc.features[0]!.geometry.coordinates as unknown[]).length).toBe(3);
  });

  it('throws on KML with no placemarks', async () => {
    const empty = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document></Document></kml>`;
    await expect(run(empty)).rejects.toThrow(/No placemarks/);
  });
});
