/**
 * SHA-256 manifest of expected upstream bytes for each pinned path.
 * Populated by scripts/populate-manifest.ts and committed to the repo.
 *
 * On R2 miss, the worker computes SHA-256 of the upstream response and
 * compares against this manifest. Mismatch → 502, no R2 write.
 *
 * Paths NOT in the manifest are allowed to pass through unverified —
 * the manifest starts empty and is filled over time. Operators can
 * enforce strict mode by setting STRICT_VERIFICATION = true to refuse
 * any unverified path. Recommended for production once the manifest is
 * complete.
 *
 * NOTE: The client receives the upstream bytes regardless of hash match.
 * Only the R2 cache write is gated. This defends against long-term cache
 * poisoning (every subsequent R2-hit request would be safe), but does not
 * block the first-fetch client from receiving compromised bytes. A fully
 * strict implementation would buffer + verify before returning, at the
 * cost of TTFB and worker memory. The streaming/caching trade-off is
 * deliberate: the threat model is persistent cache poisoning, not
 * first-byte interception.
 */

export interface ManifestEntry {
  /** Lowercase hex SHA-256 of the upstream bytes. */
  sha256: string;
  /** Optional human-readable size in bytes — informational only. */
  bytes?: number;
}

/**
 * When true, any path NOT in the manifest is refused with 502.
 * Keep false until the manifest is fully populated.
 */
export const STRICT_VERIFICATION = false;

/**
 * SHA-256 hash table for pinned upstream paths.
 *
 * Keys are the same `key` value routeRequest() receives — the URL path
 * with the leading slash stripped (e.g.
 * "Xenova/whisper-tiny/resolve/main/config.json").
 *
 * Populate via:
 *   pnpm --filter @wyreup/worker-models populate-manifest
 * Then paste the printed entries here and commit.
 *
 * Hashing uses crypto.DigestStream (Cloudflare's streaming SHA API) so
 * there is no memory cap — model weights of any size, including the
 * Xenova/m2m100_418M decoder at ~1 GB, can be integrity-verified.
 */
export const MANIFEST: Readonly<Record<string, ManifestEntry>> = Object.freeze({
  // Populate via:
  //   pnpm --filter @wyreup/worker-models populate-manifest
  // Then copy the printed entries here and commit.
});
