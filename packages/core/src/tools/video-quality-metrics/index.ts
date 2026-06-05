import type { ToolBudget, ToolModule, ToolRunContext } from '../../types.js';
import { assertDurationBudget } from '../../lib/budget.js';

const VIDEO_QUALITY_BUDGET: ToolBudget = { maxDuration: 7_200 };

// Compares two videos; no configurable parameters. inputs[0] is the reference
// (original), inputs[1] the distorted (encoded). Both PSNR and SSIM are computed.
export type VideoQualityMetricsParams = Record<string, never>;

export const defaultVideoQualityMetricsParams: VideoQualityMetricsParams = {};

export type QualityMetric = 'psnr' | 'ssim';

export interface QualityReport {
  psnr: { average: number; y: number; u: number; v: number } | null;
  ssim: { all: number; y: number; u: number; v: number } | null;
}

/**
 * Compare the distorted clip (input 1) against the reference (input 0).
 * `scale2ref` resizes the distorted frame to the reference dimensions so
 * the two are directly comparable, then the metric filter runs.
 */
export function buildQualityArgs(
  metric: QualityMetric,
  refName: string,
  distName: string,
): string[] {
  return [
    '-i', refName,
    '-i', distName,
    '-lavfi', `[1:v][0:v]scale2ref[dist][ref];[dist][ref]${metric}`,
    '-f', 'null',
    '-',
  ];
}

function parseNum(log: string, re: RegExp): number | null {
  const m = log.match(re);
  if (!m || m[1] === undefined) return null;
  return m[1] === 'inf' ? Infinity : parseFloat(m[1]);
}

/**
 * Parse the PSNR and SSIM summary lines ffmpeg prints to the log. PSNR uses
 * lowercase y/u/v, SSIM uppercase Y/U/V — which keeps the two apart. A
 * metric that was not run (or not found) comes back as null.
 */
export function parseQualityMetrics(log: string): QualityReport {
  const ssimAll = parseNum(log, /SSIM[^\n]*All:\s*([\d.]+)/);
  const psnrAvg = parseNum(log, /PSNR[^\n]*average:\s*([\d.]+|inf)/);

  const ssim = ssimAll === null ? null : {
    all: ssimAll,
    y: parseNum(log, /SSIM\s+Y:\s*([\d.]+)/) ?? NaN,
    u: parseNum(log, /SSIM[^\n]*\bU:\s*([\d.]+)/) ?? NaN,
    v: parseNum(log, /SSIM[^\n]*\bV:\s*([\d.]+)/) ?? NaN,
  };

  const psnr = psnrAvg === null ? null : {
    average: psnrAvg,
    y: parseNum(log, /PSNR\s+y:\s*([\d.]+|inf)/) ?? NaN,
    u: parseNum(log, /PSNR[^\n]*\bu:\s*([\d.]+|inf)/) ?? NaN,
    v: parseNum(log, /PSNR[^\n]*\bv:\s*([\d.]+|inf)/) ?? NaN,
  };

  return { psnr, ssim };
}

export const videoQualityMetrics: ToolModule<VideoQualityMetricsParams> = {
  id: 'video-quality-metrics',
  slug: 'video-quality-metrics',
  name: 'Video Quality Metrics',
  description: 'Compare two videos and report PSNR and SSIM. Drop the reference (original) first, then the distorted (encoded) version. Returns a JSON report.',
  llmDescription: 'Video Quality Metrics: compute PSNR and SSIM between two videos. inputs[0] = reference/original, inputs[1] = distorted/encoded. The distorted clip is auto-scaled to the reference resolution. Returns JSON. Does not compute VMAF.',
  category: 'media',
  categories: ['inspect'],
  keywords: ['video', 'quality', 'psnr', 'ssim', 'compare', 'metrics', 'reference', 'encode', 'measure'],

  input: {
    accept: ['video/*'],
    min: 2,
    max: 2,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  installSize: 30_000_000,
  installGroup: 'ffmpeg',
  budget: VIDEO_QUALITY_BUDGET,

  defaults: defaultVideoQualityMetricsParams,

  async run(
    inputs: File[],
    _params: VideoQualityMetricsParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const { getFFmpeg, probeDuration } = await import('../../lib/ffmpeg.js');

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading ffmpeg' });
    const ff = await getFFmpeg(ctx);
    if (ctx.signal.aborted) throw new Error('Aborted');

    const reference = inputs[0]!;
    const distorted = inputs[1]!;
    const refExt = reference.name.split('.').pop() ?? 'mp4';
    const distExt = distorted.name.split('.').pop() ?? 'mp4';
    const refName = `ref.${refExt}`;
    const distName = `dist.${distExt}`;

    await ff.writeFile(refName, new Uint8Array(await reference.arrayBuffer()));
    await ff.writeFile(distName, new Uint8Array(await distorted.arrayBuffer()));

    const refDuration = await probeDuration(ff, refName);
    if (!isNaN(refDuration)) assertDurationBudget(refDuration, VIDEO_QUALITY_BUDGET);

    let log = '';
    const onLog = (e: { message: string }) => { log += e.message + '\n'; };
    ff.on('log', onLog);
    try {
      const metrics: QualityMetric[] = ['psnr', 'ssim'];
      for (let i = 0; i < metrics.length; i++) {
        const metric = metrics[i]!;
        ctx.onProgress({ stage: 'processing', percent: 20 + i * 40, message: `Computing ${metric.toUpperCase()}` });
        if (ctx.signal.aborted) throw new Error('Aborted');
        await ff.exec(buildQualityArgs(metric, refName, distName));
      }
    } finally {
      ff.off('log', onLog);
      await ff.deleteFile(refName).catch(() => {});
      await ff.deleteFile(distName).catch(() => {});
    }

    const report = parseQualityMetrics(log);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
