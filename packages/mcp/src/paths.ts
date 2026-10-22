import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, dirname, sep } from 'node:path';

export type AllowedRoots = string[] | '*';

export type ValidationOk = { ok: true; resolved: string };
export type ValidationErr = { ok: false; error: string };
export type ValidationResult = ValidationOk | ValidationErr;

export async function resolveAllowedRoots(
  input: string[] | '*',
  opts: { logger?: (m: string) => void } = {},
): Promise<AllowedRoots> {
  if (input === '*') return '*';
  const log = opts.logger ?? ((m) => process.stderr.write(`${m}\n`));
  const out: string[] = [];
  for (const raw of input) {
    try {
      const s = await stat(raw);
      if (!s.isDirectory()) {
        log(`wyreup MCP: allowed path is not a directory, dropped: ${raw}`);
        continue;
      }
      const resolved = await realpath(raw);
      out.push(resolved);
    } catch {
      log(`wyreup MCP: allowed path missing, dropped: ${raw}`);
    }
  }
  return out;
}

export async function assertPathAllowed(
  p: string,
  intent: 'read' | 'write' | 'write-directory',
  allowed: AllowedRoots,
): Promise<ValidationResult> {
  if (!isAbsolute(p)) return { ok: false, error: `Path must be absolute: ${p}` };

  let resolved: string;
  try {
    if (intent === 'read') {
      resolved = await realpath(p);
    } else if (intent === 'write-directory') {
      try {
        // Existing output directories may themselves be symlinks, so resolve
        // the directory rather than only its parent.
        resolved = await realpath(p);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        // A missing output directory is valid: atomicPublish creates it. Its
        // existing parent still needs canonical validation.
        const parent = await realpath(dirname(p));
        const base = p.slice(dirname(p).length);
        resolved = `${parent}${base}`;
      }
    } else {
      const parent = await realpath(dirname(p));
      const base = p.slice(dirname(p).length);
      resolved = `${parent}${base}`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Cannot resolve path ${p}: ${msg}` };
  }

  if (allowed === '*') return { ok: true, resolved };

  for (const root of allowed) {
    if (resolved === root || resolved.startsWith(root + sep)) {
      return { ok: true, resolved };
    }
  }
  return {
    ok: false,
    error: `Path outside allowed roots: ${p} (resolved: ${resolved}). Allowed: ${allowed.join(', ')}`,
  };
}
