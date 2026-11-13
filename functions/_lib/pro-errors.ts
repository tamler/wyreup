const INPUT_MESSAGES = {
  invalid_input: 'Invalid tool input.',
  input_too_large: 'The input exceeds this tool’s limit.',
  unsupported_format: 'This file format is not supported.',
  no_extractable_text: 'No extractable text was found in this document.',
} as const;

export type ProInputCode = keyof typeof INPUT_MESSAGES;

export class ProInputError extends Error {
  constructor(readonly code: ProInputCode) { super(INPUT_MESSAGES[code]); }
}

export class ProProviderError extends Error {
  constructor(readonly code: 'no_extractable_text') { super(INPUT_MESSAGES[code]); }
}

export function safeInputError(error: unknown): { code: ProInputCode; error: string } {
  const code = error instanceof ProInputError && error.code in INPUT_MESSAGES ? error.code : 'invalid_input';
  return { code, error: INPUT_MESSAGES[code] };
}

export function safeProviderError(error: unknown): { code: 'no_extractable_text'; error: string } | null {
  return error instanceof ProProviderError && error.code === 'no_extractable_text'
    ? { code: error.code, error: INPUT_MESSAGES[error.code] } : null;
}
