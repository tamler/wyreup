import { createDefaultRegistry } from '@wyreup/core';

export function listCommand(): void {
  const registry = createDefaultRegistry();
  if (registry.tools.length === 0) {
    console.log('No tools available.');
    return;
  }

  // Group by category
  const byCategory = new Map<string, typeof registry.tools[number][]>();
  for (const tool of registry.tools) {
    const cat = tool.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(tool);
  }

  console.log(`${registry.tools.length} tools available:\n`);
  for (const [category, tools] of byCategory) {
    console.log(`  ${category} (${tools.length})`);
    for (const tool of tools) {
      console.log(`    ${tool.id.padEnd(28)} ${tool.description}`);
    }
  }
  console.log(
    '\nRun a tool:   wyreup <tool-id> [inputs...] -o <output>',
  );
  console.log(
    'Chain tools:  wyreup chain <input> --steps "tool1|tool2[key=val]" -o <output>',
  );
}
