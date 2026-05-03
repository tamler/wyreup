import type { ToolModule, ToolRunContext } from '../../types.js';

export type ShapefileToGeojsonParams = Record<string, never>;

export const defaultShapefileToGeojsonParams: ShapefileToGeojsonParams = {};

const ShapefileToGeojsonComponentStub = (): unknown => null;

interface FeatureCollection {
  type: 'FeatureCollection';
  features: unknown[];
}

export const shapefileToGeojson: ToolModule<ShapefileToGeojsonParams> = {
  id: 'shapefile-to-geojson',
  slug: 'shapefile-to-geojson',
  name: 'Shapefile to GeoJSON',
  description:
    'Convert a zipped Shapefile bundle (.shp + .dbf + .prj) to GeoJSON. Upload the .zip directly.',
  category: 'convert',
  categories: ['geo'],
  presence: 'both',
  keywords: [
    'shapefile',
    'shp',
    'geojson',
    'geo',
    'convert',
    'gis',
    'esri',
    'arcgis',
    'qgis',
    'map',
  ],

  input: {
    accept: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
    min: 1,
    max: 1,
    sizeLimit: 200 * 1024 * 1024,
  },
  output: {
    mime: 'application/geo+json',
    multiple: false,
    filename: (input) => input.name.replace(/\.[^.]+$/, '') + '.geojson',
  },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'medium',

  defaults: defaultShapefileToGeojsonParams,

  Component: ShapefileToGeojsonComponentStub,

  async run(
    inputs: File[],
    _params: ShapefileToGeojsonParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'loading-deps', percent: 10, message: 'Loading shapefile parser' });
    // shpjs has no published types; declare the call shape locally.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error — no .d.ts published with shpjs as of 6.2.0
    const shpMod = (await import('shpjs')) as unknown as {
      default: (buf: ArrayBuffer) => Promise<FeatureCollection | FeatureCollection[]>;
    };
    const shp = shpMod.default;

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Reading archive' });
    const buf = await inputs[0]!.arrayBuffer();

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 60, message: 'Parsing shapefile' });
    let result: FeatureCollection | FeatureCollection[];
    try {
      result = await shp(buf);
    } catch (e) {
      throw new Error(`Could not parse shapefile: ${(e as Error).message}`);
    }

    // shpjs returns a FeatureCollection, or an array of them when the zip
    // contains multiple shapefiles. Merge into a single collection so the
    // output is always one GeoJSON file.
    let merged: FeatureCollection;
    if (Array.isArray(result)) {
      const all = result.flatMap((fc) => fc.features ?? []);
      merged = { type: 'FeatureCollection', features: all };
    } else {
      merged = result;
    }

    if (!merged || !Array.isArray(merged.features) || merged.features.length === 0) {
      throw new Error('Shapefile produced no features.');
    }

    const json = JSON.stringify(merged);
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([json], { type: 'application/geo+json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/geo+json'],
  },
};
