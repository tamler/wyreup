const DNS = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** @param {string} hostname */
const validHostname = hostname => hostname.length <= 253 && DNS.test(hostname) && !/^(?:\d+\.){3}\d+$/.test(hostname);

/** @param {string | undefined} raw @returns {readonly string[]} */
export function configuredOutputOrigins(raw) {
  if (raw === undefined || raw === '') return Object.freeze([]);
  if (typeof raw !== 'string' || raw.length > 1024) throw new Error('Invalid output origins.');
  const origins = raw.split(',');
  if (origins.length > 4 || new Set(origins).size !== origins.length
    || origins.some(origin => {
      try { return !origin.startsWith('https://') || new URL(origin).origin !== origin || !validHostname(origin.slice(8)); }
      catch { return true; }
    })) throw new Error('Invalid output origins.');
  return Object.freeze(origins);
}

/**
 * @param {unknown} value
 * @param {readonly string[]} origins
 * @returns {Readonly<{ origin: string, url?: string }>}
 */
export function inspectDownloadUrl(value, origins) {
  if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u0020\u007f\s\\]/u.test(value)
    || !value.startsWith('https://') || value.includes('#')) throw new Error('Invalid download destination.');
  const authority = /^https:\/\/([^/?#]+)/.exec(value)?.[1];
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('Invalid download destination.'); }
  if (!authority || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.hash
    || !validHostname(parsed.hostname)
    || 'https://' + authority.toLowerCase() !== parsed.origin) throw new Error('Invalid download destination.');
  return origins.includes(parsed.origin)
    ? Object.freeze({ origin: parsed.origin, url: value }) : Object.freeze({ origin: parsed.origin });
}
