import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';
import { boundedText, TTS_MAX_BYTES, ttsLanguage } from '../../lib/pro-migration-limits.js';

export interface TextToSpeechProParams {
  /** English or Spanish. Other languages are currently unavailable. */
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
    'Hosted text to speech for English and Spanish, up to 500 UTF-8 bytes per run. French, Chinese, Japanese and Korean are currently unavailable. Produces MP3 and uses 2 credits per run.',
  category: 'audio',
  keywords: ['tts', 'text-to-speech', 'audio', 'voice', 'mp3', 'pro', 'hosted'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: TTS_MAX_BYTES,
  },
  output: { mime: 'audio/mpeg' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 2,
  memoryEstimate: 'low',

  chainSuggestions: ['convert-audio', 'trim-media', 'transcribe'],

  defaults: defaultTextToSpeechProParams,
  paramSchema: {
    language: {
      type: 'enum',
      label: 'voice language',
      help: 'English and Spanish only; French, Chinese, Japanese and Korean are currently unavailable.',
      options: [
        { value: 'EN', label: 'English' },
        { value: 'ES', label: 'Spanish' },
      ],
    },
  },

  async run(inputs: File[], params: TextToSpeechProParams, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('text-to-speech-pro accepts exactly one input.');
    const text = (await inputs[0]!.text()).trim();
    if (!text) throw new Error('Empty input.');
    boundedText(text, TTS_MAX_BYTES, 'Text to Speech input');
    ttsLanguage(params.language ?? 'EN');

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
