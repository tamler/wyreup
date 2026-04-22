/**
 * Chain URL encoding/decoding.
 *
 * Format: tool IDs pipe-delimited, params in parens with key=value pairs.
 * Example: strip-exif|resize(w=1200,h=800)|compress(q=85)
 *
 * Values are URI-component encoded so special chars survive a round-trip.
 */

export interface ChainStepSpec {
  toolId: string;
  params: Record<string, unknown>;
}

/**
 * Encode a chain to a URL-safe string.
 */
export function encodeChainSteps(steps: ChainStepSpec[]): string {
  return steps
    .map((step) => {
      const entries = Object.entries(step.params);
      if (entries.length === 0) return step.toolId;
      const paramStr = entries
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join(',');
      return `${step.toolId}(${paramStr})`;
    })
    .join('|');
}

/**
 * Decode a URL-safe chain string back to steps.
 * Returns null if the string is malformed beyond recovery.
 */
export function decodeChainSteps(encoded: string): ChainStepSpec[] | null {
  if (!encoded || !encoded.trim()) return null;
  try {
    const parts = encoded.split('|');
    const steps: ChainStepSpec[] = [];
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const parenIdx = trimmed.indexOf('(');
      if (parenIdx === -1) {
        steps.push({ toolId: trimmed, params: {} });
      } else {
        const toolId = trimmed.slice(0, parenIdx);
        const paramsPart = trimmed.slice(parenIdx + 1, trimmed.lastIndexOf(')'));
        const params: Record<string, unknown> = {};
        if (paramsPart) {
          for (const pair of paramsPart.split(',')) {
            const eqIdx = pair.indexOf('=');
            if (eqIdx === -1) continue;
            const k = decodeURIComponent(pair.slice(0, eqIdx));
            const rawV = decodeURIComponent(pair.slice(eqIdx + 1));
            // Coerce numbers and booleans back from string
            if (rawV === 'true') params[k] = true;
            else if (rawV === 'false') params[k] = false;
            else if (!isNaN(Number(rawV)) && rawV !== '') params[k] = Number(rawV);
            else params[k] = rawV;
          }
        }
        steps.push({ toolId, params });
      }
    }
    return steps.length > 0 ? steps : null;
  } catch {
    return null;
  }
}
