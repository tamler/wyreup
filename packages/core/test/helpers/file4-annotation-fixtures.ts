import { PDFDocument, PDFName, PDFString, StandardFonts, type PDFPage } from 'pdf-lib';
import { originalPng } from './file3-png-oracle.js';

export type AnnotationFixtureKind =
  'only' | 'mixed' | 'text-only' | 'hidden' | 'noview' | 'invisible' | 'outside' | 'zero';

/** Original fixed-coordinate appearances, authored independently of PDFJS and bank extraction. */
export async function originalAnnotationPdf(kind: AnnotationFixtureKind): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Original Wyreup FILE4 annotation regression fixture');
  pdf.setAuthor('Wyreup independent fixture author');
  pdf.setCreationDate(new Date('2026-01-01T00:00:00Z'));
  pdf.setModificationDate(new Date('2026-01-01T00:00:00Z'));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([600, 800]);
  for (const [y, cells] of [
    [
      760,
      [
        [120, 'Opening balance'],
        [440, '1000.00'],
      ],
    ],
    [
      700,
      [
        [35, '2026-01-01'],
        [120, 'Purchase'],
        [360, '-10.00'],
        [440, '990.00'],
      ],
    ],
    [
      650,
      [
        [120, 'Closing balance'],
        [440, '990.00'],
      ],
    ],
  ] as const)
    for (const [x, text] of cells) page.drawText(text, { x, y, font, size: 8 });

  const image = await pdf.embedPng(originalPng(1, 1, 6, [0, 255, 0, 0, 255]));
  function annotate(target: PDFPage, type: 'FreeText' | 'Stamp', textOnly = false) {
    const stream =
      type === 'Stamp'
        ? 'q 200 0 0 80 0 0 cm /I1 Do Q'
        : `${textOnly ? '' : 'q 1 1 0 rg 0 0 200 80 re f '}0 g BT /F1 12 Tf 10 30 Td (Transaction -25.00) Tj ET${textOnly ? '' : ' Q'}`;
    const appearance = pdf.context.register(
      pdf.context.flateStream(stream, {
        Type: 'XObject',
        Subtype: 'Form',
        FormType: 1,
        BBox: [0, 0, 200, 80],
        Resources: type === 'Stamp' ? { XObject: { I1: image.ref } } : { Font: { F1: font.ref } },
      }),
    );
    const flags = kind === 'hidden' ? 2 : kind === 'noview' ? 32 : kind === 'invisible' ? 1 : 4;
    const rect =
      kind === 'outside'
        ? [700, 500, 900, 580]
        : kind === 'zero'
          ? [60, 500, 60, 580]
          : [60, 500, 260, 580];
    const annotation = pdf.context.register(
      pdf.context.obj({
        Type: 'Annot',
        Subtype: kind === 'invisible' ? 'OriginalNonstandard' : type,
        Rect: rect,
        F: flags,
        Contents: PDFString.of('Original visible appearance transaction -25.00'),
        AP: { N: appearance },
        ...(type === 'FreeText' ? { DA: PDFString.of('/F1 12 Tf 0 g') } : { Name: 'Approved' }),
        A: { S: 'URI', URI: PDFString.of('https://annotation-fixture.invalid/never-fetch') },
        AA: {
          E: { S: 'JavaScript', JS: PDFString.of('globalThis.__file4AnnotationAction = true;') },
        },
      }),
    );
    target.node.addAnnot(annotation);
  }
  if (kind === 'mixed') annotate(page, 'Stamp');
  else if (kind === 'only') {
    annotate(pdf.addPage([600, 800]), 'FreeText');
    annotate(pdf.addPage([600, 800]), 'Stamp');
    pdf.addPage([600, 800]);
  } else annotate(pdf.addPage([600, 800]), 'FreeText', kind === 'text-only');
  return pdf.save({ useObjectStreams: false });
}

export type ProjectedAnnotationKind =
  | 'freetext-only'
  | 'text-freetext'
  | 'empty-freetext'
  | 'state-freetext'
  | 'empty-state'
  | 'clip-state'
  | 'link-only'
  | 'text-link'
  | 'shared-link'
  | 'generated-widget'
  | 'empty-widget'
  | 'noap-widget'
  | 'text-widget'
  | 'off-empty-ap'
  | 'off-no-ap'
  | 'listbox'
  | 'duplicate-link';

