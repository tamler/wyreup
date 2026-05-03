import type { ToolModule, ToolRunContext } from '../../types.js';

export interface GeojsonToKmlParams {
  documentName?: string;
}

export const defaultGeojsonToKmlParams: GeojsonToKmlParams = {
  documentName: '',
};

const GeojsonToKmlComponentStub = (): unknown => null;

interface FeatureCollection {
  type: 'FeatureCollection';
  features: unknown[];
}

interface Feature {
  type: 'Feature';
  geometry: unknown;
  properties?: unknown;
}

function asFeatureCollection(value: unknown): FeatureCollection {
  if (!value || typeof value !== 'object') {
    throw new Error('Input is not valid GeoJSON.');
  }
  const obj = value as { type?: string; features?: unknown };
  if (obj.type === 'FeatureCollection') {
    if (!Array.isArray(obj.features)) {
      throw new Error('FeatureCollection has no features array.');
    }
    return value as FeatureCollection;
  }
  if (obj.type === 'Feature') {
    return { type: 'FeatureCollection', features: [value as Feature] };
  }
  // Bare geometry — wrap into a single Feature
  if (typeof obj.type === 'string' && [
    'Point', 'LineString', 'Polygon',
    'MultiPoint', 'MultiLineString', 'MultiPolygon',
    'GeometryCollection',
  ].includes(obj.type)) {
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: value, properties: {} }],
    };
  }
  throw new Error(`Unsupported GeoJSON type: ${String(obj.type)}`);
}

export const geojsonToKml: ToolModule<GeojsonToKmlParams> = {
  id: 'geojson-to-kml',
  slug: 'geojson-to-kml',
  name: 'GeoJSON to KML',
  description:
    'Convert a GeoJSON file to KML for Google Earth, Google My Maps, or any KML-compatible viewer.',
  category: 'convert',
  presence: 'both',
  keywords: [
    'geojson',
    'kml',
    'geo',
    'convert',
    'google earth',
    'gis',
    'map',
    'placemark',
  ],

  input: {
    accept: ['application/geo+json', 'application/json', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 100 * 1024 * 1024,
  },
  output: {
    mime: 'application/vnd.google-earth.kml+xml',
    multiple: false,
    filename: (input) => input.name.replace(/\.[^.]+$/, '') + '.kml',
  },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultGeojsonToKmlParams,

  paramSchema: {
    documentName: {
      type: 'string',
      label: 'Document name',
      placeholder: 'Optional title for the KML <Document>',
      help: 'Shown as the layer name in Google Earth and similar viewers.',
    },
  },

  Component: GeojsonToKmlComponentStub,

  async run(
    inputs: File[],
    params: GeojsonToKmlParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'loading-deps', percent: 10, message: 'Loading converter' });
    const { toKML } = await import('@placemarkio/tokml');

    ctx.onProgress({ stage: 'processing', percent: 40, message: 'Parsing GeoJSON' });
    const text = await inputs[0]!.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error(`Invalid JSON: ${(e as Error).message}`);
    }

    const fc = asFeatureCollection(parsed);

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 70, message: 'Building KML' });
    let kmlText = toKML(fc as never);

    const docName = (params.documentName ?? '').trim();
    if (docName) {
      const safe = docName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      kmlText = kmlText.replace(
        /<Document>/,
        `<Document><name>${safe}</name>`,
      );
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([kmlText], { type: 'application/vnd.google-earth.kml+xml' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/vnd.google-earth.kml+xml'],
  },
};
