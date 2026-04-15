/**
 * Error thrown when chain execution fails at a specific step.
 * stepIndex is the 0-indexed position where the failure occurred.
 */
export class ChainError extends Error {
  public readonly stepIndex: number;

  constructor(message: string, stepIndex: number) {
    super(message);
    this.name = 'ChainError';
    this.stepIndex = stepIndex;
  }
}
