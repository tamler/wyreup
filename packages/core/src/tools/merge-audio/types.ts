export type MergeAudioFormat = 'mp3' | 'wav' | 'm4a';

export interface MergeAudioParams {
  /** Output audio format. All inputs are re-encoded. Default mp3. */
  format: MergeAudioFormat;
}

export const defaultMergeAudioParams: MergeAudioParams = {
  format: 'mp3',
};
