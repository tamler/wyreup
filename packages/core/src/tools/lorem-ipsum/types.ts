export interface LoremIpsumParams {
  /** Number of paragraphs. Default 3. */
  paragraphs?: number;
  /** Sentences per paragraph. Default 5. */
  sentencesPerParagraph?: number;
  /** Words per sentence range. Default [8, 15]. */
  wordsPerSentence?: [number, number];
  /** Start with "Lorem ipsum dolor sit amet..."? Default true. */
  startWithLorem?: boolean;
}

export const defaultLoremIpsumParams: LoremIpsumParams = {
  paragraphs: 3,
  sentencesPerParagraph: 5,
  wordsPerSentence: [8, 15],
  startWithLorem: true,
};
