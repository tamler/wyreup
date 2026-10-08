import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const directory = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const entries = (await readdir(path.join(directory, '_astro'))).filter((name) => /^openpgp.*\.js$/.test(name));
assert.equal(entries.length, 1, 'Expected one production OpenPGP module');
const fixture = JSON.parse(await readFile(new URL('../../core/test/fixtures/openpgp-standard-v4.json', import.meta.url), 'utf8'));
const headers = await readFile(new URL('../public/_headers', import.meta.url), 'utf8');
const policy = headers.match(/^\s+Content-Security-Policy:\s*(.+)$/m)?.[1];
assert(policy, 'Production CSP is missing');
const server = createServer((request, response) => {
  void (async () => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const filename = path.resolve(directory, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!filename.startsWith(directory + path.sep)) { response.writeHead(403).end(); return; }
    const bytes = await readFile(filename).catch(() => null);
    if (!bytes) { response.writeHead(404).end(); return; }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    response.writeHead(200, { 'Content-Type': types[path.extname(filename)] ?? 'application/octet-stream', 'Content-Security-Policy': policy });
    response.end(bytes);
  })().catch(() => response.writeHead(500).end());
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  const page = await browser.newPage({ serviceWorkers: 'block' });
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async ({ entry, fixture }) => {
    if (!isSecureContext || !crypto.subtle || !ReadableStream) throw new Error('Native browser crypto/streams unavailable');
    const pgp = await import(`/_astro/${entry}`);
    const publicKey = await pgp.readKey({ armoredKey: fixture.publicKey });
    const privateKey = await pgp.decryptKey({ privateKey: await pgp.readPrivateKey({ armoredKey: fixture.privateKey }), passphrase: fixture.passphrase });
    const bytes = new TextEncoder().encode(fixture.plaintext);
    const legacy = await pgp.decrypt({ message: await pgp.readMessage({ armoredMessage: fixture.encryptedArmored }), decryptionKeys: privateKey, format: 'binary' });
    if (new TextDecoder().decode(legacy.data) !== fixture.plaintext) throw new Error('Legacy browser decryption differs');
    for (const armor of [true, false]) {
      const message = await pgp.createMessage({ binary: bytes });
      const encrypted = await pgp.encrypt({ message, encryptionKeys: publicKey, format: armor ? 'armored' : 'binary' });
      const parsed = await pgp.readMessage(armor ? { armoredMessage: encrypted } : { binaryMessage: encrypted });
      const decrypted = await pgp.decrypt({ message: parsed, decryptionKeys: privateKey, format: 'binary' });
      if (new TextDecoder().decode(decrypted.data) !== fixture.plaintext) throw new Error('Browser roundtrip differs');
      const signed = await pgp.sign({ message, signingKeys: privateKey, detached: true, format: armor ? 'armored' : 'binary' });
      const signature = await pgp.readSignature(armor ? { armoredSignature: signed } : { binarySignature: signed });
      const verified = await pgp.verify({ message, signature, verificationKeys: publicKey });
      await verified.signatures[0].verified;
      const tampered = await pgp.verify({ message: await pgp.createMessage({ binary: new TextEncoder().encode('tampered') }), signature, verificationKeys: publicKey });
      let rejected = false;
      try { await tampered.signatures[0].verified; } catch { rejected = true; }
      if (!rejected) throw new Error('Tampered browser message accepted');
    }
    return { secure: true, legacy: true, armored: true, binary: true, tamperRejected: true };
  }, { entry: entries[0], fixture });
  assert.deepEqual(result, { secure: true, legacy: true, armored: true, binary: true, tamperRejected: true });
  console.log('Production browser OpenPGP compatibility and tamper rejection passed.');
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
