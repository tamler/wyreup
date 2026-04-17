export interface TextDiffParams {
  /** Lines of context around changes. Default 3. */
  context?: number;
}

export const defaultTextDiffParams: TextDiffParams = {
  context: 3,
};

export interface TextDiffStats {
  additions: number;
  deletions: number;
  changes: number;
}
