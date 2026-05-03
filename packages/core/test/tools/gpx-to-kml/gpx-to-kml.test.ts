import { describe, it, expect } from 'vitest';
import { gpxToKml } from '../../../src/tools/gpx-to-kml/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

async function run(text: string): Promise<string> {
  const file = new File([text], 'input.gpx', { type: 'application/gpx+xml' });
  const [out] = (await gpxToKml.run([file], {}, makeCtx())) as Blob[];
  return out!.text();
}

const TRACK_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="test">
  <trk>
    <name>Morning ride</name>
    <trkseg>
      <trkpt lat="40.7" lon="-74.0"></trkpt>
      <trkpt lat="40.71" lon="-74.01"></trkpt>
    </trkseg>
  </trk>
</gpx>`;

describe('gpx-to-kml', () => {
  it('outputs KML mime', () => {
    expect(gpxToKml.output.mime).toBe('application/vnd.google-earth.kml+xml');
  });

  it('converts a GPX track to KML', async () => {
    const kml = await run(TRACK_GPX);
    expect(kml).toContain('<kml');
    expect(kml).toContain('<Placemark>');
    expect(kml).toContain('Morning ride');
    expect(kml).toContain('LineString');
  });

  it('throws on GPX with no content', async () => {
    const empty = `<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="x"></gpx>`;
    await expect(run(empty)).rejects.toThrow(/No tracks/);
  });
});
