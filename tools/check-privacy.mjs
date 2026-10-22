// Privacy scan: grep built output for external domain references.
// Belt-and-suspenders alongside runtime CSP (which is the primary enforcement).
// Catches honest mistakes like "I forgot this was a CDN link" before they ship.

import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { parse } from 'parse5';
import onnxAssets from '../packages/core/src/lib/onnx-assets.json' with { type: 'json' };
import pdfjsAssets from '../packages/core/src/lib/pdfjs-assets.json' with { type: 'json' };
import financeSources from '../packages/core/src/utilities/finance-sources.json' with { type: 'json' };

function escapeAstroHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

function uniqueIndex(source, value) {
  const index = source.indexOf(value);
  return index >= 0 && source.lastIndexOf(value) === index ? index : -1;
}

function descendants(node) {
  const result = [];
  const pending = [node];
  while (pending.length) {
    const current = pending.pop();
    result.push(current);
    pending.push(...(current.childNodes ?? []));
  }
  return result;
}

function attribute(node, name) {
  return node.attrs?.find((item) => item.name === name)?.value;
}

function passiveAncestry(node) {
  const active = new Set(['a', 'script', 'style', 'template', 'noscript', 'iframe',
    'object', 'embed', 'textarea', 'title', 'xmp', 'noembed', 'plaintext', 'select']);
  for (let current = node; current; current = current.parentNode) {
    if (active.has(current.tagName) ||
        (current.namespaceURI && current.namespaceURI !== 'http://www.w3.org/1999/xhtml') ||
        current.attrs?.some((item) => item.name === 'style' || item.name.startsWith('on'))) {
      return false;
    }
  }
  return true;
}

function typedObject(value) {
  return Array.isArray(value) && value.length === 2 && value[0] === 0 &&
    value[1] !== null && typeof value[1] === 'object' && !Array.isArray(value[1]);
}

function typedString(value) {
  return Array.isArray(value) && value.length === 2 && value[0] === 0 &&
    typeof value[1] === 'string';
}

// Return protocol-start indexes only. Every other URL still enters the original scan.
function financeCitationIndexes(content, path) {
  const indexes = new Set();
  const id = /^tools\/([a-z0-9-]+)\/index\.html$/.exec(path)?.[1];
  if (!id || !Object.hasOwn(financeSources.sources, id)) return indexes;
  try {
    const errors = [];
    const document = parse(content, { sourceCodeLocationInfo: true,
      onParseError: (error) => errors.push(error.code) });
    if (errors.length) return indexes;
    const nodes = descendants(document);
    const islands = nodes.filter((node) => node.tagName === 'astro-island' &&
      /^\/_astro\/ToolRunner\.[\w-]+\.js$/.test(attribute(node, 'component-url') ?? '') &&
      attribute(node, 'component-export') === 'default');
    const prose = nodes.filter((node) => attribute(node, 'class')?.split(/\s+/).includes('tool-prose'));
    if (islands.length !== 1 || prose.length !== 1 || !passiveAncestry(islands[0])) return indexes;
    const island = islands[0];
    const props = attribute(island, 'props');
    const location = island.sourceCodeLocation?.attrs?.props;
    if (typeof props !== 'string' || !location || !island.sourceCodeLocation.endTag ||
        content.slice(location.startOffset, location.endOffset) !== `props="${escapeAstroHtml(props)}"`) return indexes;
    const parsed = JSON.parse(props);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        JSON.stringify(parsed) !== props || !Object.hasOwn(parsed, 'tool') ||
        !typedObject(parsed.tool)) return indexes;
    const tool = parsed.tool[1];
    if (!Object.hasOwn(tool, 'id') || !typedString(tool.id) || tool.id[1] !== id ||
        !Object.hasOwn(tool, 'seoContent') || !typedObject(tool.seoContent)) return indexes;
    const seo = tool.seoContent[1];
    if (!Object.hasOwn(seo, 'intro') || !typedString(seo.intro)) return indexes;
    const intro = seo.intro[1];
    const urls = financeSources.sources[id];
    const suffix = `Official definitions checked ${financeSources.checkedOn}: ${urls.join(' ')}`;
    const suffixStart = intro.length - suffix.length;
    if (suffixStart < 0 || !intro.endsWith(suffix) || uniqueIndex(intro, suffix) !== suffixStart) return indexes;

    // Canonical typed path and unique tuple slices prevent a different JSON field qualifying.
    for (const [parent, key] of [[parsed, 'tool'], [tool, 'seoContent'], [seo, 'intro']]) {
      const tuple = JSON.stringify(parent[key]);
      const pair = `${JSON.stringify(key)}:${tuple}`;
      if (uniqueIndex(JSON.stringify(parent), pair) < 0 || uniqueIndex(props, tuple) < 0) return indexes;
    }
    const introTupleStart = uniqueIndex(props, JSON.stringify(seo.intro));
    const paragraphs = descendants(prose[0]).filter((node) => node.tagName === 'p' &&
      node.childNodes?.length === 1 && node.childNodes[0].nodeName === '#text' &&
      node.childNodes[0].value === intro);
    if (paragraphs.length !== 1 || !passiveAncestry(paragraphs[0])) return indexes;
    const paragraph = paragraphs[0];
    const text = paragraph.childNodes[0].sourceCodeLocation;
    if (!text || !paragraph.sourceCodeLocation?.startTag || !paragraph.sourceCodeLocation.endTag ||
        text.startOffset < paragraph.sourceCodeLocation.startTag.endOffset ||
        text.endOffset > paragraph.sourceCodeLocation.endTag.startOffset ||
        content.slice(text.startOffset, text.endOffset) !== escapeAstroHtml(intro)) return indexes;
    const candidate = [];
    let suffixOffset = suffixStart + `Official definitions checked ${financeSources.checkedOn}: `.length;
    for (const url of urls) {
      const visible = text.startOffset + escapeAstroHtml(intro.slice(0, suffixOffset)).length;
      const jsonPrefix = props.slice(0, introTupleStart + 3) + JSON.stringify(intro.slice(0, suffixOffset)).slice(0, -1);
      const serialized = location.startOffset + 'props="'.length + escapeAstroHtml(jsonPrefix).length;
      const rawVisible = escapeAstroHtml(url);
      const rawSerialized = escapeAstroHtml(JSON.stringify(url).slice(1, -1));
      if (content.slice(visible, visible + rawVisible.length) !== rawVisible ||
          content.slice(serialized, serialized + rawSerialized.length) !== rawSerialized ||
          serialized < location.startOffset || serialized + rawSerialized.length >= location.endOffset) return indexes;
      candidate.push(visible, serialized);
      suffixOffset += url.length + 1;
    }
    for (const index of candidate) indexes.add(index);
  } catch {
    // Ambiguous or malformed candidates keep all original violations.
  }
  return indexes;
}