/** Original dictionaries mirror independently inspected pinned SDK metadata, not the classifier. */
export async function originalProjectedAnnotationPdf(
  kind: ProjectedAnnotationKind,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Original Wyreup FILE4 projected ${kind}`);
  pdf.setAuthor('Wyreup independent fixture author');
  pdf.setCreationDate(new Date('2026-01-01T00:00:00Z'));
  pdf.setModificationDate(new Date('2026-01-01T00:00:00Z'));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([600, 800]);
  page.node.setFontDictionary(PDFName.of('Helvetica'), font.ref);
  if (!['freetext-only', 'link-only', 'generated-widget', 'noap-widget'].includes(kind)) {
    for (const [y, cells] of [
      [
        760,
        [
          [120, 'Opening balance'],
          [440, '1000.00'],
        ],
      ],
      [
        700,
        [
          [35, '2026-01-01'],
          [120, 'Purchase'],
          [360, '-10.00'],
          [440, '990.00'],
        ],
      ],
      [
        650,
        [
          [120, 'Closing balance'],
          [440, '990.00'],
        ],
      ],
    ] as const)
      for (const [x, text] of cells) page.drawText(text, { x, y, font, size: 8 });
  }
  const common = { Type: 'Annot', Rect: [60, 500, 260, 580], F: 4, P: page.ref };
  const stateAppearance = (stream: string) =>
    pdf.context.register(
      pdf.context.flateStream(stream, {
        Type: 'XObject',
        Subtype: 'Form',
        FormType: 1,
        BBox: [0, 0, 200, 80],
        Resources: {},
      }),
    );
  let reference;
  if (['link-only', 'text-link', 'shared-link', 'duplicate-link'].includes(kind)) {
    reference = pdf.context.register(
      pdf.context.obj({
        ...common,
        Subtype: 'Link',
        A: { S: 'URI', URI: PDFString.of('https://annotation-fixture.invalid/never-fetch') },
      }),
    );
  } else if (kind === 'empty-state' || kind === 'clip-state') {
    reference = pdf.context.register(
      pdf.context.obj({
        ...common,
        Subtype: 'Stamp',
        Name: 'Approved',
        AP: { N: stateAppearance(kind === 'clip-state' ? 'q 0 0 200 80 re W n Q' : 'q Q') },
      }),
    );
  } else if (kind.includes('freetext')) {
    reference = pdf.context.register(
      pdf.context.obj({
        ...common,
        Subtype: 'FreeText',
        Contents: PDFString.of(kind === 'empty-freetext' ? '' : 'Transaction -25.00'),
        DA: PDFString.of('/Helvetica 12 Tf 0 g'),
        DR: { Font: { Helvetica: font.ref } },
        Border: [0, 0, 0],
        ...(kind === 'state-freetext' ? { AP: { N: stateAppearance('q Q') } } : {}),
      }),
    );
  } else {
    const off = kind === 'off-empty-ap' || kind === 'off-no-ap';
    const empty = kind === 'empty-widget';
    const listbox = kind === 'listbox';
    reference = pdf.context.register(
      pdf.context.obj({
        ...common,
        Subtype: 'Widget',
        FT: off ? 'Btn' : listbox ? 'Ch' : 'Tx',
        Ff: 0,
        T: PDFString.of('Original independent form value'),
        V: off ? PDFName.of('Off') : listbox ? [] : PDFString.of(empty ? '' : 'Transaction -25.00'),
        DA: PDFString.of('/Helvetica 12 Tf 0 g'),
        ...(off ? { AS: PDFName.of('Off') } : {}),
        ...(kind === 'off-empty-ap'
          ? {
              AP: {
                N: { Off: stateAppearance('q Q'), Yes: stateAppearance('q 0 g 2 2 16 16 re f Q') },
              },
            }
          : {}),
        ...(listbox
          ? { Opt: [PDFString.of('Transaction -25.00'), PDFString.of('Original option B')] }
          : {}),
      }),
    );
    pdf.catalog.set(
      PDFName.of('AcroForm'),
      pdf.context.obj({
        Fields: [reference],
        NeedAppearances: ['generated-widget', 'empty-widget', 'off-no-ap'].includes(kind),
        DA: PDFString.of('/Helvetica 12 Tf 0 g'),
        DR: { Font: { Helvetica: font.ref } },
      }),
    );
  }
  page.node.addAnnot(reference);
  if (kind === 'shared-link') pdf.addPage([600, 800]).node.addAnnot(reference);
  if (kind === 'duplicate-link') page.node.addAnnot(reference);
  return pdf.save({ useObjectStreams: false, updateFieldAppearances: false });
}
