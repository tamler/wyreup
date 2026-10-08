import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const target = process.argv[2];
assert(process.argv[3] === undefined || process.argv[3] === 'with-ai', 'Unknown AI smoke mode');
const expectsAI = ['@wyreup/cli', '@wyreup/mcp'].includes(target) ||
  (target === '@wyreup/core' && process.argv[3] === 'with-ai');
const targetRequire = createRequire(require.resolve(target));
const load = async (resolver, name) => import(pathToFileURL(resolver.resolve(name)).href);
const context = (executionId) => ({
  signal: new AbortController().signal, cache: new Map(), executionId, onProgress() {},
});
const outputBlob = (result) => {
  const output = Array.isArray(result) ? result[0] : result;
  assert(output instanceof Blob, 'Core tool did not return a Blob');
  return output;
};
if (target === '@wyreup/cli') {
  const help = execFileSync(process.execPath, [require.resolve(target), '--help'], { encoding: 'utf8', timeout: 30_000 });
  assert(help.includes('Usage: wyreup'), 'Published CLI entrypoint did not print its command help');
}
if (target === '@wyreup/mcp') {
  const { Client } = await load(targetRequire, '@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await load(targetRequire, '@modelcontextprotocol/sdk/client/stdio.js');
  const client = new Client({ name: 'packed-consumer-check', version: '1.0.0' }, { capabilities: {} });
  const transport = new StdioClientTransport({ command: process.execPath, args: [require.resolve(target)] });
  try {
    await client.connect(transport);
    const result = await client.listTools();
    assert(result.tools.length > 200, 'Published MCP entrypoint did not expose its tools');
  } finally {
    await client.close();
  }
}
let excelRequire;
let excelEntry;
let core;
let coreRequire;
let mammothEntry;
let mammothRequire;

if (['@wyreup/core', '@wyreup/cli', '@wyreup/mcp'].includes(target)) {
  const coreEntry = targetRequire.resolve('@wyreup/core');
  core = await import(pathToFileURL(coreEntry).href);
  assert(core.createDefaultRegistry().toolsById.size > 200);
  coreRequire = createRequire(coreEntry);
  excelEntry = coreRequire.resolve('@wyreup/exceljs');
  excelRequire = createRequire(excelEntry);
  mammothEntry = coreRequire.resolve('@wyreup/mammoth');
  mammothRequire = createRequire(mammothEntry);
  const { PDFDocument } = await load(coreRequire, 'pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.addPage([72, 72]);
  pdf.setTitle('Packed consumer PDF');
  pdf.setAuthor('Wyreup test fixture');
  const bytes = await pdf.save();
  const infoTool = core.createDefaultRegistry().toolsById.get('pdf-info');
  const info = JSON.parse(await outputBlob(await infoTool.run(
    [new File([bytes], 'consumer.pdf', { type: 'application/pdf' })], infoTool.defaults, context('packed-pdf'),
  )).text());
  assert.equal(info.pageCount, 1);
  assert.equal(info.bytes, bytes.byteLength);
  assert.equal(info.title, 'Packed consumer PDF');
  assert.equal(info.author, 'Wyreup test fixture');
  const { getDocument, version } = await load(coreRequire, 'pdfjs-dist/legacy/build/pdf.mjs');
  assert(Number(version.split('.')[0]) >= 6, 'Old PDF.js runtime installed');
  const loadingTask = getDocument({ data: bytes, useSystemFonts: true });
  try {
    const document = await loadingTask.promise;
    assert.equal(document.numPages, 1);
  } finally {
    await loadingTask.destroy();
  }

  assert(globalThis.crypto.subtle && globalThis.ReadableStream, 'Native crypto and Web Streams are unavailable');
  const openpgp = await load(coreRequire, 'openpgp');
  const passphrase = 'public-test-only-not-a-secret';
  const { publicKey, privateKey } = await openpgp.generateKey({
    type: 'ecc', curve: 'curve25519Legacy', userIDs: [{ name: 'Ephemeral consumer test', email: 'fixture@example.invalid' }],
    passphrase, format: 'armored',
  });
  assert.equal((await openpgp.readKey({ armoredKey: publicKey })).keyPacket.version, 4);
  const plaintext = 'Packed consumer OpenPGP standard-v4 interoperability.\n';
  const data = () => new File([plaintext], 'consumer.txt', { type: 'text/plain' });
  const registry = core.createDefaultRegistry();
  const encrypt = registry.toolsById.get('pgp-encrypt');
  const decrypt = registry.toolsById.get('pgp-decrypt');
  const sign = registry.toolsById.get('pgp-sign');
  const verify = registry.toolsById.get('pgp-verify');
  const protectedKey = { privateKey, passphrase };
  for (const armor of [true, false]) {
    const encrypted = outputBlob(await encrypt.run([data()], { publicKey, armor }, context('packed-pgp-encrypt')));
    const ciphertext = new File([encrypted], 'consumer.pgp');
    const decrypted = outputBlob(await decrypt.run([ciphertext], protectedKey, context('packed-pgp-decrypt')));
    assert.equal(await decrypted.text(), plaintext);
    await assert.rejects(decrypt.run([ciphertext], { privateKey, passphrase: 'wrong' }, context('packed-pgp-wrong-passphrase')));
    const signed = outputBlob(await sign.run([data()], { ...protectedKey, armor }, context('packed-pgp-sign')));
    const signature = new File([signed], 'consumer.sig');
    const verified = JSON.parse(await outputBlob(await verify.run(
      [data(), signature], { publicKey }, context('packed-pgp-verify'),
    )).text());
    assert.equal(verified.verified, true);
    const tamperedData = new File([plaintext + 'tampered'], 'tampered.txt');
    const tamperedVerification = JSON.parse(await outputBlob(await verify.run(
      [tamperedData, signature], { publicKey }, context('packed-pgp-tampered-signature'),
    )).text());
    assert.equal(tamperedVerification.verified, false);
    if (!armor) {
      const damaged = new Uint8Array(await encrypted.arrayBuffer());
      damaged[damaged.length - 1] ^= 1;
      await assert.rejects(decrypt.run(
        [new File([damaged], 'tampered.pgp')], protectedKey, context('packed-pgp-tampered-ciphertext'),
      ));
    }
  }
  await assert.rejects(sign.run([data()], { privateKey, passphrase: 'wrong' }, context('packed-pgp-wrong-sign-passphrase')));
}

if (target === '@wyreup/mammoth') {
  mammothEntry = require.resolve(target);
  mammothRequire = createRequire(mammothEntry);
}
if (mammothRequire) {
  const mammoth = mammothRequire(mammothEntry);
  const JSZip = mammothRequire('jszip');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Secure document conversion</w:t></w:r></w:p></w:body></w:document>');
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  assert.equal((await mammoth.extractRawText({ buffer: bytes })).value.trim(), 'Secure document conversion');
  assert.match((await mammoth.convertToHtml({ buffer: bytes })).value, /<p>Secure document conversion<\/p>/);
  if (core) {
    const tool = core.createDefaultRegistry().toolsById.get('docx-to-text');
    const result = await tool.run([new File([bytes], 'consumer.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })], tool.defaults, {
      signal: new AbortController().signal, cache: new Map(), executionId: 'packed-docx', onProgress() {},
    });
    const output = Array.isArray(result) ? result[0] : result;
    assert.equal((await output.text()).trim(), 'Secure document conversion');
  }
}

if (target === '@wyreup/exceljs') {
  excelRequire = targetRequire;
  excelEntry = require.resolve(target);
}
if (excelRequire) {
  const ExcelJS = excelRequire(excelEntry);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Smoke');
  sheet.addRow(['secure workbook', 3]);
  sheet.addConditionalFormatting({ ref: 'B1', rules: [{ type: 'iconSet', iconSet: '3Triangles',
    cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 1 }, { type: 'num', value: 2 }] }] });
  await sheet.protect('public-test-only-not-a-secret', { spinCount: 1000 });
  const bytes = await workbook.xlsx.writeBuffer();
  const archive = await excelRequire('jszip').loadAsync(bytes);
  const xml = await archive.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(xml, /\{[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}\}/);
  assert.match(xml, /<sheetProtection[^>]*algorithmName="SHA-512"/);
  assert.match(xml, /<sheetProtection[^>]*saltValue="[A-Za-z0-9+/]+=*"/);
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(bytes);
  assert.equal(restored.getWorksheet('Smoke').getCell('A1').value, 'secure workbook');
  assert.equal(restored.getWorksheet('Smoke').sheetProtection.sheet, true);
  if (core) {
    const tool = core.createDefaultRegistry().toolsById.get('json-to-excel');
    const rows = [{ label: 'secure workbook', count: 3 }, { label: 'second row', count: 7 }];
    const result = outputBlob(await tool.run(
      [new File([JSON.stringify(rows)], 'consumer.json', { type: 'application/json' })],
      { sheetName: 'Consumer rows', boldHeaders: true }, context('packed-json-excel'),
    ));
    const converted = new ExcelJS.Workbook();
    await converted.xlsx.load(Buffer.from(await result.arrayBuffer()));
    const convertedSheet = converted.getWorksheet('Consumer rows');
    assert.equal(convertedSheet.getCell('A1').value, 'label');
    assert.equal(convertedSheet.getCell('B1').value, 'count');
    assert.equal(convertedSheet.getCell('A2').value, rows[0].label);
    assert.equal(convertedSheet.getCell('B2').value, rows[0].count);
    assert.equal(convertedSheet.getCell('A3').value, rows[1].label);
    assert.equal(convertedSheet.getCell('B3').value, rows[1].count);
    assert.equal(convertedSheet.getRow(1).font.bold, true);
  }
}

let transformer;
let transformerCjs;
let transformerRequire;
let transformerEntry;
try {
  transformerEntry = targetRequire.resolve('@huggingface/transformers');
} catch (error) {
  // Only a missing direct optional peer is acceptable. Nested runtime failures
  // and broken package entrypoints must propagate instead of appearing absent.
  if (error.code !== 'MODULE_NOT_FOUND' ||
      !error.message.startsWith("Cannot find module '@huggingface/transformers'")) throw error;
  if (expectsAI) throw error;
}
assert.equal(Boolean(transformerEntry), expectsAI,
  expectsAI ? 'Required AI runtime is absent' : 'AI runtime unexpectedly installed for a peer-free consumer');
if (transformerEntry) {
  const packageRoot = path.resolve(path.dirname(transformerEntry), '..');
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.name, '@huggingface/transformers');
  const esmEntry = path.resolve(packageRoot, manifest.exports.node.import.default);
  const cjsEntry = path.resolve(packageRoot, manifest.exports.node.require.default);
  assert.notEqual(esmEntry, cjsEntry, 'Official ESM and CJS entries must be tested separately');
  assert.equal(transformerEntry, cjsEntry, 'CJS resolution differs from the official export map');
  transformerRequire = createRequire(esmEntry);
  transformer = await import(pathToFileURL(esmEntry).href);
  transformerCjs = transformerRequire(cjsEntry);
}

