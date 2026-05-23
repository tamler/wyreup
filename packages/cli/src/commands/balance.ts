// wyreup balance
//
// Prints the current Wyreup PRO credit balance + subscription status
// using the key resolved from env / config. No persistence side
// effects.

import { readApiKey, resolveProOrigin } from '../lib/credentials.js';

interface BalanceResponse {
  email?: string;
  balance?: number;
  subscriptionStatus?: string | null;
}

export async function balanceCommand(opts: { json?: boolean }): Promise<void> {
  const key = await readApiKey();
  if (!key) {
    process.stderr.write(
      'No Wyreup API key found. Run `wyreup login` or set WYREUP_API_KEY.\n',
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
    process.stderr.write('Your key was rejected. Run `wyreup login` to set a new one.\n');
    process.exit(1);
  }
  if (!res.ok) {
    process.stderr.write(`Unexpected response (${res.status}) from ${origin}.\n`);
    process.exit(2);
  }

  const body = (await res.json().catch(() => ({}))) as BalanceResponse;

  if (opts.json) {
    process.stdout.write(JSON.stringify(body, null, 2) + '\n');
    return;
  }

  process.stdout.write(
    `${body.email ?? '(unknown email)'}\n` +
      `Balance: ${body.balance ?? 0} credits` +
      (body.subscriptionStatus ? ` · subscription: ${body.subscriptionStatus}` : '') +
      '\n',
  );
}
