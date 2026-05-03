import type { ToolModule, ToolRunContext } from '../../types.js';

export type GeoFormat =
  | 'GeoJSON'
  | 'KML'
  | 'Shapefile'
  | 'GPX'
  | 'GML'
  | 'GeoPackage'
  | 'FlatGeobuf'
  | 'TopoJSON'
  | 'CSV';

export interface ConvertGeoParams {
  to: GeoFormat;
}

export const defaultConvertGeoParams: ConvertGeoParams = {
  to: 'GeoJSON',
};

interface FormatSpec {
  ext: string;
  mime: string;
  ogr: string;
  multiFile?: boolean;
}

const FORMATS: Record<GeoFormat, FormatSpec> = {
  GeoJSON: { ext: 'geojson', mime: 'application/geo+json', ogr: 'GeoJSON' },
  KML: { ext: 'kml', mime: 'application/vnd.google-earth.kml+xml', ogr: 'KML' },
  Shapefile: { ext: 'zip', mime: 'application/zip', ogr: 'ESRI Shapefile', multiFile: true },
  GPX: { ext: 'gpx', mime: 'application/gpx+xml', ogr: 'GPX' },
  GML: { ext: 'gml', mime: 'application/gml+xml', ogr: 'GML' },
  GeoPackage: { ext: 'gpkg', mime: 'application/geopackage+sqlite3', ogr: 'GPKG' },
  FlatGeobuf: { ext: 'fgb', mime: 'application/octet-stream', ogr: 'FlatGeobuf' },
  TopoJSON: { ext: 'topojson', mime: 'application/json', ogr: 'TopoJSON' },
  CSV: { ext: 'csv', mime: 'text/csv', ogr: 'CSV' },
};

const ConvertGeoComponentStub = (): unknown => null;

const GDAL_VERSION = '2.8.1';
const GDAL_CDN_BASE = `https://cdn.jsdelivr.net/npm/gdal3.js@${GDAL_VERSION}/dist/package`;

export const convertGeo: ToolModule<ConvertGeoParams> = {
  id: 'convert-geo',
  slug: 'convert-geo',
  name: 'Convert Geospatial Data',
  description:
    'Convert between Shapefile, GeoJSON, KML, GPX, GML, GeoPackage, FlatGeobuf, TopoJSON, and CSV. Powered by GDAL/OGR.',
  category: 'convert',
  presence: 'both',
  keywords: [
    'gdal',
    'ogr',
    'ogr2ogr',
    'shapefile',
    'geojson',
    'kml',
    'gpx',
    'gml',
    'geopackage',
    'gpkg',
    'flatgeobuf',
    'topojson',
    'csv',
    'gis',
    'convert',
    'geo',
  ],

  input: {
    accept: [
      'application/geo+json',
      'application/json',
      'application/vnd.google-earth.kml+xml',
      'application/gpx+xml',
      'application/gml+xml',
      'application/zip',
      'application/octet-stream',
      'text/csv',
      'text/plain',
      'text/xml',
    ],
    min: 1,
    max: 1,
    sizeLimit: 200 * 1024 * 1024,
  },
  output: {
    mime: 'application/octet-stream',
    multiple: false,
    filename: (input, params) => {
      const p = params as ConvertGeoParams;
      const spec = FORMATS[p.to] ?? FORMATS.GeoJSON;
      return input.name.replace(/\.[^.]+$/, '') + '.' + spec.ext;
    },
  },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  installSize: 40_000_000,
  installGroup: 'gdal',

  surfaces: ['web'],

  defaults: defaultConvertGeoParams,

  paramSchema: {
    to: {
      type: 'enum',
      label: 'Target format',
      options: [
        { value: 'GeoJSON', label: 'GeoJSON (.geojson)' },
        { value: 'KML', label: 'KML (.kml)' },
        { value: 'Shapefile', label: 'Shapefile (zipped)' },
        { value: 'GPX', label: 'GPX (.gpx)' },
        { value: 'GML', label: 'GML (.gml)' },
        { value: 'GeoPackage', label: 'GeoPackage (.gpkg)' },
        { value: 'FlatGeobuf', label: 'FlatGeobuf (.fgb)' },
        { value: 'TopoJSON', label: 'TopoJSON (.topojson)' },
        { value: 'CSV', label: 'CSV (with WKT geometry)' },
      ],
    },
  },

  Component: ConvertGeoComponentStub,

  async run(
    inputs: File[],
    params: ConvertGeoParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const target = FORMATS[params.to];
    if (!target) throw new Error(`Unsupported target format: ${String(params.to)}`);

    ctx.onProgress({ stage: 'loading-deps', percent: 10, message: 'Loading GDAL (~40 MB on first run)' });
    const initGdalJs = (await import('gdal3.js')).default;

    const gdal = await initGdalJs({
      paths: {
        wasm: `${GDAL_CDN_BASE}/gdal3WebAssembly.wasm`,
        data: `${GDAL_CDN_BASE}/gdal3WebAssembly.data`,
        js: `${GDAL_CDN_BASE}/gdal3.js`,
      },
      useWorker: true,
    });

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 40, message: 'Opening input' });
    const opened = await gdal.open(inputs[0]!);
    if (!opened.datasets || opened.datasets.length === 0) {
      const err = (opened.errors && opened.errors.join('; ')) || 'unknown error';
      throw new Error(`Could not open input: ${err}`);
    }
    const dataset = opened.datasets[0]!;

    const baseName = (inputs[0]!.name.replace(/\.[^.]+$/, '') || 'output');
    const outName = `${baseName}.${target.ext === 'zip' ? 'shp' : target.ext}`;

    ctx.onProgress({ stage: 'processing', percent: 70, message: `Converting to ${params.to}` });
    await gdal.ogr2ogr(dataset, ['-f', target.ogr], outName);

    if (ctx.signal.aborted) throw new Error('Aborted');

    const outputs = await gdal.getOutputFiles();
    if (!outputs || outputs.length === 0) {
      throw new Error('Conversion produced no output files.');
    }

    if (target.multiFile) {
      ctx.onProgress({ stage: 'encoding', percent: 90, message: 'Zipping shapefile components' });
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const f of outputs) {
        const bytes = await gdal.getFileBytes(f.path);
        zip.file(f.path.split('/').pop() ?? f.path, bytes);
      }
      const blob = await zip.generateAsync({ type: 'blob', mimeType: target.mime });
      await gdal.close(dataset);
      ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
      return [blob];
    }

    const primary = outputs[0]!;
    const bytes = await gdal.getFileBytes(primary.path);
    await gdal.close(dataset);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([bytes.buffer as ArrayBuffer], { type: target.mime })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: [
      'application/geo+json',
      'application/vnd.google-earth.kml+xml',
      'application/zip',
      'application/gpx+xml',
      'application/gml+xml',
      'application/geopackage+sqlite3',
      'application/octet-stream',
      'application/json',
      'text/csv',
    ],
  },
};
