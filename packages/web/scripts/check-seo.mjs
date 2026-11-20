import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createDefaultRegistry } from '../../core/dist/node/index.js';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const read = (path) => readFileSync(join(dist, path), 'utf8');
const htmlAt = (path) => read(path === '/' ? 'index.html' : `${path.slice(1)}index.html`);
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const metas = (html) =>
  [...html.matchAll(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/g)].map((match) => match[0]);
const meta = (html, key) =>
  metas(html).find((tag) => attr(tag, 'name') === key || attr(tag, 'property') === key);
const content = (html, key) => attr(meta(html, key) ?? '', 'content');
const canonical = (html) =>
  attr(
    [...html.matchAll(/<link\b[^>]*>/g)]
      .map((m) => m[0])
      .find((tag) => attr(tag, 'rel') === 'canonical') ?? '',
    'href',
  );
const title = (html) => html.match(/<title>([^<]+)<\/title>/)?.[1] ?? '';
const h1 = (html) => html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1].replace(/<[^>]+>/g, '') ?? '';
const failures = [];
function check(label, run) {
  try {
    run();
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
  }
}

const urls = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const core = createDefaultRegistry();
const retired = core.tools.filter((tool) => tool.cost === 'credit').map((tool) => tool.id);
const commercialPaths = ['/pro', '/account', '/admin', '/pricing', '/legal/pricing', '/legal/refund'];
const retiredJobs = ['/translate-a-document', '/make-subtitles-for-a-video'];
const retiredIds = new RegExp(`(?:^|[^a-z0-9-])(?:${retired.join('|')})(?=$|[^a-z0-9-])`);
const salesCopy = /hosted PRO|credit-metered|credits? per run|buy credits|credit pricing|\bGet PRO\b|lemonsqueezy|wyreup:auth-open|\/(?:api\/(?:account|auth|credits|tools\/pro)|pro(?:[/#"]|&quot;)|account(?:[/#"]|&quot;))/i;
check('published free tool catalog', () => {
  const entries = JSON.parse(read('tools-index.json'));
  const expected = core.tools
    .filter((tool) => tool.cost === 'free' && (tool.surfaces === undefined || tool.surfaces.includes('web')))
    .map((tool) => tool.id).sort();
  assert.deepEqual(entries.map((tool) => tool.id).sort(), expected);
  assert.match(entries.find((tool) => tool.id === 'domain-age-checker')?.description ?? '', /Wyreup.*domain registry/i);
});
for (const path of [...commercialPaths, ...retiredJobs, ...retired.map((id) => `/tools/${id}`)]) {
  check(`${path} is retired`, () => {
    assert.ok(!urls.includes(`https://wyreup.com${path}/`));
    assert.ok(!existsSync(join(dist, path.slice(1), 'index.html')));
    assert.ok(!existsSync(join(dist, `${path.slice(1)}.html`)));
  });
}
for (const file of readdirSync(dist, { recursive: true }).filter((path) => path.endsWith('.html'))) {
  check(`${file} excludes commercial content`, () => {
    const html = read(file);
    assert.ok(!retiredIds.test(html), `retired tool ID: ${html.match(retiredIds)?.[0]}`);
    assert.ok(!salesCopy.test(html), `commercial content: ${html.match(salesCopy)?.[0]}`);
  });
}
check('sitemap uniqueness', () => assert.equal(new Set(urls).size, urls.length));
for (const value of urls) {
  check(value, () => {
    const url = new URL(value);
    assert.equal(url.origin, 'https://wyreup.com');
    assert.equal(url.search + url.hash, '');
    assert.ok(url.pathname.endsWith('/'), 'sitemap URL must have trailing slash');
    const html = htmlAt(url.pathname);
    assert.equal(canonical(html), value);
    assert.equal(content(html, 'og:url'), value);
    assert.equal(content(html, 'twitter:url'), value);
    assert.ok(!/noindex/i.test(content(html, 'robots') ?? ''), 'sitemap page is noindex');
    assert.ok(
      title(html) && h1(html) && content(html, 'description'),
      'missing metadata or heading',
    );
    for (const script of html.matchAll(
      /<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
    )) {
      const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        for (const [key, child] of Object.entries(node)) {
          if (
            (key === 'url' || key === 'item') &&
            typeof child === 'string' &&
            child.startsWith('https://wyreup.com')
          ) {
            const schemaUrl = new URL(child);
            assert.ok(
              schemaUrl.pathname.endsWith('/'),
              `noncanonical structured-data URL ${child}`,
            );
            assert.equal(schemaUrl.search + schemaUrl.hash, '');
            assert.ok(
              urls.includes(child),
              `structured-data page is absent from sitemap: ${child}`,
            );
          } else walk(child);
        }
      };
      const schema = JSON.parse(script[1]);
      if (url.pathname.startsWith('/tools/') && url.pathname !== '/tools/' && schema['@type'] === 'SoftwareApplication') {
        assert.equal(schema.offers?.price, '0', 'free tool advertises a zero-price Offer');
      }
      walk(schema);
    }
  });
}

for (const path of [
  '/settings/',
  '/share/',
  '/share-receive/',
  '/toolbelt/',
  '/chain/build/',
  '/chain/run/',
]) {
  check(`${path} index policy`, () => {
    assert.ok(!urls.includes(`https://wyreup.com${path}`));
    assert.match(content(htmlAt(path), 'robots') ?? '', /noindex/);
  });
}
check('404 index policy', () => assert.match(content(read('404.html'), 'robots') ?? '', /noindex/));

check('image similarity review guidance', () => {
  const html = htmlAt('/tools/image-similarity/');
  assert.match(title(html), /image similarity checker/i);
  assert.match(content(html, 'description') ?? '', /inspect originals before deleting/i);
  assert.match(html, /not proof that two photos are duplicates/i);
});

const priority = new Map([
  ['/tools/compress/', /compress images/i],
  ['/tools/convert/', /convert images/i],
  ['/tools/strip-exif/', /remove photo metadata/i],
  ['/tools/face-blur/', /blur faces/i],
  ['/tools/heic-to-jpg/', /heic to jpg/i],
]);
for (const [path, phrase] of priority) {
  check(`${path} task metadata`, () => {
    const html = htmlAt(path);
    assert.match(title(html), phrase);
    assert.match(h1(html), phrase);
    assert.match(html, /How to|How it works|Steps/i);
    assert.match(html, /Limitations|Keep in mind|Before you share|What to expect/i);
    assert.doesNotMatch(html, /Detect every face/);
  });
}
for (const path of [
  '/remove-photo-location-data/',
  '/convert-heic-to-jpg/',
  '/compress-photo-for-email/',
]) {
  check(`${path} task instructions`, () => {
    const html = htmlAt(path);
    assert.match(html, /How to|How it works|Steps/i);
    assert.match(html, /Limitations|Keep in mind|Before you share|What to expect/i);
  });
}

for (const path of ['/mcp/', '/cli/', '/skill/']) {
  check(`${path} execution claims`, () => {
    const html = htmlAt(path);
    assert.doesNotMatch(
      html,
      /Files never leave your machine|No server call, ever|no uploads, no cloud calls|npm publish is imminent/i,
    );
    assert.doesNotMatch(html, /hosted PRO|credits? per run/i);
    assert.match(html, /download|setup/i);
  });
}
for (const value of urls.filter((url) => url.includes('/category/'))) {
  check(`${value} category metadata`, () => {
    const html = htmlAt(new URL(value).pathname);
    assert.match(title(html), /tools/i);
    assert.match(h1(html), /tools/i);
    assert.doesNotMatch(html, /lossless for documents|with no network calls/i);
  });
}
for (const path of [
  ...priority.keys(),
  '/remove-photo-location-data/',
  '/convert-heic-to-jpg/',
  '/compress-photo-for-email/',
]) {
  check(`${path} internal links`, () => {
    const html = htmlAt(path);
    for (const match of html.matchAll(/<a\b[^>]*href="(\/[^"#]*)"/g)) {
      const link = new URL(match[1], 'https://wyreup.com');
      if (link.origin !== 'https://wyreup.com') continue;
      const route = link.pathname.endsWith('/') ? link.pathname : `${link.pathname}/`;
      const file = route === '/' ? 'index.html' : `${route.slice(1)}index.html`;
      assert.ok(
        existsSync(join(dist, file)) || existsSync(join(dist, link.pathname.slice(1))),
        `broken internal link ${match[1]}`,
      );
    }
  });
}
const redirects = readFileSync(new URL('../public/_redirects', import.meta.url), 'utf8');
for (const path of commercialPaths) {
  for (const from of [path, `${path}/`]) {
    const to = path === '/legal/refund' ? '/legal/terms' : '/tools';
    check(`legacy redirect ${from}`, () =>
      assert.ok(redirects.split('\n').includes(`${from} ${to} 301`)),
    );
  }
}
check('legacy privacy redirect', () =>
  assert.match(redirects, /^\/privacy\.html\s+\/legal\/privacy\/\s+301\s*$/m),
);
check('no blanket redirect', () => assert.doesNotMatch(redirects, /^\/\*\s+/m));

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `SEO checks passed: ${urls.length} canonical sitemap pages, metadata, structured data, index policy, priority content, internal links and legacy redirects.`,
  );
}
