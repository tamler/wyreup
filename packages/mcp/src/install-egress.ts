// Side-effect module. Imported FIRST from src/index.ts so the lock installs
// before any other module loads — modules that capture `fetch` at load time
// will see the locked version. Skipping this file by setting
// WYREUP_DISABLE_EGRESS_LOCK=1 disables the lock entirely.

import { installEgressLock } from './egress.js';

const ORIGIN = process.env['WYREUP_ORIGIN']?.replace(/\/+$/, '') ?? 'https://wyreup.com';
if (process.env['WYREUP_DISABLE_EGRESS_LOCK'] !== '1') {
  installEgressLock(ORIGIN);
}
