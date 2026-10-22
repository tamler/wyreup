import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { deflateSync } from 'node:zlib';

/** Independently authored fixture PDFs; no statement parser or serializer creates them. */
export async function makeBankPdf(
  kind:
    | 'known'
    | 'fragmented'
    | 'scan'
    | 'mixed'
    | 'unknown'
    | 'rotated'
    | 'blank'
    | 'many-pages'
    | 'debit-credit' = 'known',
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Synthetic statement fixture');
  pdf.setAuthor('Wyreup test fixture');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const alternate = await pdf.embedFont(StandardFonts.Courier);
  const one = pdf.addPage([600, 800]);
  const two = pdf.addPage([600, 800]);
  const draw = (page: typeof one, y: number, values: [number, string][]) => {
    for (const [x, text] of values) {
      if (kind === 'fragmented' && (x === 35 || x === 360 || x === 440)) {
        const half = Math.ceil(text.length / 2);
        const first = text.slice(0, half),
          second = text.slice(half);
        page.drawText(first, { x, y, font, size: 8 });
        page.drawText(second, {
          x: x + font.widthOfTextAtSize(first, 8),
          y,
          font: alternate,
          size: 8,
        });
      } else
        page.drawText(text, {
          x,
          y,
          font,
          size: 8,
          ...(kind === 'rotated' && x === 35 ? { rotate: degrees(90) } : {}),
        });
    }
  };
  draw(one, 760, [
    [120, 'Opening balance'],
    [440, '1000.00'],
  ]);
  draw(one, 700, [
    [35, '2026-01-01'],
    [120, 'Card purchase'],
    [360, kind === 'debit-credit' ? '12.34' : '-12.34'],
    [440, '987.66'],
  ]);
  draw(one, 680, [[120, 'continued note']]);
  draw(one, 650, [
    [35, '2026-01-02'],
    [120, 'Deposit'],
    [kind === 'debit-credit' ? 400 : 360, '25.00'],
    [440, '1012.66'],
  ]);
  draw(two, 700, [
    [35, '2026-01-03'],
    [120, 'Transfer'],
    [360, kind === 'debit-credit' ? '100.00' : '-100.00'],
    [440, '912.66'],
  ]);
  draw(two, 650, [
    [120, 'Closing balance'],
    [440, '912.66'],
  ]);
  if (kind === 'blank') pdf.addPage([600, 800]);
  if (kind === 'many-pages') {
    while (pdf.getPageCount() < 101) pdf.addPage([600, 800]);
  }
  if (kind === 'scan' || kind === 'mixed' || kind === 'unknown') {
    const page = kind === 'mixed' ? one : pdf.addPage([600, 800]);
    const size = kind === 'unknown' ? 2 : 1;
    const png = rgbaPng(size, size);
    const image = await pdf.embedPng(png);
    page.drawImage(image, { x: 35, y: 300, width: 400, height: 150 });
  }
  return pdf.save({ useObjectStreams: false });
}

function rgbaPng(width: number, height: number): Uint8Array {
  const crc = (data: Uint8Array) => {
    let v = 0xffffffff;
    for (const byte of data) {
      v ^= byte;
      for (let i = 0; i < 8; i++) v = (v >>> 1) ^ (v & 1 ? 0xedb88320 : 0);
    }
    return (v ^ 0xffffffff) >>> 0;
  };
  const chunk = (name: string, data: Uint8Array) => {
    const type = Buffer.from(name);
    const payload = Buffer.concat([type, data]);
    const out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length, 0);
    payload.copy(out, 4);
    out.writeUInt32BE(crc(payload), out.length - 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc(height * (1 + width * 4), 255);
  for (let y = 0; y < height; y++) raw[y * (1 + width * 4)] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ]);
}
