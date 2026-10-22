export interface WordCounterParams {
  speakingWPM?: number;
  postLimit?: number;
}

export const defaultWordCounterParams: WordCounterParams = { speakingWPM: 150, postLimit: 280 };

export interface WordCounterResult {
  words: number;
  characters: number;
  charactersNoSpaces: number;
  sentences: number;
  paragraphs: number;
  lines: number;
  readingTimeMinutes: number;
  utf8Bytes: number;
  codePoints: number;
  graphemes: number | null;
  graphemeCounting: 'available' | 'unavailable';
  wordCounting: 'intl-segmenter' | 'unicode-token-fallback';
  speakingSeconds: number;
  postLimit: number;
  remaining: number;
  over: number;
}
