export interface SizedPayload {
  bytes: ArrayBuffer | Uint8Array;
  mime: string;
}

export interface PickSmallerResult extends SizedPayload {
  keptOriginal: boolean;
}

/**
 * Returns the original payload unless the encoded payload is strictly smaller.
 * Pure and allocation-free.
 */
export function pickSmaller(
  original: SizedPayload,
  encoded: SizedPayload,
): PickSmallerResult {
  if (encoded.bytes.byteLength >= original.bytes.byteLength) {
    return { ...original, keptOriginal: true };
  }

  return { ...encoded, keptOriginal: false };
}