/**
 * @param {object} options
 * @param {string} options.distDir
 * @param {string[]} options.allowlist
 * @param {boolean} [options.verifyOnnxNotices] - verify the two pinned built
 *   upstream notices before excluding their passive citations from scanning.
 * @param {boolean} [options.verifyPdfJsNotices] - verify all three pinned
 *   versioned PDF.js notices before excluding their passive citations.
 * @param {RegExp[]} [options.pathExemptions] - file paths matching any of
 *   these regexes are skipped from the scan. Used for pages that
 *   legitimately reference third-party vendors in user-facing copy (e.g.
 *   the privacy / refund policies disclose data processors by name).
 * @returns {Promise<{ ok: boolean, violations: Array<{ file: string, domain: string }> }>}
 */
export async function checkPrivacy({
  distDir,
  allowlist,
  pathExemptions = [],
  verifyOnnxNotices = false,
  verifyPdfJsNotices = false,
}) {
  const violations = [];
  const verifiedNotices = new Set();
  if (verifyPdfJsNotices) {
    const required = ['LICENSE.txt', 'NOTICE.txt', 'PATCH-NOTICE.txt'];
    if (pdfjsAssets.version !== '6.4.299' || pdfjsAssets.notices.length !== required.length) {
      throw new Error('Pinned PDF.js notice manifest does not match the reviewed version and set.');
    }
    const paths = [];
    for (const file of required) {
      const notices = pdfjsAssets.notices.filter((notice) => notice.file === file);
      if (notices.length !== 1)
        throw new Error(`Missing or duplicate pinned PDF.js notice: ${file}`);
      const notice = notices[0];
      const path = `licenses/pdfjs-dist@${pdfjsAssets.version}/${file}`;
      const bytes = await readFile(join(distDir, path));
      if (
        bytes.length !== notice.bytes ||
        createHash('sha256').update(bytes).digest('hex') !== notice.sha256
      ) {
        throw new Error(`Built PDF.js notice does not match its pin: ${path}`);
      }
      paths.push(path);
    }
    for (const path of paths) verifiedNotices.add(path);
  }
  if (verifyOnnxNotices) {
    for (const version of ['1.24.3', '1.31.0-dev.20260914-8d85527a0']) {
      const notice = onnxAssets.runtimes
        .find((runtime) => runtime.version === version)
        ?.licenses.find((license) => license.file === 'ThirdPartyNotices.txt');
      if (!notice) throw new Error(`Missing pinned ONNX notice: ${version}`);
      const path = `licenses/onnxruntime-web@${version}/ThirdPartyNotices.txt`;
      const bytes = await readFile(join(distDir, path));
      if (
        bytes.length !== notice.bytes ||
        createHash('sha256').update(bytes).digest('hex') !== notice.sha256
      ) {
        throw new Error(`Built ONNX notice does not match its pin: ${path}`);
      }
      verifiedNotices.add(path);
    }
  }
  const files = await walkDir(distDir);

  // Match http://... or https://... URLs (but not relative paths).
  const urlRegex = /https?:\/\/([a-zA-Z0-9.-]+)/g;

  for (const file of files) {
    if (!isScannable(file)) continue;
    if (verifiedNotices.has(relative(distDir, file).split('\\').join('/'))) continue;
    if (pathExemptions.some((re) => re.test(file))) continue;
    const content = await readFile(file, 'utf8');
    const passiveCitations = financeCitationIndexes(content, relative(distDir, file).split('\\').join('/'));

    for (const match of content.matchAll(urlRegex)) {
      if (passiveCitations.has(match.index)) continue;
      const domain = match[1];
      if (isAllowed(domain, allowlist)) continue;
      violations.push({ file, domain });
    }
  }

  // Deduplicate by file+domain pair
  const dedup = new Map();
  for (const v of violations) {
    dedup.set(`${v.file}::${v.domain}`, v);
  }

  return {
    ok: dedup.size === 0,
    violations: Array.from(dedup.values()),
  };
}

