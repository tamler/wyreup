import type { ToolModule, ToolRunContext } from '../../types.js';

// Analyze-loudness measures an existing file as-is; it has no parameters.
export type AnalyzeLoudnessParams = Record<string, never>;

export const defaultAnalyzeLoudnessParams: AnalyzeLoudnessParams = {};

export interface LoudnessReport {
  integratedLufs: number | null;
  loudnessRange: number | null;
  truePeakDbtp: number | null;
  threshold: number | null;
}

/**
 * Read the trailing "Summary:" block that ebur128 prints to the ffmpeg log.
 * Missing fields come back as null rather than throwing, so a partial
 * measurement still returns something useful.
 */
export function parseEbur128Summary(log: string): LoudnessReport {
  const num = (re: RegExp): number | null => {
    const m = log.match(re);
    return m && m[1] !== undefined ? parseFloat(m[1]) : null;
  };
  return {
    integratedLufs: num(/I:\s*(-?[\d.]+)\s*LUFS/),
    loudnessRange: num(/LRA:\s*(-?[\d.]+)\s*LU\b/),
    truePeakDbtp: num(/Peak:\s*(-?[\d.]+)\s*dBFS/),
    threshold: num(/Threshold:\s*(-?[\d.]+)\s*LUFS/),
  };
}

/** Measure loudness without producing any media: `-f null -` discards output. */
export function buildAnalyzeArgs(inputName: string): string[] {
  return [
    '-i', inputName,
    '-af', 'ebur128=peak=true',
    '-f', 'null',
    '-',
  ];
}

export const analyzeLoudness: ToolModule<AnalyzeLoudnessParams> = {
  id: 'analyze-loudness',
  slug: 'analyze-loudness',
  name: 'Analyze Loudness',
  description: 'Measure a clip\'s integrated loudness (LUFS), loudness range, and true peak (EBU R128). Returns a JSON report.',
  category: 'media',
  categories: ['audio', 'inspect'],
  keywords: ['loudness', 'analyze', 'measure', 'lufs', 'true peak', 'ebu', 'r128', 'audio', 'meter'],

  input: {
    accept: ['audio/*', 'video/*'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  installSize: 30_000_000,
  installGroup: 'ffmpeg',

  defaults: defaultAnalyzeLoudnessParams,

  async run(
    inputs: File[],
    _params: AnalyzeLoudnessParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const { getFFmpeg } = await import('../../lib/ffmpeg.js');

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading ffmpeg' });
    const ff = await getFFmpeg(ctx);
    if (ctx.signal.aborted) throw new Error('Aborted');

    const input = inputs[0]!;
    const ext = input.name.split('.').pop() ?? 'bin';
    const inputName = `input.${ext}`;
    await ff.writeFile(inputName, new Uint8Array(await input.arrayBuffer()));

    ctx.onProgress({ stage: 'processing', percent: 40, message: 'Measuring loudness' });

    let log = '';
    const onLog = (e: { message: string }) => { log += e.message + '\n'; };
    ff.on('log', onLog);
    try {
      await ff.exec(buildAnalyzeArgs(inputName));
    } finally {
      ff.off('log', onLog);
      await ff.deleteFile(inputName).catch(() => {});
    }

    const report = parseEbur128Summary(log);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
