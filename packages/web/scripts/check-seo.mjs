import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

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
      if (
        schema['@type'] === 'SoftwareApplication' &&
        (content(html, 'og:description') ?? '').includes('Hosted PRO tool — pay per run')
      ) {
        assert.equal(schema.offers, undefined, 'hosted tool must not advertise a free Offer');
      }
      walk(schema);
    }
  });
}

for (const path of [
  '/account/',
  '/admin/',
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

check('image similarity experimental disclosure', () => {
  const html = htmlAt('/tools/image-similarity/');
  assert.match(title(html), /experimental/i);
  assert.match(content(html, 'description') ?? '', /not validated/i);
  assert.match(html, /do not use.*(?:duplicates|delete|deletion)/i);
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
    assert.match(html, /hosted/i);
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
check('legacy pricing redirect', () =>
  assert.match(redirects, /^\/legal\/pricing\/\s+\/pro\/\s+301\s*$/m),
);
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
