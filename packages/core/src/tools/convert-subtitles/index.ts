import type { ToolModule, ToolRunContext } from '../../types.js';

export type SubtitleFormat = 'srt' | 'vtt';

export interface ConvertSubtitlesParams {
  to: SubtitleFormat;
  timeShiftSeconds?: number;
}

export const defaultConvertSubtitlesParams: ConvertSubtitlesParams = {
  to: 'srt',
};

export function detectSubtitleFormat(content: string): SubtitleFormat | null {
  const trimmed = content.trimStart();
  if (trimmed.startsWith('WEBVTT')) return 'vtt';
  // SRT: starts with a number
  if (/^\d+\s*\n/.test(trimmed)) return 'srt';
  return null;
}

function srtTimestamp(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  const millis = ms % 1_000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

function vttTimestamp(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  const millis = ms % 1_000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function parseTimeMs(ts: string): number {
  // Handles both SRT (hh:mm:ss,mmm) and VTT (hh:mm:ss.mmm or mm:ss.mmm)
  const normalized = ts.replace(',', '.');
  const parts = normalized.split(':');
  if (parts.length === 3) {
    const [h, m, sm] = parts as [string, string, string];
    const [s, ms] = sm.split('.');
    return (
      parseInt(h, 10) * 3_600_000 +
      parseInt(m, 10) * 60_000 +
      parseInt(s ?? '0', 10) * 1_000 +
      parseInt((ms ?? '0').padEnd(3, '0'), 10)
    );
  }
  if (parts.length === 2) {
    const [m, sm] = parts as [string, string];
    const [s, ms] = sm.split('.');
    return (
      parseInt(m, 10) * 60_000 +
      parseInt(s ?? '0', 10) * 1_000 +
      parseInt((ms ?? '0').padEnd(3, '0'), 10)
    );
  }
  return 0;
}

export function convertSrtToVtt(srt: string, shiftMs = 0): string {
  const lines = ['WEBVTT', ''];
  const blocks = srt.trim().split(/\n\s*\n/);
  for (const block of blocks) {
    const blockLines = block.trim().split('\n');
    // Skip index line (first line is a number)
    let lineIdx = 0;
    if (/^\d+$/.test((blockLines[0] ?? '').trim())) {
      lineIdx = 1;
    }
    const timeLine = blockLines[lineIdx];
    if (!timeLine) continue;
    const timeMatch = timeLine.match(/(\S+)\s+-->\s+(\S+)/);
    if (!timeMatch) continue;
    const startMs = parseTimeMs(timeMatch[1]!) + shiftMs;
    const endMs = parseTimeMs(timeMatch[2]!) + shiftMs;
    lines.push(`${vttTimestamp(Math.max(0, startMs))} --> ${vttTimestamp(Math.max(0, endMs))}`);
    lines.push(...blockLines.slice(lineIdx + 1));
    lines.push('');
  }
  return lines.join('\n');
}

export function convertVttToSrt(vtt: string, shiftMs = 0): string {
  const lines: string[] = [];
  const blocks = vtt.trim().split(/\n\s*\n/);
  let index = 1;
  for (const block of blocks) {
    const blockLines = block.trim().split('\n');
    // Skip WEBVTT header block
    if (blockLines[0]?.startsWith('WEBVTT') || blockLines[0]?.startsWith('NOTE')) continue;
    const timeLine = blockLines.find((l) => l.includes('-->'));
    if (!timeLine) continue;
    const timeMatch = timeLine.match(/(\S+)\s+-->\s+(\S+)/);
    if (!timeMatch) continue;
    const startMs = parseTimeMs(timeMatch[1]!) + shiftMs;
    const endMs = parseTimeMs(timeMatch[2]!) + shiftMs;
    const textLines = blockLines.filter((l) => !l.includes('-->') && !/^\d+$/.test(l.trim()) && l.trim() !== '');
    lines.push(String(index++));
    lines.push(`${srtTimestamp(Math.max(0, startMs))} --> ${srtTimestamp(Math.max(0, endMs))}`);
    lines.push(...textLines);
    lines.push('');
  }
  return lines.join('\n');
}

const ConvertSubtitlesComponentStub = (): unknown => null;

export const convertSubtitles: ToolModule<ConvertSubtitlesParams> = {
  id: 'convert-subtitles',
  slug: 'convert-subtitles',
  name: 'Convert Subtitles',
  description: 'Convert subtitle files between SRT and WebVTT formats, with optional time shift.',
  category: 'media',
  presence: 'both',
  keywords: ['subtitles', 'srt', 'vtt', 'webvtt', 'captions', 'convert'],

  input: {
    accept: ['text/vtt', 'application/x-subrip', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  installSize: 30_000_000,
  installGroup: 'ffmpeg',

  defaults: defaultConvertSubtitlesParams,

  Component: ConvertSubtitlesComponentStub,

  async run(
    inputs: File[],
    params: ConvertSubtitlesParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const input = inputs[0]!;
    const text = await input.text();
    const detectedFormat = detectSubtitleFormat(text);

    if (!detectedFormat) {
      throw new Error('Could not detect subtitle format. Ensure the file is SRT or WebVTT.');
    }

    const shiftMs = Math.round((params.timeShiftSeconds ?? 0) * 1000);

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Converting subtitles' });

    let output: string;
    let outputMime: string;

    if (params.to === 'vtt') {
      if (detectedFormat === 'vtt' && shiftMs === 0) {
        output = text;
      } else if (detectedFormat === 'vtt') {
        // VTT -> SRT -> VTT with shift applied at the SRT->VTT step
        output = convertSrtToVtt(convertVttToSrt(text, 0), shiftMs);
      } else {
        output = convertSrtToVtt(text, shiftMs);
      }
      outputMime = 'text/vtt';
    } else {
      if (detectedFormat === 'srt' && shiftMs === 0) {
        output = text;
      } else if (detectedFormat === 'srt') {
        output = convertVttToSrt(convertSrtToVtt(text, 0), shiftMs);
      } else {
        output = convertVttToSrt(text, shiftMs);
      }
      outputMime = 'text/plain';
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([output], { type: outputMime })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
