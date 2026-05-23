// wyreup login [apiKey]
//
// Two modes:
//   - With a positional `apiKey`: validate against the server, save
//     on success, no prompt.
//   - Without: delegate to interactiveLogin() (prompts on stdin).
// Both paths share validateAndSaveKey() via lib/interactive-login.ts
// — same flow used inline when a user runs a Pro tool unauthenticated.

import { interactiveLogin, validateAndSaveKey } from '../lib/interactive-login.js';

export async function loginCommand(positional: string | undefined): Promise<void> {
  const explicit = positional?.trim();

  if (explicit) {
    const saved = await validateAndSaveKey(explicit);
    if (!saved) process.exit(1);
    return;
  }

  const saved = await interactiveLogin({
    intro:
      'Get your key at https://wyreup.com/account (signup is free; ' +
      'packs start at $5/220 credits).',
  });
  if (!saved) {
    process.stderr.write(
      'No key saved. Run `wyreup login` again, or set WYREUP_API_KEY directly.\n',
    );
    process.exit(1);
  }
}
