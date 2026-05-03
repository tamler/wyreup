import type { ToolModule, ToolRunContext } from '../../types.js';
import { getDomParser } from '../../lib/xml-dom.js';

export type GpxToGeojsonParams = Record<string, never>;

export const defaultGpxToGeojsonParams: GpxToGeojsonParams = {};

const GpxToGeojsonComponentStub = (): unknown => null;

export const gpxToGeojson: ToolModule<GpxToGeojsonParams> = {
  id: 'gpx-to-geojson',
  slug: 'gpx-to-geojson',
  name: 'GPX to GeoJSON',
  description:
    'Convert a GPS Exchange (GPX) track from Strava, Garmin, or any GPS device to GeoJSON.',
  category: 'convert',
  categories: ['geo'],
  presence: 'both',
  keywords: [
    'gpx',
    'geojson',
    'geo',
    'convert',
    'gps',
    'strava',
    'garmin',
    'track',
    'route',
    'fitness',
  ],

  input: {
    accept: ['application/gpx+xml', 'application/xml', 'text/xml', 'text/plain'],
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

  defaults: defaultGpxToGeojsonParams,

  Component: GpxToGeojsonComponentStub,

  async run(
    inputs: File[],
    _params: GpxToGeojsonParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'loading-deps', percent: 10, message: 'Loading parser' });
    const [{ gpx }, parser] = await Promise.all([
      import('@tmcw/togeojson'),
      getDomParser(),
    ]);

    ctx.onProgress({ stage: 'processing', percent: 40, message: 'Parsing GPX' });
    const text = await inputs[0]!.text();
    const doc = parser.parseFromString(text, 'text/xml');

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 70, message: 'Converting' });
    const fc = gpx(doc as unknown as Document);

    if (!fc || fc.features.length === 0) {
      throw new Error('No tracks, routes, or waypoints found in GPX.');
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
