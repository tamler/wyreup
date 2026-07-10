import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

export interface TextToSpeechProParams {
  /** Language code understood by melotts. EN default. */
  language?: 'EN' | 'ES' | 'FR' | 'ZH' | 'JP' | 'KR';
}

export const defaultTextToSpeechProParams: TextToSpeechProParams = { language: 'EN' };

interface TtsResult {
  contentType: string;
  base64: string;
}

export const textToSpeechPro: ToolModule<TextToSpeechProParams> = {
  id: 'text-to-speech-pro',
  slug: 'text-to-speech-pro',
  name: 'Text to Speech',
  description:
    'Hosted neural TTS — turns text into a natural-sounding MP3 in seconds. Chain it after Summarize, Translate, OCR, or Redact to get audio out of any tool that produces text. Uses 2 credits per run.',
  category: 'audio',
  keywords: ['tts', 'text-to-speech', 'audio', 'voice', 'mp3', 'pro', 'hosted'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 32 * 1024,
  },
  output: { mime: 'audio/mpeg' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 2,
  memoryEstimate: 'low',

  chainSuggestions: ['text-summarize-pro', 'text-translate-pro', 'text-redact-pro'],

  defaults: defaultTextToSpeechProParams,
  paramSchema: {
    language: {
      type: 'enum',
      label: 'voice language',
      help: 'Match the language of the input text for best pronunciation.',
      options: [
        { value: 'EN', label: 'English' },
        { value: 'ES', label: 'Spanish' },
        { value: 'FR', label: 'French' },
        { value: 'ZH', label: 'Chinese' },
        { value: 'JP', label: 'Japanese' },
        { value: 'KR', label: 'Korean' },
      ],
    },
  },

  async run(inputs: File[], params: TextToSpeechProParams, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('text-to-speech-pro accepts exactly one input.');
    const text = (await inputs[0]!.text()).trim();
    if (!text) throw new Error('Empty input.');

    const result = await runPro<TtsResult>(
      'text-to-speech-pro',
      { text, language: params.language ?? 'EN', fileName: inputs[0]!.name },
      ctx,
    );

    const bytes = base64ToBytes(result.base64);
    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([bytes.buffer as ArrayBuffer], { type: result.contentType });
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['audio/mpeg'] },
};

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
