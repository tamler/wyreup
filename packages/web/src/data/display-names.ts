/**
 * Consumer display names for tools whose registry names are jargon.
 *
 * The registry name is the fallback. Consumer labels also apply where the
 * site has only a tool ID, such as saved-chain chips.
 */
const DISPLAY_NAMES: Record<string, string> = {
  'strip-exif': 'Remove Hidden Photo Data',
  ocr: 'Read Text from Image',
  'ocr-pro': 'Neural OCR',
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
