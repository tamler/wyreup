import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Exercise emitted ESM and CommonJS, including the bundled worker. Installing
// an npm package does not apply Wyreup's pnpm dependency patches for consumers.
for (const format of ['esm', 'cjs']) {
  it(`packaged ${format} PDF redaction removes text and retains adjacent text`, () => {
    const script = `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    const require = createRequire(new URL('./packages/core/package.json', 'file://' + process.cwd() + '/'));
    const { PDFDocument, StandardFonts, PDFRawStream, PDFName, decodePDFRawStream } = require('pdf-lib');
    const format = process.argv[1];
    const core = format === 'esm'
      ? await import('./packages/core/dist/node/index.js')
      : require('./dist/node/index.cjs');
    const registry = core.createDefaultRegistry();
    const redact = registry.toolsById.get('pdf-redact');
    const extract = registry.toolsById.get('pdf-to-text');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([300, 300]);
    page.drawText('SECRET123 OUTSIDE456', { x: 20, y: 220, size: 12, font });
    const context = {
      signal: new AbortController().signal, onProgress() {}, cache: new Map(), executionId: 'packaged-redact',
    };
    const blob = await redact.run([new File([await doc.save()], 'synthetic.pdf')], {
      rectangles: [{ page: 1, x: 19, y: 215, width: 69, height: 20 }],
    }, context);
    const text = await extract.run([new File([blob], 'redacted.pdf')], {}, context);
    assert.ok((await text.text()).includes('OUTSIDE456'));
    assert.ok(!(await text.text()).includes('SECRET123'));
    const output = await PDFDocument.load(await blob.arrayBuffer());
    let ink = 0;
    for (const [, object] of output.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFRawStream) || object.dict.get(PDFName.of('Subtype'))?.toString() !== '/Image') continue;
      const pixels = decodePDFRawStream(object).decode();
      // 144 DPI: the retained Helvetica text occupies x=185..330, y=140..168.
      for (let y = 140; y < 168; y++) for (let x = 185; x < 330; x++) {
        const offset = (y * 600 + x) * 3;
        if (pixels[offset] < 100 && pixels[offset + 1] < 100 && pixels[offset + 2] < 100) ink++;
      }
    }
    assert.ok(ink > 30, 'Retained standard-font text must have visible raster ink');
    assert.ok(globalThis.pdfjsWorker?.WorkerMessageHandler);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, format], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      encoding: 'utf8',
      timeout: 20_000,
    });
    expect(result.status, result.stderr).toBe(0);
  });
}
