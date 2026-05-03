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

interface OgrFilePath {
  local: string;
  real: string;
  all?: OgrFilePath[];
}

interface GdalLike {
  open(file: File | string): Promise<{ datasets: Array<{ pointer: number; path: string; type: string; info: object }>; errors: string[] }>;
  ogr2ogr(dataset: unknown, options: string[], outName: string): Promise<OgrFilePath>;
  getFileBytes(p: string): Promise<Uint8Array>;
  close(dataset: unknown): Promise<void>;
}

function isNode(): boolean {
  return typeof process !== 'undefined' && typeof process.versions?.node === 'string';
}

/**
 * Load gdal3.js in a way that works in both browsers and Node.
 *
 * Browser: dynamic-import the published ESM bundle and load WASM/data
 * from the jsdelivr CDN (already on the privacy allowlist).
 *
 * Node: dynamic-import the CommonJS Node entry. gdal3.js's Node loader
 * has a known bug where any user-supplied `paths:` get concatenated onto
 * a hardcoded prefix `./node_modules/gdal3.js/dist/package/`, so absolute
 * paths produce nonsense. Workaround: temporarily chdir to the directory
 * whose `node_modules/gdal3.js/dist/package/*` resolves to the real files
 * (the package's own grandparent under pnpm), then restore cwd. The
 * gdal handle is cached in `ctx.cache` so this only happens once per
 * session.
 */
async function loadGdal(): Promise<GdalLike> {
  if (isNode()) {
    const { createRequire } = await import('node:module');
    const path = await import('node:path');
    const req = createRequire(import.meta.url);
    const pkgRoot = path.dirname(req.resolve('gdal3.js/package.json'));
    const fakeCwd = path.dirname(path.dirname(pkgRoot));
    const savedCwd = process.cwd();
    process.chdir(fakeCwd);
    try {
      const mod = req('gdal3.js/node.js') as
        | ((cfg?: unknown) => Promise<GdalLike>)
        | { default: (cfg?: unknown) => Promise<GdalLike> };
      const init = typeof mod === 'function' ? mod : mod.default;
      return await init({ useWorker: false });
    } finally {
      process.chdir(savedCwd);
    }
  }

  const mod = (await import('gdal3.js')) as { default: (cfg?: unknown) => Promise<GdalLike> };
  return await mod.default({
    paths: {
      wasm: `${GDAL_CDN_BASE}/gdal3WebAssembly.wasm`,
      data: `${GDAL_CDN_BASE}/gdal3WebAssembly.data`,
      js: `${GDAL_CDN_BASE}/gdal3.js`,
    },
    useWorker: true,
  });
}

export const convertGeo: ToolModule<ConvertGeoParams> = {
  id: 'convert-geo',
  slug: 'convert-geo',
  name: 'Convert Geospatial Data',
  description:
    'Convert between Shapefile, GeoJSON, KML, GPX, GML, GeoPackage, FlatGeobuf, TopoJSON, and CSV. Powered by GDAL/OGR.',
  category: 'convert',
  categories: ['geo'],
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
    const cached = ctx.cache.get('gdal3') as GdalLike | undefined;
    const gdal = cached ?? (await loadGdal());
    if (!cached) ctx.cache.set('gdal3', gdal);

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 40, message: 'Opening input' });

    // In Node, gdal.open() is most reliable with an on-disk path. Browser
    // accepts the File directly. Bridge by writing the File to a temp file
    // when running in Node.
    let openTarget: File | string = inputs[0]!;
    let cleanupTmp: string | null = null;
    if (isNode()) {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const os = await import('node:os');
      const tmpPath = path.join(
        os.tmpdir(),
        `wyreup-geo-${Date.now()}-${Math.random().toString(36).slice(2)}-${inputs[0]!.name || 'input'}`,
      );
      const buf = Buffer.from(await inputs[0]!.arrayBuffer());
      await fs.writeFile(tmpPath, buf);
      openTarget = tmpPath;
      cleanupTmp = tmpPath;
    }

    const opened = await gdal.open(openTarget);
    if (!opened.datasets || opened.datasets.length === 0) {
      const err = (opened.errors && opened.errors.join('; ')) || 'unknown error';
      throw new Error(`Could not open input: ${err}`);
    }
    const dataset = opened.datasets[0]!;

    // Unique output name so we don't collide with stale files from earlier
    // runs (gdal3.js shares a single WASM filesystem across all invocations
    // within a session).
    const uniq = `${ctx.executionId.replace(/[^a-z0-9]/gi, '')}_${Date.now()}`;
    const outExt = target.ext === 'zip' ? 'shp' : target.ext;
    const outName = `wyreup_${uniq}.${outExt}`;

    ctx.onProgress({ stage: 'processing', percent: 70, message: `Converting to ${params.to}` });
    const ogrResult = await gdal.ogr2ogr(dataset, ['-f', target.ogr], outName);

    if (ctx.signal.aborted) throw new Error('Aborted');

    const cleanupTmpFile = async () => {
      if (cleanupTmp) {
        const fs = await import('node:fs/promises');
        await fs.unlink(cleanupTmp).catch(() => {});
      }
    };

    if (target.multiFile) {
      // Shapefile produces .shp + .shx + .dbf + .prj + …; all paths come back
      // in ogrResult.all.
      ctx.onProgress({ stage: 'encoding', percent: 90, message: 'Zipping shapefile components' });
      const components = ogrResult.all && ogrResult.all.length > 0 ? ogrResult.all : [ogrResult];
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const f of components) {
        const bytes = await gdal.getFileBytes(f.local);
        const name = f.local.split('/').pop() ?? f.local;
        zip.file(name, bytes);
      }
      const blob = await zip.generateAsync({ type: 'blob', mimeType: target.mime });
      await gdal.close(dataset);
      await cleanupTmpFile();
      ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
      return [blob];
    }

    const bytes = await gdal.getFileBytes(ogrResult.local);
    await gdal.close(dataset);
    await cleanupTmpFile();

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
