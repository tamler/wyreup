const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFile, mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { join } = require('node:path');
const { chromium } = require('playwright');
const { build } = require('esbuild');
const ExcelJS = require('@wyreup/exceljs');
const JSZip = require('jszip');
const root = join(__dirname, '..');
const uuid = /\{[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}\}/gi;

function expectedHash(password, salt, spins) {
  let key = createHash('sha512').update(Buffer.from(salt, 'base64')).update(Buffer.from(password, 'utf16le')).digest();
  for (let i = 0; i < spins; i++) {
    const iteration = Buffer.alloc(4);
    iteration.writeUInt32LE(i);
    key = createHash('sha512').update(key).update(iteration).digest();
  }
  return key.toString('base64');
}

// This same function runs against the real browser bundle and the native API.
async function roundtrip(Excel) {
  const workbook = new Excel.Workbook();
  const sheet = workbook.addWorksheet('Security');
  sheet.addRows([['Value', 'Formula'], [42, { formula: 'A2*2', result: 84 }], [18, null]]);
  sheet.getCell('A1').font = { bold: true };
  sheet.addConditionalFormatting({ ref: 'A2:A3', rules: [{ type: 'iconSet', iconSet: '3Stars',
    cfvo: [{ type: 'percent', value: 0 }, { type: 'percent', value: 33 }, { type: 'percent', value: 67 }] }] });
  sheet.addConditionalFormatting({ ref: 'A2:A3', rules: [{ type: 'dataBar', gradient: false,
    cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: 'FF00AA00' } }] });
  await sheet.protect('test-password', { spinCount: 10 });
  const protection = { ...sheet.sheetProtection };
  const bytes = await workbook.xlsx.writeBuffer();
  const loaded = new Excel.Workbook();
  await loaded.xlsx.load(bytes);
  const restored = loaded.getWorksheet('Security');
  return { bytes: Array.from(new Uint8Array(bytes)), protection,
    value: restored.getCell('A2').value, formula: restored.getCell('B2').value,
    bold: restored.getCell('A1').font.bold, formats: restored.conditionalFormattings.reduce((count, format) => count + format.rules.length, 0),
    restoredProtection: restored.sheetProtection };
}

async function validate(result) {
  assert.equal(result.value, 42);
  assert.deepEqual(result.formula, { formula: 'A2*2', result: 84 });
  assert.equal(result.bold, true);
  assert.equal(result.formats, 2);
  assert.equal(result.protection.hashValue, expectedHash('test-password', result.protection.saltValue, 10));
  assert.equal(result.restoredProtection.hashValue, result.protection.hashValue);
  const zip = await JSZip.loadAsync(Uint8Array.from(result.bytes));
  const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.ok((xml.match(uuid) ?? []).length >= 2, 'extended-format UUIDs must be written');
}

test('native XLSX roundtrip, extended formatting and worksheet protection', async () => {
  await validate(await roundtrip(ExcelJS));
});

test('upgraded archive dependencies retain streaming XLSX and CSV file roundtrips', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'excel-library-test-'));
  try {
    const file = join(directory, 'stream.xlsx');
    const writer = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: file, useStyles: true, useSharedStrings: true });
    const sheet = writer.addWorksheet('Rows');
    sheet.addRow(['Label', 'Value']).commit();
    sheet.addRow(['alpha', 42]).commit();
    sheet.addRow(['beta', 18]).commit();
    sheet.commit();
    await writer.commit();
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(file, { worksheets: 'emit', sharedStrings: 'cache', styles: 'cache' });
    const rows = [];
    for await (const worksheet of reader) {
      for await (const row of worksheet) rows.push(row.values.slice(1));
    }
    assert.deepEqual(rows, [['Label', 'Value'], ['alpha', 42], ['beta', 18]]);
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.readFile(file);
    assert.equal(loaded.getWorksheet('Rows').getCell('B2').value, 42);
    const csv = join(directory, 'rows.csv');
    await loaded.csv.writeFile(csv, { sheetName: 'Rows' });
    const csvLoaded = new ExcelJS.Workbook();
    const csvSheet = await csvLoaded.csv.readFile(csv);
    assert.equal(csvSheet.getCell('A2').value, 'alpha');
    assert.equal(csvSheet.getCell('B2').value, 42);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('both UUID generation branches and lower/upper SHA512 names remain compatible', () => {
  const Xform = require('../vendor/lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform');
  const XmlStream = require('../vendor/lib/utils/xml-stream');
  const Encryptor = require('../vendor/lib/utils/encryptor');
  const model = { type: 'iconSet', iconSet: '3Stars', cfvo: [], priority: 1 };
  const prepared = { ...model };
  const xform = new Xform();
  xform.prepare(prepared);
  assert.match(prepared.x14Id, uuid);
  const stream = new XmlStream();
  xform.renderIconSet(stream, model);
  assert.match(stream.xml, uuid);
  const salt = Buffer.alloc(16, 7).toString('base64');
  for (const algorithm of ['sha512', 'SHA512', 'SHA512'.toLowerCase()]) {
    assert.equal(Encryptor.convertPasswordToHash('test-password', algorithm, salt, 10), expectedHash('test-password', salt, 10));
  }
});

test('real browser bundle roundtrip on a secure localhost context', async () => {
  const consumer = await build({
    stdin: { contents: "export { default } from '@wyreup/exceljs'; export * from '@wyreup/exceljs';", resolveDir: root },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', metafile: true,
  });
  const inputs = Object.keys(consumer.metafile.inputs);
  assert.ok(inputs.some(input => input.endsWith('vendor/dist/exceljs.browser.mjs')));
  assert.ok(inputs.every(input => !input.includes('unzipper') && !input.includes('archiver') && !input.endsWith('vendor/excel.js')));
  const bundle = consumer.outputFiles[0].contents;
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/excel.mjs' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/excel.mjs' ? bundle : '<!doctype html><title>Excel browser test</title>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch({ headless: true,
      ...(process.env.EXCEL_TEST_BROWSER_CHANNEL ? { channel: process.env.EXCEL_TEST_BROWSER_CHANNEL } : {}) });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result = await page.evaluate(async source => {
      const exports = await import('/excel.mjs');
      const Excel = exports.default;
      for (const name of Object.keys(Excel)) {
        if (exports[name] !== Excel[name]) throw new Error('Missing browser named export: ' + name);
      }
      const run = (0, eval)(`(${source})`);
      const original = globalThis.crypto.getRandomValues;
      globalThis.crypto.getRandomValues = values => { values.fill(7); return values; };
      try { return await run(Excel); } finally { globalThis.crypto.getRandomValues = original; }
    }, roundtrip.toString());
    assert.equal(result.protection.saltValue, Buffer.alloc(16, 7).toString('base64'));
    await validate(result);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('browser provenance and complete license texts exclude the vulnerable UUID graph', async () => {
  const dependencies = JSON.parse(await readFile(join(root, 'vendor/BROWSER-DEPENDENCIES.json'), 'utf8'));
  assert.ok(dependencies.packages.some(entry => entry.name === 'jszip'));
  assert.ok(dependencies.packages.every(entry => !['uuid', 'elliptic', 'crypto-browserify'].includes(entry.name)));
  const notices = await readFile(join(root, 'vendor/THIRD-PARTY-NOTICES.txt'), 'utf8');
  assert.match(notices, /Permission is hereby granted/);
  assert.match(notices, /JSZip|jszip/);
  const manifest = require('../package.json');
  assert.equal(manifest.dependencies.uuid, undefined);
});
