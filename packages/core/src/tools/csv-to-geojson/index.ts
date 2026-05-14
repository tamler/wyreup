import type { ToolModule, ToolRunContext } from '../../types.js';

export interface CsvToGeoJsonParams {
  latColumn?: string;
  lngColumn?: string;
  delimiter?: string;
}

export const defaultCsvToGeoJsonParams: CsvToGeoJsonParams = {
  latColumn: '',
  lngColumn: '',
  delimiter: ',',
};

const LAT_NAMES = ['lat', 'latitude', 'y', 'ycoord', 'y_coord'];
const LNG_NAMES = ['lng', 'lon', 'long', 'longitude', 'x', 'xcoord', 'x_coord'];

function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const row: string[] = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        row.push(field);
        field = '';
      } else {
        field += ch;
      }
    }
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function findColumn(headers: string[], explicit: string, candidates: string[]): number {
  if (explicit) {
    const idx = headers.findIndex((h) => h.trim().toLowerCase() === explicit.trim().toLowerCase());
    if (idx === -1) {
      throw new Error(`Column "${explicit}" not found in header. Available: ${headers.join(', ')}`);
    }
    return idx;
  }
  for (const c of candidates) {
    const idx = headers.findIndex((h) => h.trim().toLowerCase() === c);
    if (idx !== -1) return idx;
  }
  return -1;
}

function coerce(value: string): string | number | boolean | null {
  if (value === '') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  const n = Number(value);
  if (!Number.isNaN(n) && value.trim() !== '' && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) {
    return n;
  }
  return value;
}

export const csvToGeojson: ToolModule<CsvToGeoJsonParams> = {
  id: 'csv-to-geojson',
  slug: 'csv-to-geojson',
  name: 'CSV to GeoJSON',
  description:
    'Convert a CSV with latitude/longitude columns into a GeoJSON FeatureCollection of points.',
  llmDescription:
    'Convert a CSV file with latitude/longitude columns to a GeoJSON FeatureCollection of Points. Auto-detects common column names (lat, latitude, y, lng, lon, longitude, x); the user can override via params. Use when the user has a spreadsheet of coordinates and wants a map-ready file.',
  category: 'convert',
  categories: ['geo'],
  keywords: [
    'csv',
    'geojson',
    'geo',
    'convert',
    'map',
    'gis',
    'latitude',
    'longitude',
    'points',
    'spreadsheet',
  ],

  input: {
    accept: ['text/csv', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: {
    mime: 'application/geo+json',
    multiple: false,
    filename: (input) => input.name.replace(/\.[^.]+$/, '') + '.geojson',
  },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultCsvToGeoJsonParams,

  paramSchema: {
    latColumn: {
      type: 'string',
      label: 'Latitude column',
      placeholder: 'auto-detect (lat, latitude, y)',
      help: 'Column header for latitude. Leave blank to auto-detect.',
    },
    lngColumn: {
      type: 'string',
      label: 'Longitude column',
      placeholder: 'auto-detect (lng, lon, longitude, x)',
      help: 'Column header for longitude. Leave blank to auto-detect.',
    },
    delimiter: {
      type: 'string',
      label: 'Delimiter',
      placeholder: ',',
      maxLength: 1,
      help: 'Field separator. Use a single character (e.g. "," or ";" or "\\t").',
    },
  },

  async run(
    inputs: File[],
    params: CsvToGeoJsonParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Reading CSV' });

    const text = await inputs[0]!.text();
    const delimiter = (params.delimiter && params.delimiter.length > 0)
      ? (params.delimiter === '\\t' ? '\t' : params.delimiter)
      : ',';

    const rows = parseCsv(text, delimiter);
    if (rows.length < 2) {
      throw new Error('CSV must have a header row and at least one data row.');
    }

    const headers = rows[0]!;
    const latIdx = findColumn(headers, params.latColumn ?? '', LAT_NAMES);
    const lngIdx = findColumn(headers, params.lngColumn ?? '', LNG_NAMES);

    if (latIdx === -1) {
      throw new Error(
        `Could not find a latitude column. Tried: ${LAT_NAMES.join(', ')}. Specify one explicitly.`,
      );
    }
    if (lngIdx === -1) {
      throw new Error(
        `Could not find a longitude column. Tried: ${LNG_NAMES.join(', ')}. Specify one explicitly.`,
      );
    }

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Building features' });

    const features: Array<Record<string, unknown>> = [];
    let skipped = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      const lat = parseFloat(row[latIdx] ?? '');
      const lng = parseFloat(row[lngIdx] ?? '');
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        skipped++;
        continue;
      }
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        skipped++;
        continue;
      }

      const properties: Record<string, unknown> = {};
      for (let j = 0; j < headers.length; j++) {
        if (j === latIdx || j === lngIdx) continue;
        const key = headers[j]!;
        properties[key] = coerce(row[j] ?? '');
      }

      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties,
      });
    }

    if (features.length === 0) {
      throw new Error('No valid coordinate rows found.');
    }

    const collection = { type: 'FeatureCollection', features };
    const json = JSON.stringify(collection);

    ctx.onProgress({
      stage: 'done',
      percent: 100,
      message: skipped > 0 ? `Done (${skipped} rows skipped)` : 'Done',
    });

    return [new Blob([json], { type: 'application/geo+json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/geo+json'],
  },
};
