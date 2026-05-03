import { describe, it, expect } from 'vitest';
import { convertGeo } from '../../../src/tools/convert-geo/index.js';

describe('convert-geo — metadata', () => {
  it('has id convert-geo', () => {
    expect(convertGeo.id).toBe('convert-geo');
  });

  it('runs everywhere (web, cli, mcp) — surfaces field unset', () => {
    expect(convertGeo.surfaces).toBeUndefined();
  });

  it('declares installSize and installGroup', () => {
    expect(convertGeo.installSize).toBeGreaterThan(0);
    expect(convertGeo.installGroup).toBe('gdal');
  });

  it('lists all 9 vector formats in the target enum', () => {
    const schema = convertGeo.paramSchema;
    expect(schema?.to?.type).toBe('enum');
    if (schema?.to?.type === 'enum') {
      expect(schema.to.options.map((o) => o.value)).toEqual([
        'GeoJSON',
        'KML',
        'Shapefile',
        'GPX',
        'GML',
        'GeoPackage',
        'FlatGeobuf',
        'TopoJSON',
        'CSV',
      ]);
    }
  });

  it('default target is GeoJSON (chains with the rest of the geo family)', () => {
    expect(convertGeo.defaults.to).toBe('GeoJSON');
  });

  it('output filename derives extension from selected format', () => {
    const fileLike = { name: 'cities.kml' } as File;
    const fn = convertGeo.output.filename!;
    expect(fn(fileLike, { to: 'GeoJSON' })).toBe('cities.geojson');
    expect(fn(fileLike, { to: 'Shapefile' })).toBe('cities.zip');
    expect(fn(fileLike, { to: 'CSV' })).toBe('cities.csv');
  });
});
