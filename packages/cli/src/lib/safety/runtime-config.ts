export const DEFAULT_MODEL_CDN = 'https://models.wyreup.com';

// Trusted upstreams used only when the operator explicitly disables the
// first-party mirror. Hugging Face currently redirects large files to its
// regional hf.co delivery hosts, so those exact origins must remain allowed
// or the fallback fails after the first response.
const UPSTREAM_MODEL_ORIGINS = [
  'https://huggingface.co',
  'https://cdn-lfs.huggingface.co',
  'https://cdn-lfs.hf.co',
  'https://cdn-lfs-us-1.hf.co',
  'https://cdn-lfs-eu-1.hf.co',
  'https://cas-bridge.xethub.hf.co',
  'https://us.aws.cdn.hf.co',
  'https://eu.aws.cdn.hf.co',
  'https://cdn.jsdelivr.net',
  'https://storage.googleapis.com',
] as const;

export type ModelCdnConfig = {
  base: string | null;
  allowedOrigins: string[];
};

export function resolveModelCdn(raw = process.env['WYREUP_MODEL_CDN']): ModelCdnConfig {
  if (raw === 'disabled') {
    return { base: null, allowedOrigins: [...UPSTREAM_MODEL_ORIGINS] };
  }

  const base = raw && raw.length > 0 ? raw : DEFAULT_MODEL_CDN;
  const url = new URL(base);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('WYREUP_MODEL_CDN must use http or https');
  }
  return {
    base: base.replace(/\/+$/, ''),
    allowedOrigins: [url.origin],
  };
}
