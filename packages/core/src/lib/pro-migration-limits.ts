export const TTS_MAX_BYTES = 500;
export const GRAMMAR_MAX_BYTES = 4_000;
export const ANALYSIS_TEXT_MAX_BYTES = 34_000;
export const ANALYSIS_QUESTION_MAX_BYTES = 1_500;

export class ProInputError extends Error {
  constructor(public readonly code: 'input_too_long' | 'unsupported_language', message: string) {
    super(message);
    this.name = 'ProInputError';
  }
}

export function boundedText(text: string, maxBytes: number, label: string): void {
  const encoder = new TextEncoder();
  const bytes = Math.max(encoder.encode(text).length, encoder.encode(text.normalize('NFKC')).length);
  if (bytes > maxBytes) throw new ProInputError('input_too_long', `${label} exceeds the ${maxBytes}-byte limit.`);
}

export function ttsLanguage(language: string): asserts language is 'EN' | 'ES' {
  if (language !== 'EN' && language !== 'ES') {
    throw new ProInputError('unsupported_language', 'Text to Speech supports English and Spanish. French, Chinese, Japanese and Korean are currently unavailable.');
  }
}
