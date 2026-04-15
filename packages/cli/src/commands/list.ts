import { createRegistry } from '@wyreup/core';

export function listCommand(): void {
  const registry = createRegistry([]);
  if (registry.tools.length === 0) {
    console.log('No tools available yet (Wave 0 scaffold).');
    return;
  }
  for (const tool of registry.tools) {
    console.log(`${tool.id} — ${tool.description}`);
  }
}
