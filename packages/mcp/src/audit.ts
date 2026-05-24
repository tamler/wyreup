import { appendFile, chmod, open } from 'node:fs/promises';
import { sanitize } from './sanitize.js';

export type AuditRecord = {
  ts: string;
  tool: string;
  input_paths: string[];
  output_path?: string;
  output_paths?: string[];
  status: 'ok' | 'error';
  duration_ms: number;
  error?: string;
  worker_stderr?: string;
};

export type AuditorOpts = {
  path: string | undefined;
  strict: boolean;
  apiKey: string | undefined;
  logger?: (m: string) => void;
};

export class Auditor {
  private fileEnsured = false;

  constructor(private readonly opts: AuditorOpts) {}

  async append(record: AuditRecord): Promise<void> {
    if (!this.opts.path) return;
    const out: AuditRecord = { ...record };
    if (out.error) out.error = sanitize(out.error, this.opts.apiKey);
    if (out.worker_stderr) out.worker_stderr = sanitize(out.worker_stderr, this.opts.apiKey);
    const line = JSON.stringify(out) + '\n';
    try {
      if (!this.fileEnsured) {
        const fh = await open(this.opts.path, 'a', 0o600);
        await fh.close();
        await chmod(this.opts.path, 0o600);
        this.fileEnsured = true;
      }
      await appendFile(this.opts.path, line);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (this.opts.strict) throw new Error(`audit write failed: ${msg}`);
      const log = this.opts.logger ?? ((m) => process.stderr.write(`${m}\n`));
      log(`wyreup MCP: audit write failed (loose mode, continuing): ${msg}`);
    }
  }
}
