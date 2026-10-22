// Side-effect module. Imported FIRST from src/index.ts so the lock installs
// before any other module loads.
//
// The CLI allowlist permits the trusted public origin and configured model origins:
//   - WYREUP_ORIGIN (default https://wyreup.com): Pro tools + auth + balance
//   - WYREUP_MODEL_CDN (default https://models.wyreup.com), or configured upstreams
//     when the model mirror is disabled: model weight downloads
//
// Skipping the lock: set WYREUP_DISABLE_EGRESS_LOCK=1.

import { installEgressLock } from './egress.js';
import { resolveModelCdn } from './runtime-config.js';

const PRO_ORIGIN = process.env['WYREUP_ORIGIN']?.replace(/\/+$/, '') ?? 'https://wyreup.com';

export let startupError: string | undefined;
try {
  const modelCdn = resolveModelCdn();
  if (process.env['WYREUP_DISABLE_EGRESS_LOCK'] !== '1') {
    installEgressLock([PRO_ORIGIN, ...modelCdn.allowedOrigins]);
  }
} catch (error) {
  // Keep all egress blocked while the entrypoint reports invalid config.
  installEgressLock([]);
  startupError = `Invalid WYREUP_MODEL_CDN or WYREUP_ORIGIN configuration: ${error instanceof Error ? error.message : 'Invalid URL'}`;
}
