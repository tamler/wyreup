/**
 * Tests for the `login` command — specifically that passing the API key as a
 * positional CLI argument emits a security warning to stderr (the key is
 * exposed in process listings / shell history / CI logs).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── mock the interactive-login module the command delegates to ────────────────

const mockValidateAndSaveKey = vi.fn();
const mockInteractiveLogin = vi.fn();

vi.mock('../src/lib/interactive-login.js', () => ({
  validateAndSaveKey: (...args: unknown[]) => mockValidateAndSaveKey(...args) as unknown,
  interactiveLogin: (...args: unknown[]) => mockInteractiveLogin(...args) as unknown,
}));

import { loginCommand } from '../src/commands/login.js';

let stderrOutput: string[];

beforeEach(() => {
  stderrOutput = [];
  mockValidateAndSaveKey.mockReset().mockResolvedValue(true);
  mockInteractiveLogin.mockReset().mockResolvedValue(true);
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    stderrOutput.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loginCommand — positional key warning', () => {
  it('warns to stderr when the key is passed as a positional argument', async () => {
    await loginCommand('wyr_live_secret');

    const err = stderrOutput.join('\n');
    expect(err).toMatch(/command-line argument exposes it/i);
    expect(err).toMatch(/WYREUP_API_KEY/);
    // The warning must never echo the key itself.
    expect(err).not.toContain('wyr_live_secret');
    expect(mockValidateAndSaveKey).toHaveBeenCalledWith('wyr_live_secret');
  });

  it('does not warn when no positional key is given (interactive path)', async () => {
    await loginCommand(undefined);

    const err = stderrOutput.join('\n');
    expect(err).not.toMatch(/command-line argument exposes it/i);
    expect(mockInteractiveLogin).toHaveBeenCalled();
  });
});
