import { describe, it, expect } from 'vitest';
import { csvToGeojson } from '../../../src/tools/csv-to-geojson/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import type { CsvToGeoJsonParams } from '../../../src/tools/csv-to-geojson/index.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

interface FeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: Record<string, unknown>;
  }>;
}

async function run(text: string, params: CsvToGeoJsonParams = {}): Promise<FeatureCollection> {
  const file = new File([text], 'input.csv', { type: 'text/csv' });
  const [out] = (await csvToGeojson.run([file], params, makeCtx())) as Blob[];
  return JSON.parse(await out!.text()) as FeatureCollection;
}

describe('csv-to-geojson — metadata', () => {
  it('has id csv-to-geojson', () => {
    expect(csvToGeojson.id).toBe('csv-to-geojson');
  });

  it('outputs application/geo+json', () => {
    expect(csvToGeojson.output.mime).toBe('application/geo+json');
  });
});

describe('csv-to-geojson — auto-detect', () => {
  it('detects lat/lng columns by common names', async () => {
    const csv = 'name,lat,lng\nAlice,40.7,-74.0\nBob,34.0,-118.2';
    const fc = await run(csv);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0]!.geometry.coordinates).toEqual([-74.0, 40.7]);
    expect(fc.features[0]!.properties['name']).toBe('Alice');
  });

  it('detects latitude/longitude (full words)', async () => {
    const csv = 'place,latitude,longitude\nNYC,40.7,-74.0';
    const fc = await run(csv);
    expect(fc.features[0]!.geometry.coordinates).toEqual([-74.0, 40.7]);
  });

  it('detects x/y as longitude/latitude', async () => {
    const csv = 'name,x,y\nA,-74.0,40.7';
    const fc = await run(csv);
    expect(fc.features[0]!.geometry.coordinates).toEqual([-74.0, 40.7]);
  });
});

describe('csv-to-geojson — explicit columns', () => {
  it('uses explicit column names when provided', async () => {
    const csv = 'name,my_y,my_x\nA,40.7,-74.0';
    const fc = await run(csv, { latColumn: 'my_y', lngColumn: 'my_x' });
    expect(fc.features[0]!.geometry.coordinates).toEqual([-74.0, 40.7]);
  });

  it('throws when explicit column missing', async () => {
    const csv = 'name,lat,lng\nA,1,2';
    await expect(run(csv, { latColumn: 'nope' })).rejects.toThrow(/not found/);
  });
});

describe('csv-to-geojson — properties', () => {
  it('includes non-coordinate columns as properties', async () => {
    const csv = 'name,age,lat,lng\nAlice,30,40.7,-74.0';
    const fc = await run(csv);
    expect(fc.features[0]!.properties).toEqual({ name: 'Alice', age: 30 });
  });

  it('coerces numeric strings', async () => {
    const csv = 'val,lat,lng\n42,40.7,-74.0';
    const fc = await run(csv);
    expect(fc.features[0]!.properties['val']).toBe(42);
  });

  it('coerces booleans', async () => {
    const csv = 'flag,lat,lng\ntrue,40.7,-74.0';
    const fc = await run(csv);
    expect(fc.features[0]!.properties['flag']).toBe(true);
  });

  it('keeps strings as strings', async () => {
    const csv = 'name,lat,lng\nAlice,40.7,-74.0';
    const fc = await run(csv);
    expect(fc.features[0]!.properties['name']).toBe('Alice');
  });
});

describe('csv-to-geojson — validation', () => {
  it('skips rows with invalid coordinates', async () => {
    const csv = 'name,lat,lng\nA,40.7,-74.0\nB,not-a-number,-74.0\nC,34.0,-118.2';
    const fc = await run(csv);
    expect(fc.features).toHaveLength(2);
  });

  it('skips out-of-range coordinates', async () => {
    const csv = 'name,lat,lng\nA,91,0\nB,40,200\nC,40.7,-74.0';
    const fc = await run(csv);
    expect(fc.features).toHaveLength(1);
  });

  it('throws when no valid rows', async () => {
    const csv = 'name,lat,lng\nA,bad,bad';
    await expect(run(csv)).rejects.toThrow(/No valid/);
  });

  it('throws when no header or data', async () => {
    await expect(run('')).rejects.toThrow();
    await expect(run('lat,lng')).rejects.toThrow(/header.*data/);
  });
});

describe('csv-to-geojson — delimiter', () => {
  it('supports custom delimiter', async () => {
    const csv = 'name;lat;lng\nA;40.7;-74.0';
    const fc = await run(csv, { delimiter: ';' });
    expect(fc.features[0]!.geometry.coordinates).toEqual([-74.0, 40.7]);
  });

  it('supports tab delimiter via \\t escape', async () => {
    const csv = 'name\tlat\tlng\nA\t40.7\t-74.0';
    const fc = await run(csv, { delimiter: '\\t' });
    expect(fc.features[0]!.geometry.coordinates).toEqual([-74.0, 40.7]);
  });
});
