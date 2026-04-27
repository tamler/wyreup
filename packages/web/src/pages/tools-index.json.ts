import type { APIRoute } from 'astro';
import { createDefaultRegistry } from '@wyreup/core';

export const GET: APIRoute = () => {
  const registry = createDefaultRegistry();
  const tools = Array.from(registry.toolsById.values()).map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    description: t.description,
    keywords: t.keywords ?? [],
    requires: t.requires
      ? { webgpu: t.requires.webgpu, minMemoryGB: t.requires.minMemoryGB }
      : undefined,
  }));
  return new Response(JSON.stringify(tools), {
    headers: { 'Content-Type': 'application/json' },
  });
};
