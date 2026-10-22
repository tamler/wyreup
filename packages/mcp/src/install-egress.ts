// Side-effect module. Imported FIRST from src/index.ts so the lock installs
// before any other module loads — modules that capture `fetch` at load time
// will see the locked version. Skipping this file by setting
// WYREUP_DISABLE_EGRESS_LOCK=1 disables the lock entirely.

import { installEgressLock } from './egress.js';
import { resolveModelCdn } from './runtime-config.js';

const ORIGIN = process.env['WYREUP_ORIGIN']?.replace(/\/+$/, '') ?? 'https://wyreup.com';
export let startupError: string | undefined;
try {
  const modelCdn = resolveModelCdn();
  if (process.env['WYREUP_DISABLE_EGRESS_LOCK'] !== '1') {
    installEgressLock([ORIGIN, ...modelCdn.allowedOrigins]);
  }
} catch (error) {
  installEgressLock([]);
  startupError = `Invalid WYREUP_MODEL_CDN or WYREUP_ORIGIN configuration: ${error instanceof Error ? error.message : 'Invalid URL'}`;
}
