import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

export interface TranscribeAndTranslateParams {
  target: string;
}

export const defaultTranscribeAndTranslateParams: TranscribeAndTranslateParams = {
  target: 'English',
};

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]!);
  return btoa(binary);
}

export const transcribeAndTranslate: ToolModule<TranscribeAndTranslateParams> = {
  id: 'transcribe-and-translate',
  slug: 'transcribe-and-translate',
  name: 'Transcribe & Translate (PRO)',
  description:
    'Transcribes an audio file and translates the transcript in one step. Uses 6 credits per run.',
  category: 'export',
  keywords: ['transcribe', 'translate', 'audio', 'speech', 'pro', 'hosted'],

  input: {
    accept: ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/x-m4a', 'audio/webm'],
    min: 1,
    max: 1,
    sizeLimit: 25 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 6,
  memoryEstimate: 'low',
  surfaces: ['web'],
  outputDisplay: 'prose',

  chainSuggestions: ['text-summarize-pro', 'text-sentences'],

  defaults: defaultTranscribeAndTranslateParams,
  paramSchema: {
    target: {
      type: 'string',
      label: 'translate to',
      placeholder: 'English',
      help: 'The language to translate the transcript into.',
    },
  },

  async run(
    inputs: File[],
    params: TranscribeAndTranslateParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) {
      throw new Error('transcribe-and-translate accepts exactly one audio file.');
    }
    const audioBase64 = await fileToBase64(inputs[0]!);
    const result = await runPro<{ translation: string; transcript: string; target: string }>(
      'transcribe-and-translate',
      { audioBase64, target: params.target?.trim() || 'English', fileName: inputs[0]!.name },
      ctx,
    );
    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([result.translation], { type: 'text/plain' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
