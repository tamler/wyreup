#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDefaultRegistry } from '@wyreup/core';
import { createWyreupMcpServer } from './server.js';

async function main(): Promise<void> {
  const server = createWyreupMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const toolCount = createDefaultRegistry().toolsById.size;
  console.error(`[wyreup-mcp] ready — ${toolCount} tools exposed`);
}

main().catch((err: unknown) => {
  console.error('[wyreup-mcp] fatal:', err);
  process.exit(1);
});
