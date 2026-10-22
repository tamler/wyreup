import { parseCsv, type CsvDelimiter } from './csv-data.js';
import { readPsdComposite, decodeCanonicalCompositeInWorker } from './psd-composite.js';
import { rgbaToPng } from '../lib/canvas.js';
import { analyzeMonoPitch } from './midi-pitch.js';
import { validatePitchParams, type PitchReport } from './midi-pitch.js';
import { buildStlContours } from './stl-contours.js';
import { extractBankStatement } from './bank-statement.js';
import { createBankPdfEnvironment } from './bank-pdf.js';

export function fileJobTransfers(result: unknown): ArrayBuffer[] {
  if (
    !result ||
    typeof result !== 'object' ||
    !('ok' in result) ||
    result.ok !== true ||
    !('value' in result)
  )
    return [];
  const value = result.value;
  if (!value || typeof value !== 'object' || !('bytes' in value)) return [];
  const bytes = value.bytes;
  return bytes instanceof Uint8Array &&
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
    ? [bytes.buffer]
    : [];
}

function failure(jobId: string, error: unknown) {
  return {
    jobId,
    ok: false,
    error: (error instanceof Error ? error.message : 'File processing failed.').slice(0, 512),
  };
}
async function bankExtract(jobId: string, bytes: Uint8Array, params: Record<string, unknown>) {
  try {
    if (
      !params ||
      typeof params !== 'object' ||
      Array.isArray(params) ||
      Object.keys(params).join(',') !== 'rowTolerance' ||
      typeof params.rowTolerance !== 'number' ||
      !Number.isFinite(params.rowTolerance) ||
      params.rowTolerance < 0.5 ||
      params.rowTolerance > 5
    )
      throw new Error('Invalid bank extraction tolerance.');
    const env = await createBankPdfEnvironment();
    try {
      const value = await extractBankStatement(
        bytes,
        params.rowTolerance,
        new AbortController().signal,
        env,
      );
      return { jobId, ok: true, value };
    } finally {
      await env.destroy();
    }
  } catch (error) {
    return failure(jobId, error);
  }
}

async function psdPng(
  jobId: string,
  bytes: Uint8Array,
  alphaMode: 'auto' | 'channel-as-transparency',
) {
  try {
    const composite = await decodeCanonicalCompositeInWorker(readPsdComposite(bytes, alphaMode));
    const png = await rgbaToPng(composite.width, composite.height, composite.rgba);
    return {
      jobId,
      ok: true,
      value: {
        bytes: new Uint8Array(await png.arrayBuffer()),
        width: composite.width,
        height: composite.height,
        alphaSource: composite.alphaSource,
      },
    };
  } catch (error) {
    return failure(jobId, error);
  }
}

export function handleFileJob(request: unknown): unknown {
  let jobId = '';
  try {
    if (!request || typeof request !== 'object' || Array.isArray(request))
      throw new Error('Invalid file job.');
    const job = request as Record<string, unknown>;
    if (typeof job.jobId !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(job.jobId))
      throw new Error('Invalid job ID.');
    jobId = job.jobId;
    if (
      Object.keys(job).sort().join(',') !== 'bytes,jobId,params,type' ||
      !['csv-parse', 'psd-png', 'midi-pitch', 'stl-contours', 'bank-extract'].includes(
        String(job.type),
      ) ||
      !(job.bytes instanceof Uint8Array)
    )
      throw new Error('Unsupported file job.');
    const params = job.params as Record<string, unknown>;
    if (job.type === 'bank-extract') return bankExtract(jobId, job.bytes, params);
    if (job.type === 'stl-contours') {
      const value = buildStlContours(job.bytes, params, new AbortController().signal);
      return { jobId, ok: true, value };
    }
    if (job.type === 'midi-pitch') {
      if (
        job.bytes.byteLength < 4 ||
        job.bytes.byteLength > 3840000 ||
        job.bytes.byteLength % 4 !== 0 ||
        job.bytes.byteOffset % 4 !== 0
      )
        throw new Error('Invalid bounded mono PCM job.');
      const checked = validatePitchParams(params);
      const value: PitchReport = analyzeMonoPitch(
        new Float32Array(job.bytes.buffer, job.bytes.byteOffset, job.bytes.byteLength / 4),
        checked,
      );
      return { jobId, ok: true, value };
    }
    if (job.type === 'psd-png') {
      if (
        !params ||
        typeof params !== 'object' ||
        Array.isArray(params) ||
        Object.keys(params).join(',') !== 'alphaMode' ||
        (params.alphaMode !== 'auto' && params.alphaMode !== 'channel-as-transparency')
      )
        throw new Error('Invalid PSD alpha mode.');
      return psdPng(jobId, job.bytes, params.alphaMode);
    }
    if (
      !params ||
      typeof params !== 'object' ||
      Array.isArray(params) ||
      Object.keys(params).sort().join(',') !== 'delimiter,hasHeader'
    )
      throw new Error('Invalid CSV parameters.');
    if (
      !['auto', 'comma', 'tab', 'semicolon', 'pipe'].includes(String(params.delimiter)) ||
      typeof params.hasHeader !== 'boolean'
    )
      throw new Error('Invalid delimiter or header flag.');
    const value = parseCsv(job.bytes, {
      delimiter: params.delimiter as CsvDelimiter,
      hasHeader: params.hasHeader,
    });
    return { jobId, ok: true, value };
  } catch (error) {
    return failure(jobId, error);
  }
}
