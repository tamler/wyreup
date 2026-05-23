// wyreup logout
//
// Zeroes the saved key without unlinking the config file (so any
// future non-key settings persist). Server-side, the key remains
// valid until revoked at /account; `logout` is purely local.

import { deleteApiKey, configPath } from '../lib/credentials.js';

export async function logoutCommand(): Promise<void> {
  await deleteApiKey();
  process.stderr.write(
    `Logged out. The local key is cleared from ${configPath()}.\n` +
      `To revoke the key server-side, visit https://wyreup.com/account.\n`,
  );
}
