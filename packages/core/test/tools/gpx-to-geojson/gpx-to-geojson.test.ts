import { describe, it, expect } from 'vitest';
import { gpxToGeojson } from '../../../src/tools/gpx-to-geojson/index.js';
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
  const file = new File([text], 'input.gpx', { type: 'application/gpx+xml' });
  const [out] = (await gpxToGeojson.run([file], {}, makeCtx())) as Blob[];
  return JSON.parse(await out!.text()) as FC;
}

const TRACK_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="test">
  <trk>
    <name>Morning ride</name>
    <trkseg>
      <trkpt lat="40.7" lon="-74.0"><ele>10</ele></trkpt>
      <trkpt lat="40.71" lon="-74.01"><ele>12</ele></trkpt>
      <trkpt lat="40.72" lon="-74.02"><ele>15</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

const WAYPOINT_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="test">
  <wpt lat="40.7" lon="-74.0"><name>Start</name></wpt>
</gpx>`;

describe('gpx-to-geojson', () => {
  it('outputs application/geo+json', () => {
    expect(gpxToGeojson.output.mime).toBe('application/geo+json');
  });

  it('converts a track to a LineString', async () => {
    const fc = await run(TRACK_GPX);
    expect(fc.features[0]!.geometry.type).toBe('LineString');
    const coords = fc.features[0]!.geometry.coordinates as unknown[];
    expect(coords.length).toBe(3);
    expect(fc.features[0]!.properties['name']).toBe('Morning ride');
  });

  it('converts waypoints to Points', async () => {
    const fc = await run(WAYPOINT_GPX);
    expect(fc.features[0]!.geometry.type).toBe('Point');
    expect(fc.features[0]!.geometry.coordinates).toEqual([-74, 40.7]);
  });

  it('throws on GPX with no tracks/routes/waypoints', async () => {
    const empty = `<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="x"></gpx>`;
    await expect(run(empty)).rejects.toThrow(/No tracks/);
  });
});
