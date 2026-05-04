/**
 * Smoke test for `wyreup init-tool`. The command is fully interactive
 * via @clack/prompts and writes to the filesystem; full coverage would
 * require mocking @clack and the fs together. The valuable part of the
 * scaffold logic — the template generator — is covered separately by
 * init-tool-scaffold.test.ts. This file just asserts the command export
 * exists and is callable, catching obvious wiring regressions.
 */
import { describe, it, expect } from 'vitest';
import { initToolCommand } from '../src/commands/init-tool.js';

describe('initToolCommand', () => {
  it('is exported as an async function', () => {
    expect(typeof initToolCommand).toBe('function');
    // Constructed signature: () => Promise<void>. We don't actually
    // invoke it (it would block on prompts) — this catches the case
    // where a refactor accidentally drops the export.
  });
});
