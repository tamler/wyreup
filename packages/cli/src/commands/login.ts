// wyreup login [apiKey]
//
// Validates the key by hitting /api/account/balance with a Bearer
// header, then persists it to ~/.wyreup/config.json (mode 0600).
// If no key is supplied as an argument, prompts via stdin.

import { createInterface } from 'node:readline';
import { writeApiKey, configPath, resolveProOrigin } from '../lib/credentials.js';

async function promptForKey(): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: process.stdin.isTTY ?? false,
  });
  return new Promise<string>((resolve, reject) => {
    rl.question('Wyreup API key (starts with wk_live_ or wk_test_): ', (answer) => {
      rl.close();
      const k = answer.trim();
      if (!k) {
        reject(new Error('No key entered.'));
        return;
      }
      resolve(k);
    });
  });
}

interface BalanceResponse {
  email?: string;
  balance?: number;
  subscriptionStatus?: string | null;
}

export async function loginCommand(positional: string | undefined): Promise<void> {
  const key = positional?.trim() || (await promptForKey());

  if (!key.startsWith('wk_live_') && !key.startsWith('wk_test_')) {
    process.stderr.write(
      "That doesn't look like a Wyreup key. Expected a string starting with " +
        'wk_live_ or wk_test_. Get one at https://wyreup.com/account.\n',
    );
    process.exit(1);
  }

  const origin = resolveProOrigin();
  let res: Response;
  try {
    res = await fetch(`${origin}/api/account/balance`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Could not reach ${origin}: ${msg}\n`);
    process.exit(2);
  }

  if (res.status === 401) {
    process.stderr.write('Key not accepted. Check that it isn’t revoked.\n');
    process.exit(1);
  }
  if (!res.ok) {
    process.stderr.write(`Unexpected response (${res.status}) from ${origin}.\n`);
    process.exit(2);
  }

  const body = (await res.json().catch(() => ({}))) as BalanceResponse;

  await writeApiKey(key);

  process.stderr.write(
    `Logged in as ${body.email ?? '(unknown email)'}.\n` +
      `Balance: ${body.balance ?? 0} credits` +
      (body.subscriptionStatus ? ` · subscription: ${body.subscriptionStatus}` : '') +
      '.\n' +
      `Key saved to ${configPath()} (mode 0600). Add ~/.wyreup/ to your dotfiles' .gitignore if you sync them.\n`,
  );
}
