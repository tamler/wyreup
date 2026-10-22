import type { APIRoute } from 'astro';
import { createDefaultRegistry } from '@wyreup/core';
import { projectToolDiscoveryMetadata } from '../lib/tool-discovery-metadata';

export const GET: APIRoute = () => {
  const registry = createDefaultRegistry();
  const tools = Array.from(registry.toolsById.values()).map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    description: projectToolDiscoveryMetadata(t).description,
    keywords: projectToolDiscoveryMetadata(t).keywords,
    requires: t.requires
      ? { webgpu: t.requires.webgpu, minMemoryGB: t.requires.minMemoryGB }
      : undefined,
  }));
  return new Response(JSON.stringify(tools), {
    headers: { 'Content-Type': 'application/json' },
  });
};
