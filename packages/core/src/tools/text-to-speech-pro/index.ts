import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

export type TextToSpeechProLanguage = 'EN' | 'ES';

export interface TextToSpeechProParams {
  /** EN (Deepgram Aura 1) or ES (Deepgram Aura 2 Spanish). EN default. */
  language?: TextToSpeechProLanguage;
  /** Aura speaker name for the chosen language. Omit for the default voice. */
  voice?: string;
}

export const defaultTextToSpeechProParams: TextToSpeechProParams = { language: 'EN' };

/**
 * Per-language character caps. Mirrors TTS_MAX_CHARS in
 * functions/_lib/providers/tts-models.ts (the server enforces it; a test
 * keeps the two in sync).
 */
export const TEXT_TO_SPEECH_PRO_MAX_CHARS: Readonly<Record<TextToSpeechProLanguage, number>> = {
  EN: 1_000,
  ES: 500,
};

/** Aura speakers per language. First entry is the default voice. */
export const TEXT_TO_SPEECH_PRO_VOICES: Readonly<
  Record<TextToSpeechProLanguage, readonly string[]>
> = {
  EN: [
    'asteria',
    'luna',
    'stella',
    'athena',
    'hera',
    'orion',
    'arcas',
    'perseus',
    'angus',
    'orpheus',
    'helios',
    'zeus',
  ],
  ES: [
    'aquila',
    'celeste',
    'carina',
    'diana',
    'estrella',
    'selena',
    'alvaro',
    'javier',
    'nestor',
    'sirio',
  ],
};

const LANGUAGE_NAMES: Record<TextToSpeechProLanguage, string> = { EN: 'English', ES: 'Spanish' };

const voiceOptions = (language: TextToSpeechProLanguage) =>
  TEXT_TO_SPEECH_PRO_VOICES[language].map((value) => ({
    value,
    label: value.charAt(0).toUpperCase() + value.slice(1),
  }));

interface TtsResult {
  contentType: string;
  base64: string;
}

export const textToSpeechPro: ToolModule<TextToSpeechProParams> = {
  id: 'text-to-speech-pro',
  slug: 'text-to-speech-pro',
  name: 'Text to Speech',
  description:
    'Hosted Deepgram Aura voices turn text into a natural-sounding MP3 in seconds. English (up to 1,000 characters, 12 voices) or Spanish (up to 500 characters, 10 voices). Chain it after Summarize, Translate, OCR, or Redact to hear what they produce. Uses 2 credits per run.',
  category: 'audio',
  keywords: ['tts', 'text-to-speech', 'audio', 'voice', 'mp3', 'aura', 'deepgram', 'pro', 'hosted'],

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

  chainSuggestions: ['convert-audio', 'trim-media', 'transcribe'],

  defaults: defaultTextToSpeechProParams,
  paramSchema: {
    language: {
      type: 'enum',
      label: 'voice language',
      help: 'Match the language of the input text. English allows up to 1,000 characters per run, Spanish up to 500.',
      options: [
        { value: 'EN', label: 'English' },
        { value: 'ES', label: 'Spanish' },
      ],
    },
    voice: {
      type: 'enum',
      label: 'voice',
      help: 'Each language has its own set of Aura voices.',
      options: voiceOptions('EN'),
      optionsFrom: {
        field: 'language',
        map: { EN: voiceOptions('EN'), ES: voiceOptions('ES') },
      },
    },
  },

  async run(inputs: File[], params: TextToSpeechProParams, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('text-to-speech-pro accepts exactly one input.');
    const text = (await inputs[0]!.text()).trim();
    if (!text) throw new Error('Empty input.');
    const language = params.language ?? 'EN';
    if (language !== 'EN' && language !== 'ES') {
      throw new Error('Text to Speech supports English (EN) and Spanish (ES) only.');
    }
    const max = TEXT_TO_SPEECH_PRO_MAX_CHARS[language];
    if (text.length > max) {
      throw new Error(
        `${LANGUAGE_NAMES[language]} text is limited to ${max.toLocaleString('en-US')} characters per run (this input has ${text.length.toLocaleString('en-US')}). Split it into shorter parts.`,
      );
    }
    const voice = params.voice || undefined;
    if (voice !== undefined && !TEXT_TO_SPEECH_PRO_VOICES[language].includes(voice)) {
      throw new Error(
        `Voice '${voice}' is not available for ${LANGUAGE_NAMES[language]}. Choose one of: ${TEXT_TO_SPEECH_PRO_VOICES[language].join(', ')}.`,
      );
    }

    const result = await runPro<TtsResult>(
      'text-to-speech-pro',
      { text, language, ...(voice ? { voice } : {}), fileName: inputs[0]!.name },
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
