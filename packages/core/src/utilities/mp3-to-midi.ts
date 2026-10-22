import type { ToolModule } from '../types.js';
import { decodeMp3Mono, type Mp3Decoder } from './midi-audio.js';
import { runPitchFileJob } from './midi-job.js';
import {
  defaultPitchParams,
  pitchSchema,
  validatePitchParams,
  selectPitchNotes,
  encodePitchMidi,
  type PitchReport,
} from './midi-pitch.js';
import type { UtilityParams } from './common.js';

export async function analyzeMp3File(
  file: File,
  params: UtilityParams,
  signal: AbortSignal,
  decoder: Mp3Decoder = decodeMp3Mono,
): Promise<PitchReport> {
  if (signal.aborted) throw new Error('Audio conversion cancelled.');
  if (file.size > 10 * 1024 * 1024) throw new Error('MP3 input exceeds 10 MiB.');
  const checked = validatePitchParams(params);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (signal.aborted) throw new Error('Audio conversion cancelled.');
  const mono = await decoder(bytes, signal);
  if (signal.aborted) throw new Error('Audio conversion cancelled.');
  return runPitchFileJob(mono, checked, signal);
}

export const mp3ToMidi: ToolModule<UtilityParams> = {
  id: 'mp3-to-midi',
  slug: 'mp3-to-midi',
  name: 'MP3 to MIDI',
  description:
    'Experimental local monophonic melody transcription. Preview and select detected notes before MIDI export. Polyphonic music, drums and voice reconstruction are unsupported.',
  category: 'audio',
  keywords: ['mp3', 'midi', 'melody', 'monophonic', 'pitch'],
  input: { accept: ['audio/mpeg', '.mp3'], min: 1, max: 1, sizeLimit: 10 * 1024 * 1024 },
  output: { mime: 'audio/midi', multiple: false },
  defaults: defaultPitchParams,
  paramSchema: pitchSchema,
  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  surfaces: ['web'],
  async run(inputs, params, ctx) {
    if (inputs.length !== 1) throw new Error('Select one MP3 file.');
    const checked = validatePitchParams(params);
    ctx.onProgress({
      stage: 'processing',
      percent: 5,
      message: 'Decoding bounded MP3 audio locally',
    });
    const report = await analyzeMp3File(inputs[0]!, checked, ctx.signal);
    if (ctx.signal.aborted) throw new Error('Audio conversion cancelled.');
    const midi = encodePitchMidi(
      selectPitchNotes(report.notes, checked.acceptedNoteIds),
      checked.tempo as number,
    );
    ctx.onProgress({ stage: 'done', percent: 100 });
    return [new Blob([new Uint8Array(midi)], { type: 'audio/midi' })];
  },
  __testFixtures: {
    valid: ['test/fixtures/catalog-files/melody-220-440.mp3'],
    weird: [],
    expectedOutputMime: ['audio/midi'],
  },
};
