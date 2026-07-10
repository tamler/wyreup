// Side-effect module. Imported FIRST from src/index.ts so the lock installs
// before any other module loads.
//
// CLI allowlist differs from MCP — the CLI hits TWO origins:
//   - WYREUP_ORIGIN (default https://wyreup.com): Pro tools + auth + balance
//   - WYREUP_MODEL_CDN (default https://models.wyreup.com): model weight downloads
//
// Skipping the lock: set WYREUP_DISABLE_EGRESS_LOCK=1.

import { installEgressLock } from './egress.js';

const PRO_ORIGIN = process.env['WYREUP_ORIGIN']?.replace(/\/+$/, '') ?? 'https://wyreup.com';

// WYREUP_MODEL_CDN can be 'disabled' (don't pin), a URL, or unset (default to models.wyreup.com).
// When disabled, we allow upstream HF/CDN origins through — but we don't enumerate them, so
// disabling the model CDN ALSO disables the egress lock (else legit downloads break).
const modelCdnRaw = process.env['WYREUP_MODEL_CDN'];
const modelCdnDisabled = modelCdnRaw === 'disabled';
const MODEL_ORIGIN = modelCdnDisabled
  ? undefined
  : modelCdnRaw && modelCdnRaw.length > 0
    ? modelCdnRaw.replace(/\/+$/, '')
    : 'https://models.wyreup.com';

if (process.env['WYREUP_DISABLE_EGRESS_LOCK'] !== '1' && !modelCdnDisabled && MODEL_ORIGIN) {
  installEgressLock([PRO_ORIGIN, MODEL_ORIGIN]);
}
