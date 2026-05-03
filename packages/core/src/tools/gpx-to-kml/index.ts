import type { ToolModule, ToolRunContext } from '../../types.js';
import { getDomParser } from '../../lib/xml-dom.js';

export type GpxToKmlParams = Record<string, never>;

export const defaultGpxToKmlParams: GpxToKmlParams = {};

const GpxToKmlComponentStub = (): unknown => null;

export const gpxToKml: ToolModule<GpxToKmlParams> = {
  id: 'gpx-to-kml',
  slug: 'gpx-to-kml',
  name: 'GPX to KML',
  description:
    'Convert a GPX track from Strava, Garmin, or any GPS device to KML for Google Earth.',
  category: 'convert',
  categories: ['geo'],
  presence: 'both',
  keywords: [
    'gpx',
    'kml',
    'geo',
    'convert',
    'gps',
    'strava',
    'garmin',
    'google earth',
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
    mime: 'application/vnd.google-earth.kml+xml',
    multiple: false,
    filename: (input) => input.name.replace(/\.[^.]+$/, '') + '.kml',
  },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultGpxToKmlParams,

  Component: GpxToKmlComponentStub,

  async run(
    inputs: File[],
    _params: GpxToKmlParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'loading-deps', percent: 10, message: 'Loading converters' });
    const [{ gpx }, { toKML }, parser] = await Promise.all([
      import('@tmcw/togeojson'),
      import('@placemarkio/tokml'),
      getDomParser(),
    ]);

    ctx.onProgress({ stage: 'processing', percent: 40, message: 'Parsing GPX' });
    const text = await inputs[0]!.text();
    const doc = parser.parseFromString(text, 'text/xml');

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 65, message: 'Converting via GeoJSON' });
    const fc = gpx(doc as unknown as Document);

    if (!fc || fc.features.length === 0) {
      throw new Error('No tracks, routes, or waypoints found in GPX.');
    }

    ctx.onProgress({ stage: 'processing', percent: 85, message: 'Building KML' });
    const kmlText = toKML(fc as never);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([kmlText], { type: 'application/vnd.google-earth.kml+xml' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/vnd.google-earth.kml+xml'],
  },
};
