import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro, fileToBase64 } from '../../lib/pro-runner.js';

export interface TranscribeAndTranslateParams {
  target: string;
  language: string;
}

export const defaultTranscribeAndTranslateParams: TranscribeAndTranslateParams = {
  target: 'English',
  language: 'en',
};

export const transcribeAndTranslate: ToolModule<TranscribeAndTranslateParams> = {
  id: 'transcribe-and-translate',
  slug: 'transcribe-and-translate',
  name: 'Transcribe & Translate',
  description:
    'Transcribes an audio file and translates the transcript in one step. Uses 5 credits per run.',
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
  creditCost: 5,
  memoryEstimate: 'low',
  outputDisplay: 'prose',

  chainSuggestions: ['text-sentences', 'word-counter', 'text-summarize-pro'],

  defaults: defaultTranscribeAndTranslateParams,
  paramSchema: {
    target: {
      type: 'string',
      label: 'translate to',
      placeholder: 'English',
      help: 'The language to translate the transcript into.',
    },
    language: {
      type: 'enum',
      label: 'spoken language',
      help: 'Source language hint for transcription. "auto" works but is slower.',
      options: [
        { value: 'auto', label: 'auto-detect' },
        { value: 'en', label: 'English' },
        { value: 'es', label: 'Spanish' },
        { value: 'fr', label: 'French' },
        { value: 'de', label: 'German' },
        { value: 'pt', label: 'Portuguese' },
        { value: 'it', label: 'Italian' },
        { value: 'ja', label: 'Japanese' },
        { value: 'zh', label: 'Chinese' },
        { value: 'ar', label: 'Arabic' },
        { value: 'hi', label: 'Hindi' },
      ],
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
      {
        audioBase64,
        target: params.target?.trim() || 'English',
        language: params.language || 'en',
        fileName: inputs[0]!.name,
      },
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
