import { describe, expect, it } from 'vitest';
import { vcfToCsv } from '../../../src/tools/vcf-to-csv/index.js';
import type { VcfContactRow, VcfToCsvParams } from '../../../src/tools/vcf-to-csv/types.js';
import type { ToolRunContext } from '../../../src/types.js';

const CONTACTS = String.raw`BEGIN:VCARD
VERSION:3.0
FN:Ada Lovelace
N:Lovelace;Ada;;;
ORG:Analytical Engines
TITLE:Mathematician
EMAIL;TYPE=WORK:ada@example.com
EMAIL;TYPE=HOME:ada@home.example
TEL;TYPE=CELL:+1-555-0100
TEL;TYPE=WORK:+1-555-0101
ADR;TYPE=WORK:;;12 Computing Way;London;;;UK
BDAY:1815-12-10
URL:https://example.com/ada
NOTE:First programmer\, and author of a very long note that is
 folded onto another line
END:VCARD
BEGIN:VCARD
VERSION:4.0
FN:Grace Hopper
N:Hopper;Grace;;;
ORG:United States Navy
EMAIL;TYPE=work:grace@example.com
TEL;TYPE=cell:555-0200
NOTE:Compiler pioneer\; rear admiral\\mentor\nCOBOL advocate
END:VCARD
`;

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

async function run(text = CONTACTS, params: VcfToCsvParams = {}): Promise<Blob> {
  const input = new File([text], 'contacts.vcf', { type: 'text/vcard' });
  const [output] = (await vcfToCsv.run([input], params, makeCtx())) as Blob[];
  return output!;
}

describe('vcf-to-csv — metadata', () => {
  it('declares conversion and export metadata', () => {
    expect(vcfToCsv.category).toBe('convert');
    expect(vcfToCsv.categories).toEqual(['convert', 'export']);
    expect(vcfToCsv.input.accept).toEqual(['text/vcard', 'text/x-vcard', 'text/plain']);
    expect(vcfToCsv.defaults).toEqual({ format: 'csv' });
    expect(vcfToCsv.llmDescription).toBeTruthy();
  });
});

describe('vcf-to-csv — run()', () => {
  it('writes fixed columns and two vCard 3.0/4.0 contacts as CSV', async () => {
    const output = await run();
    const csv = await output.text();
    const lines = csv.split('\r\n');

    expect(output.type).toBe('text/csv');
    expect(lines[0]).toBe(
      'name,given_name,family_name,org,title,emails,phones,address,birthday,url,note',
    );
    expect(lines).toHaveLength(3);
    expect(csv).toContain('Ada Lovelace,Ada,Lovelace,Analytical Engines,Mathematician');
    expect(csv).toContain('ada@example.com;ada@home.example');
    expect(csv).toContain('+1-555-0100;+1-555-0101');
    expect(csv).toContain('12 Computing Way London UK');
    expect(csv).toContain(
      '"First programmer, and author of a very long note that isfolded onto another line"',
    );
  });

  it('returns the same rows in JSON mode and unescapes contact text', async () => {
    const output = await run(CONTACTS, { format: 'json' });
    const rows = JSON.parse(await output.text()) as VcfContactRow[];

    expect(output.type).toBe('application/json');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: 'Ada Lovelace',
      given_name: 'Ada',
      family_name: 'Lovelace',
      emails: 'ada@example.com;ada@home.example',
      phones: '+1-555-0100;+1-555-0101',
    });
    expect(rows[1]!.note).toBe('Compiler pioneer; rear admiral\\mentor\nCOBOL advocate');
  });

  it('rejects input without a complete vCard block', async () => {
    await expect(run('FN:Not a vCard')).rejects.toThrow('Invalid vCard');
  });

  it('rejects an invalid output format', async () => {
    await expect(run(CONTACTS, { format: 'xml' as 'csv' })).rejects.toThrow(
      'Invalid output format',
    );
  });
});
