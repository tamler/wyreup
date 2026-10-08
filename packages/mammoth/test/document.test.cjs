const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, writeFile, mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { join } = require('node:path');
const { chromium } = require('playwright');
const { build } = require('esbuild');
const JSZip = require('jszip');
const mammoth = require('@wyreup/mammoth');
const root = join(__dirname, '..');
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN6cAAAAASUVORK5CYII=';

async function documentBytes() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image.png"/></Relationships>');
  zip.file('word/styles.xml', '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Library heading</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Hello </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>world</w:t></w:r></w:p><w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Pixel" descr="Fixture image"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId2"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p><w:sectPr/></w:body></w:document>');
  zip.file('word/media/image.png', png, { base64: true });
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function exercise(api, input) {
  const html = await api.convertToHtml(input);
  const raw = await api.extractRawText(input);
  const custom = await api.convertToHtml(input, { styleMap: "p[style-name='heading 1'] => h2:fresh" });
  const embedded = await api.embedStyleMap(input, "p[style-name='heading 1'] => h3:fresh");
  const embeddedInput = input.buffer ? { buffer: embedded.toBuffer() } : { arrayBuffer: embedded.toArrayBuffer() };
  const embeddedHtml = await api.convertToHtml(embeddedInput);
  const styleMap = await api.readEmbeddedStyleMap(embeddedInput);
  return { html: html.value, raw: raw.value, custom: custom.value, embedded: embeddedHtml.value, styleMap, messages: html.messages };
}

function validate(result) {
  assert.match(result.html, /<h1>Library heading<\/h1>/);
  assert.match(result.html, /<p>Hello <strong>world<\/strong><\/p>/);
  assert.match(result.html, /src="data:image\/png;base64,/);
  assert.match(result.html, /alt="Fixture image"/);
  assert.match(result.raw, /Library heading\n\nHello world/);
  assert.match(result.custom, /<h2>Library heading<\/h2>/);
  assert.match(result.embedded, /<h3>Library heading<\/h3>/);
  assert.match(result.styleMap, /heading 1/);
  assert.deepEqual(result.messages, []);
}

test('Node buffer and path conversion retain headings, formatting, images and style maps', async () => {
  const bytes = await documentBytes();
  validate(await exercise(mammoth, { buffer: bytes }));
  const directory = await mkdtemp(join(tmpdir(), 'mammoth-library-test-'));
  try {
    const file = join(directory, 'input.docx');
    await writeFile(file, bytes);
    const html = await mammoth.convertToHtml({ path: file });
    assert.match(html.value, /<h1>Library heading<\/h1>/);
    assert.match(html.value, /data:image\/png;base64,/);
  } finally { await rm(directory, { recursive: true, force: true }); }
  await assert.rejects(mammoth.convertToHtml({ buffer: Buffer.from('not a DOCX archive') }));
});

test('real browser library retains DOCX conversions and embedded style maps', async () => {
  const consumer = await build({
    stdin: { contents: "export { default } from '@wyreup/mammoth'; export * from '@wyreup/mammoth';", resolveDir: root },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', metafile: true,
  });
  const inputs = Object.keys(consumer.metafile.inputs);
  assert.ok(inputs.some(input => input.endsWith('vendor/dist/mammoth.browser.mjs')));
  assert.ok(inputs.every(input => !input.endsWith('vendor/lib/index.js') && !input.includes('node:fs')));
  const bundle = consumer.outputFiles[0].contents;
  const bytes = Array.from(await documentBytes());
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/mammoth.mjs' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/mammoth.mjs' ? bundle : '<!doctype html><title>DOCX browser test</title>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch({ headless: true,
      ...(process.env.LIBRARY_TEST_BROWSER_CHANNEL ? { channel: process.env.LIBRARY_TEST_BROWSER_CHANNEL } : {}) });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result = await page.evaluate(async ({ bytes, source }) => {
      const exports = await import('/mammoth.mjs');
      const api = exports.default;
      for (const name of Object.keys(api)) {
        if (exports[name] !== api[name]) throw new Error('Missing browser named export: ' + name);
      }
      const run = (0, eval)(`(${source})`);
      return run(api, { arrayBuffer: Uint8Array.from(bytes).buffer });
    }, { bytes, source: exercise.toString() });
    validate(result);
    const rejection = await page.evaluate(async () => {
      const api = (await import('/mammoth.mjs')).default;
      try { await api.convertToHtml({ path: '/unavailable.docx' }); return false; }
      catch (error) { return error.message.includes('Could not find file'); }
    });
    assert.equal(rejection, true);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('library provenance retains licenses and excludes standalone CLI dependencies', async () => {
  const graph = JSON.parse(await readFile(join(root, 'vendor/BROWSER-DEPENDENCIES.json'), 'utf8'));
  assert.ok(graph.packages.some(entry => entry.name === '@xmldom/xmldom' && entry.version.startsWith('0.9.')));
  assert.ok(graph.packages.every(entry => !['argparse', 'sprintf-js'].includes(entry.name)));
  assert.ok(graph.inputs.length > 0);
  const notices = await readFile(join(root, 'vendor/THIRD-PARTY-NOTICES.txt'), 'utf8');
  assert.match(notices, /Redistribution and use in source and binary forms/);
  assert.match(notices, /@xmldom\/xmldom/);
  assert.equal(require('../package.json').dependencies.argparse, undefined);
});
