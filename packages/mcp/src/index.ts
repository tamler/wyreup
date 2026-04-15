#!/usr/bin/env node
import { createWyreupMcpServer } from './server.js';

async function main(): Promise<void> {
  const server = createWyreupMcpServer();
  await server.start();
}

main().catch((err: unknown) => {
  console.error('[wyreup-mcp] fatal:', err);
  process.exit(1);
});