if (transformer) {
  const resolver = transformerRequire ?? targetRequire;
  const nativeEntry = resolver.resolve('onnxruntime-node');
  const native = createRequire(nativeEntry)(nativeEntry);
  const common = createRequire(nativeEntry)('onnxruntime-common');
  assert.equal(native.Tensor, common.Tensor, 'Native runtime/common Tensor identity differs');
  const scalar = (field, value) => Buffer.from([field << 3, value]);
  const message = (field, value) => {
    const bytes = typeof value === 'string' ? Buffer.from(value) : Buffer.concat(value);
    assert(bytes.length < 128, 'Identity fixture exceeds one-byte protobuf length');
    return Buffer.concat([Buffer.from([(field << 3) | 2, bytes.length]), bytes]);
  };
  const valueInfo = (name) => [message(1, name), message(2, [message(1, [scalar(1, 1), message(2, [message(1, [scalar(1, 1)])])])])];
  const graph = [
    message(1, [message(1, 'input'), message(2, 'output'), message(4, 'Identity')]),
    message(2, 'consumer-identity'), message(11, valueInfo('input')), message(12, valueInfo('output')),
  ];
  const model = Buffer.concat([scalar(1, 8), message(7, graph), message(8, [scalar(2, 13)])]);
  const session = await native.InferenceSession.create(model, { executionProviders: ['cpu'] });
  try {
    const tensor = transformer
      ? new transformer.Tensor('float32', Float32Array.of(1.25), [1]).ort_tensor
      : new native.Tensor('float32', Float32Array.of(1.25), [1]);
    assert.equal(tensor.type, 'float32');
    assert.deepEqual(tensor.dims, [1]);
    assert.deepEqual(Array.from(tensor.data), [1.25]);
    const result = await session.run({ input: tensor });
    assert.equal(result.output.type, 'float32');
    assert.deepEqual(result.output.dims, [1]);
    assert.equal(result.output.data[0], 1.25);
    if (transformerCjs) {
      const cjsTensor = new transformerCjs.Tensor('float32', Float32Array.of(2.5), [1]).ort_tensor;
      assert.equal(cjsTensor.type, 'float32');
      assert.deepEqual(cjsTensor.dims, [1]);
      assert.deepEqual(Array.from(cjsTensor.data), [2.5]);
      const cjsResult = await session.run({ input: cjsTensor });
      assert.equal(cjsResult.output.type, 'float32');
      assert.deepEqual(cjsResult.output.dims, [1]);
      assert.equal(cjsResult.output.data[0], 2.5);
    }
  } finally { await session.release(); }
}

if (transformer) {
  const { default: sharp } = await load(transformerRequire, 'sharp');
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#123456' } }).png().toBuffer();
  const image = await transformer.RawImage.fromBlob(new Blob([png], { type: 'image/png' }));
  assert.deepEqual(image.size, [1, 1]);
}
console.log(`Packed consumer smoke passed: ${target}${transformer ? ' with native AI and image decoding' : ''}`);
