/**
 * Tracks which tools the user has successfully run on this device.
 * Used by `ToolDownloadNotice` to suppress the first-use download
 * notice on revisits — the SW disk cache survives independently,
 * so re-loads are fast and we don't need to nag.
 *
 * Stored as a flat object in localStorage; reads/writes are guarded.
 */

const STORAGE_KEY = 'wyreup:tools-used';

function read(): Record<string, true> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, true>) : {};
  } catch {
    return {};
  }
}

export function markToolUsed(toolId: string): void {
  if (typeof localStorage === 'undefined' || !toolId) return;
  try {
    const used = read();
    if (used[toolId]) return;
    used[toolId] = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(used));
  } catch {
    /* ignore quota/permission errors */
  }
}

export function hasToolBeenUsed(toolId: string): boolean {
  return read()[toolId] === true;
}
