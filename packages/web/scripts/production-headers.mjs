// Prospective test helper: supports the current site's local path rules only.
// Unsupported Pages syntax fails explicitly rather than changing test semantics.
/** @typedef {{path: string, fields: [string, string][]}} HeaderRule */

/** @param {string} text @returns {HeaderRule[]} */
export function parseProductionHeaders(text) {
  /** @type {HeaderRule[]} */
  const rules = [];
  /** @type {HeaderRule | undefined} */
  let current;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (raw.length > 2000) throw new Error('Unsupported overlong Pages header line.');
    if (!/^\s/.test(raw)) {
      if (!/^\/(?:[A-Za-z0-9_./-]*\*?)$/.test(line) || line.includes('..')) {
        throw new Error('Unsupported Pages header path syntax.');
      }
      current = { path: line, fields: [] };
      rules.push(current);
      if (rules.length > 100) throw new Error('Too many Pages header rules.');
      continue;
    }
    const field = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*(.*)$/.exec(line);
    if (!current || !field || Array.from(field[2]).some(char => char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127) || /:[A-Za-z]\w*/.test(field[2])) {
      throw new Error('Unsupported Pages header declaration.');
    }
    current.fields.push([field[1].toLowerCase(), field[2]]);
  }
  return rules;
}

/** @param {HeaderRule[]} rules @param {string} pathname @returns {Record<string,string>} */
export function productionHeadersFor(rules, pathname) {
  /** @type {Record<string,string>} */
  const headers = Object.create(null);
  for (const rule of rules) {
    const matches = rule.path.endsWith('*')
      ? pathname.startsWith(rule.path.slice(0, -1))
      : pathname === rule.path;
    if (!matches) continue;
    for (const [name, value] of rule.fields) {
      headers[name] = Object.hasOwn(headers, name) ? `${headers[name]}, ${value}` : value;
    }
  }
  return headers;
}

/** @param {HeaderRule[]} rules @param {string} pathname @param {string} contentType @param {string} etag @returns {Record<string,string>} */
export function productionResponseHeaders(rules, pathname, contentType, etag) {
  // Platform-derived representation fields are defaults, not another Pages rule.
  // Actual _headers values replace these defaults; repeated matching rules alone join.
  return { 'content-type': contentType, etag, ...productionHeadersFor(rules, pathname) };
}

/** @param {string} text @returns {{from:string,to:string,status:number}[]} */
export function parseProductionRedirects(text) {
  const redirects = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(\/[A-Za-z0-9_./-]*)[ \t]+(\/[A-Za-z0-9_./-]*)(?:[ \t]+(301|302|303|307|308))?$/.exec(line);
    if (!match || line.length > 1000 || match[1].includes('..') || match[2].includes('..')) {
      throw new Error('Unsupported Pages redirect syntax.');
    }
    redirects.push({ from: match[1], to: match[2], status: Number(match[3] ?? '302') });
    if (redirects.length > 2000) throw new Error('Too many static Pages redirects.');
  }
  return redirects;
}
