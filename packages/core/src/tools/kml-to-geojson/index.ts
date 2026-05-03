import type { ToolModule, ToolRunContext } from '../../types.js';
import { getDomParser } from '../../lib/xml-dom.js';

export type KmlToGeojsonParams = Record<string, never>;

export const defaultKmlToGeojsonParams: KmlToGeojsonParams = {};

const KmlToGeojsonComponentStub = (): unknown => null;

export const kmlToGeojson: ToolModule<KmlToGeojsonParams> = {
  id: 'kml-to-geojson',
  slug: 'kml-to-geojson',
  name: 'KML to GeoJSON',
  description:
    'Convert a Google Earth KML file to GeoJSON. Preserves placemark names, descriptions, and geometry.',
  category: 'convert',
  categories: ['geo'],
  presence: 'both',
  keywords: [
    'kml',
    'geojson',
    'geo',
    'convert',
    'google earth',
    'gis',
    'map',
    'placemark',
  ],

  input: {
    accept: ['application/vnd.google-earth.kml+xml', 'application/xml', 'text/xml', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 100 * 1024 * 1024,
  },
  output: {
    mime: 'application/geo+json',
    multiple: false,
    filename: (input) => input.name.replace(/\.[^.]+$/, '') + '.geojson',
  },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultKmlToGeojsonParams,

  Component: KmlToGeojsonComponentStub,

  async run(
    inputs: File[],
    _params: KmlToGeojsonParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'loading-deps', percent: 10, message: 'Loading parser' });
    const [{ kml }, parser] = await Promise.all([
      import('@tmcw/togeojson'),
      getDomParser(),
    ]);

    ctx.onProgress({ stage: 'processing', percent: 40, message: 'Parsing KML' });
    const text = await inputs[0]!.text();
    const doc = parser.parseFromString(text, 'text/xml');

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 70, message: 'Converting' });
    const fc = kml(doc as unknown as Document) as { features?: unknown[] } | null;

    if (!fc || !Array.isArray(fc.features) || fc.features.length === 0) {
      throw new Error('No placemarks found in KML.');
    }

    const json = JSON.stringify(fc);
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([json], { type: 'application/geo+json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/geo+json'],
  },
};
