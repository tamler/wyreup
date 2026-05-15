#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDefaultRegistry, setModelCdn } from '@wyreup/core';
import { createWyreupMcpServer } from './server.js';

// Route every AI-model fetch through models.wyreup.com (R2-backed,
// first-party origin). Override with WYREUP_MODEL_CDN=disabled to fall
// back to upstream CDNs (escape hatch for testing or if R2 is down).
{
  const cdnOverride = process.env.WYREUP_MODEL_CDN;
  if (cdnOverride === 'disabled') {
    setModelCdn(null);
  } else {
    setModelCdn(
      cdnOverride && cdnOverride.length > 0 ? cdnOverride : 'https://models.wyreup.com',
    );
  }
}

async function main(): Promise<void> {
  const server = createWyreupMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const registry = createDefaultRegistry();
  const toolCount = registry.toolsById.size;
  const heavyCount = Array.from(registry.toolsById.values()).filter(
    (t) => (t.installSize ?? 0) > 0,
  ).length;
  console.error(
    `[wyreup-mcp] ready — ${toolCount} tools exposed, plus the wyreup_chain meta-tool`,
  );
  if (heavyCount > 0) {
    // Heads-up so an agent operator knows the first invocation of an
    // ML tool will hit the network. The Transformers.js cache lives at
    // ~/.cache/huggingface/hub by default and is shared with the CLI.
    console.error(
      `[wyreup-mcp] tip: ${heavyCount} tools download a model on first use. ` +
        `Run \`wyreup prefetch --all\` from the @wyreup/cli to warm the ` +
        `cache for offline / scripted use.`,
    );
  }
}

main().catch((err: unknown) => {
  console.error('[wyreup-mcp] fatal:', err);
  process.exit(1);
});
