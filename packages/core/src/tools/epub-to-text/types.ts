export interface EpubToTextParams {
  /** Prefix the extracted book text with its title and creator, when present. */
  includeMetadata?: boolean;
}

export const defaultEpubToTextParams: EpubToTextParams = {
  includeMetadata: true,
};
