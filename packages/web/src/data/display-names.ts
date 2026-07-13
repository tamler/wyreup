/**
 * Consumer display names for tools whose registry names are jargon.
 *
 * The registry name (used by CLI/MCP/devs and tool-page SEO) is the
 * fallback; this map overrides ONLY on consumer surfaces (scenario cards,
 * job pages, saved-chain chips, next-step suggestions). Keep entries few —
 * most registry names are already plain.
 */
const DISPLAY_NAMES: Record<string, string> = {
  'strip-exif': 'Remove Hidden Photo Data',
  ocr: 'Read Text from Image',
};

/** Prettify a tool id as a last resort: 'pdf-to-text' → 'Pdf To Text'. */
function prettifySlug(id: string): string {
  return id
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Consumer-facing name for a tool: curated override, else the registry
 * name when the caller has it, else a prettified slug.
 */
export function displayName(toolId: string, registryName?: string): string {
  return DISPLAY_NAMES[toolId] ?? registryName ?? prettifySlug(toolId);
}
