import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { configuredHosts } from './download.js';
import { LIMITS } from './limits.js';
import { createServer } from './server.js';

try {
  const hosts = configuredHosts(process.env.WYREUP_CHATGPT_DOWNLOAD_HOSTS);
  const server = createServer(hosts);
  let closing = false;
  const close = (): void => {
    if (closing) return;
    closing = true;
    void server.close().catch(() => { process.exitCode = 1; });
  };
  process.stdin.once('end', close);
  process.stdin.once('close', close);
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  await server.connect(new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: LIMITS.inputJson }));
} catch {
  process.stderr.write('The private file adapter could not start.\n');
  process.exitCode = 1;
}
