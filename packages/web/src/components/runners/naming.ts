/**
 * Build a download filename that preserves the original basename and appends
 * the tool id. Falls back to "{toolId}-result.{ext}" when there's no source
 * file (generators) or when the original name is unusable.
 *
 * Examples:
 *   buildDownloadName('IMG_1234.jpg', 'rotate-image', 'jpeg')
 *     → 'IMG_1234-rotate-image.jpeg'
 *   buildDownloadName(undefined, 'qr-create', 'png')
 *     → 'qr-create-result.png'
 */
export function buildDownloadName(
  sourceName: string | undefined,
  toolId: string,
  ext: string,
): string {
  const safeExt = ext || 'bin';
  if (!sourceName) return `${toolId}-result.${safeExt}`;
  const trimmed = sourceName.trim();
  if (!trimmed) return `${toolId}-result.${safeExt}`;
  // Strip the last extension if present (e.g. "photo.jpg" → "photo").
  const base = trimmed.replace(/\.[^./\\]+$/, '');
  if (!base) return `${toolId}-result.${safeExt}`;
  return `${base}-${toolId}.${safeExt}`;
}
