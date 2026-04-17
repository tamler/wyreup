export interface WordCounterParams {
  // No params — counts everything.
}

export const defaultWordCounterParams: WordCounterParams = {};

export interface WordCounterResult {
  words: number;
  characters: number;
  charactersNoSpaces: number;
  sentences: number;
  paragraphs: number;
  lines: number;
  readingTimeMinutes: number;
}
