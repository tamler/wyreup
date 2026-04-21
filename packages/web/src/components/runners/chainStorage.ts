/**
 * sessionStorage-based file passthrough for chain navigation.
 * Stores blobs as Uint8Array JSON so they survive a page navigation.
 * Max supported size: ~10 MB. Larger blobs are skipped gracefully.
 */

const CHAIN_KEY = 'wyreup:chain-input';
const MAX_CHAIN_BYTES = 10 * 1024 * 1024; // 10 MB

export interface ChainPayload {
  name: string;
  type: string;
  data: number[];
}

/** Stash a File in sessionStorage for the next tool page to pick up. */
export async function stashChainFile(file: File): Promise<boolean> {
  if (file.size > MAX_CHAIN_BYTES) return false;
  try {
    const buf = await file.arrayBuffer();
    const payload: ChainPayload = {
      name: file.name,
      type: file.type,
      data: Array.from(new Uint8Array(buf)),
    };
    sessionStorage.setItem(CHAIN_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/** Retrieve and clear the stashed chain file, if any. */
export function consumeChainFile(): File | null {
  try {
    const raw = sessionStorage.getItem(CHAIN_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(CHAIN_KEY);
    const payload = JSON.parse(raw) as ChainPayload;
    const uint8 = new Uint8Array(payload.data);
    return new File([uint8], payload.name, { type: payload.type });
  } catch {
    return null;
  }
}

/** Peek at stashed file metadata without consuming it. */
export function peekChainFile(): { name: string; type: string } | null {
  try {
    const raw = sessionStorage.getItem(CHAIN_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw) as ChainPayload;
    return { name: payload.name, type: payload.type };
  } catch {
    return null;
  }
}
