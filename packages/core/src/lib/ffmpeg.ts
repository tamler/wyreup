import type { FFmpeg } from '@ffmpeg/ffmpeg';
import type { ToolRunContext } from '../types.js';

let ffmpegSingleton: FFmpeg | null = null;

/**
 * Probe an already-written MEMFS file for its duration in seconds.
 * Returns NaN if ffprobe fails or the output can't be parsed.
 * The caller is responsible for writing the file to MEMFS first.
 */
export async function probeDuration(ff: FFmpeg, inputName: string): Promise<number> {
  const probeOut = `${inputName}.probe.txt`;
  try {
    await ff.ffprobe([
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      inputName,
      '-o', probeOut,
    ]);
    const raw = await ff.readFile(probeOut);
    await ff.deleteFile(probeOut);
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    return parseFloat(text.trim());
  } catch {
    // If probe fails (e.g. unknown format), return NaN — callers treat NaN
    // as "unknown" and skip the budget check rather than blocking the user.
    return NaN;
  }
}

export async function getFFmpeg(ctx: ToolRunContext): Promise<FFmpeg> {
  const cached = ctx.cache.get('ffmpeg:instance') as FFmpeg | undefined;
  if (cached) return cached;
  if (ffmpegSingleton) {
    ctx.cache.set('ffmpeg:instance', ffmpegSingleton);
    return ffmpegSingleton;
  }

  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const { toBlobURL } = await import('@ffmpeg/util');

  const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.6/dist/esm';

  ffmpegSingleton = new FFmpeg();
  await ffmpegSingleton.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    workerURL: await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript'),
  });

  ctx.cache.set('ffmpeg:instance', ffmpegSingleton);
  return ffmpegSingleton;
}

export async function runFFmpeg(
  ff: FFmpeg,
  inputName: string,
  inputBytes: Uint8Array,
  outputName: string,
  args: string[],
): Promise<Uint8Array> {
  await ff.writeFile(inputName, inputBytes);
  await ff.exec(args);
  const output = await ff.readFile(outputName);
  await ff.deleteFile(inputName);
  await ff.deleteFile(outputName);
  return typeof output === 'string' ? new TextEncoder().encode(output) : (output);
}
