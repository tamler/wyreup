import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const readKey = vi.hoisted(() => vi.fn<() => Promise<string | null>>());
vi.mock('../src/lib/credentials.js', () => ({ readApiKey: readKey }));
import { printError } from '../src/lib/safety/print-error';
let output: string;
beforeEach(() => {
  output = '';
  readKey.mockReset();
  vi.spyOn(process.stderr, 'write').mockImplementation((value) => {
    output += typeof value === 'string' ? value : value.toString();
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});
describe('independent CLI error credential ownership', () => {
  it('known free invocation skips key reads while preserving generic bearer redaction', async () => {
    await printError('Free error', new Error('Bearer TOKEN_PRIVATE_CANARY failed.'), null);
    expect(readKey).not.toHaveBeenCalled();
    expect(output).toBe('Free error: Bearer [REDACTED] failed.\n');
  });
  it('already-resolved key is redacted literally and generically without a second lookup', async () => {
    await printError(
      'Credit error',
      new Error('KEY_PRIVATE_CANARY and bearer OTHER_PRIVATE_CANARY failed.'),
      'KEY_PRIVATE_CANARY',
    );
    expect(readKey).not.toHaveBeenCalled();
    expect(output).toBe('Credit error: [REDACTED] and bearer [REDACTED] failed.\n');
  });
  it('unspecified credential ownership retains existing key lookup and literal redaction', async () => {
    readKey.mockResolvedValue('SAVED_PRIVATE_CANARY');
    await printError('Legacy error', new Error('SAVED_PRIVATE_CANARY failed.'));
    expect(readKey).toHaveBeenCalledOnce();
    expect(output).toBe('Legacy error: [REDACTED] failed.\n');
  });
  it('unreadable credentials still allow generic bearer redaction', async () => {
    readKey.mockRejectedValue(new Error('UNREADABLE_PRIVATE_CANARY'));
    await printError('Fallback error', new Error('Bearer RAW_PRIVATE_CANARY failed.'));
    expect(readKey).toHaveBeenCalledOnce();
    expect(output).toBe('Fallback error: Bearer [REDACTED] failed.\n');
  });
});
