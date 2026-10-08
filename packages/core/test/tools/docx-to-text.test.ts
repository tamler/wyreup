import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { docxToText } from '../../src/tools/docx-to-text/index.js';

export async function docxFixture(): Promise<File> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file('word/styles.xml', '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Example &amp; heading</w:t></w:r></w:p><w:p><w:r><w:t>Hello world.</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph.</w:t></w:r></w:p></w:body></w:document>');
  return new File([await zip.generateAsync({ type: 'arraybuffer' })], 'example.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

describe('DOCX tool runtime compatibility', () => {
  for (const preserveParagraphs of [true, false]) {
    for (const includeHeadingMarkers of [true, false]) {
      it(`extracts real DOCX bytes with paragraphs=${preserveParagraphs}, headings=${includeHeadingMarkers}`, async () => {
        const result = await docxToText.run([await docxFixture()], { preserveParagraphs, includeHeadingMarkers }, {
          onProgress() {}, signal: new AbortController().signal, cache: new Map(), executionId: 'docx-runtime',
        });
        const text = await (result as Blob).text();
        expect(text).toContain('Example & heading');
        expect(text).toContain('Hello world.');
        expect(text).toContain('Second paragraph.');
        expect(text.startsWith('# ')).toBe(includeHeadingMarkers);
        expect(text.includes('\n\n')).toBe(preserveParagraphs);
      });
    }
  }
});