function isAllowed(domain, allowlist) {
  return allowlist.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}

function isScannable(file) {
  // We scan HTML, CSS, JSON, and text — the surfaces WE author.
  // We deliberately skip bundled JS (in _astro/, dist/browser/, dist/node/),
  // because regex-matching URL-shaped strings in minified third-party library
  // code produces overwhelming false positives (namespace URIs like w3.org,
  // author attributions like feross.org, "localhost" dev placeholders, spec
  // links in license headers, etc.). Real runtime exfiltration is caught by
  // the browser CSP, which is the primary enforcement layer — this scan is
  // belt-and-suspenders for "I forgot this was a CDN link" in static assets.
  return /\.(html|css|json|webmanifest|txt)$/i.test(file);
}

async function walkDir(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await walkDir(full)));
      } else {
        files.push(full);
      }
    }
    return files;
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const distDirs = ['packages/web/dist', 'packages/core/dist'];
  const allowlist = [
    // First-party.
    'wyreup.com',
    'static.cloudflareinsights.com',

    // SEO / metadata references (not runtime fetches):
    'schema.org', // JSON-LD @context URI in per-tool page structured data
    'github.com', // source-code link in footer + privacy block (user-initiated navigation)
    'modelcontextprotocol.io', // doc link on /mcp page to the MCP spec (user-initiated navigation)

    // Documentation example domains used in tool descriptions and placeholders
    // (e.g. signed-url shows "https://api.example.com/files/<token>" as a sample).
    // RFC 2606 reserves example.com / example.org / example.net for this purpose.
    // wyreup.app is the placeholder short-URL host shown in url-shorten-local's UI.
    // None of these are fetched at runtime; they're static text in tool descriptions.
    'example.com',
    'example.org',
    'example.net',
    'wyreup.app',

    // All AI-model fetches now route through `models.wyreup.com` (R2-backed
    // Cloudflare Worker — see `packages/worker-models/`). The browser never
    // touches jsdelivr / googleapis / huggingface; the Worker fetches from
    // those upstreams once per file ever, server-side, on cache-miss.
    // The three former third-party origins are NOT in this allow-list — if
    // anything sneaks back in (a forgotten hard-coded URL, a vendored
    // library with an embedded link), the scan should catch it.
  ];

  // Pages that legitimately reference third-party vendors in user-facing
  // copy. Privacy/refund/terms policies disclose data processors by name
  // (Cloudflare, LemonSqueezy, Zoho) — those references are required for
  // legal transparency, not runtime fetches. Static text in these pages
  // is exempt; CSP still gates actual network behavior at runtime.
  const pathExemptions = [
    /\/legal\/privacy\/index\.html$/,
    /\/legal\/refund\/index\.html$/,
    /\/legal\/terms\/index\.html$/,
  ];

  let totalViolations = 0;
  for (const dir of distDirs) {
    const result = await checkPrivacy({
      distDir: dir,
      allowlist,
      pathExemptions,
      verifyOnnxNotices: dir === 'packages/web/dist',
      verifyPdfJsNotices: dir === 'packages/web/dist',
    });
    if (!result.ok) {
      console.error(`Privacy scan FAILED in ${dir}:`);
      for (const v of result.violations) {
        console.error(`  ${v.file}: references "${v.domain}"`);
      }
      totalViolations += result.violations.length;
    }
  }

  if (totalViolations > 0) {
    process.exit(1);
  }
  console.log('Privacy scan passed');
}
