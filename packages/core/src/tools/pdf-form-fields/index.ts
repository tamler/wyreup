import type { ToolModule, ToolRunContext } from '../../types.js';
import type * as PdfLib from '@cantoo/pdf-lib';

export interface PdfFormFieldsParams {
  /** Include the current value for fields that have one set. */
  includeValues?: boolean;
}

export const defaultPdfFormFieldsParams: PdfFormFieldsParams = {
  includeValues: true,
};

interface FieldEntry {
  name: string;
  type: 'text' | 'checkbox' | 'radio-group' | 'dropdown' | 'option-list' | 'button' | 'signature' | 'unknown';
  isRequired: boolean;
  isReadOnly: boolean;
  value?: string | boolean | string[];
  options?: string[];
}

export interface PdfFormFieldsResult {
  count: number;
  fields: FieldEntry[];
}

export const pdfFormFields: ToolModule<PdfFormFieldsParams> = {
  id: 'pdf-form-fields',
  slug: 'pdf-form-fields',
  name: 'PDF Form Fields',
  description:
    'List every interactive form field in a PDF — name, type, required/read-only flags, and current value where present. Read-only inspection; use Flatten PDF Form to lock the values in.',
  category: 'pdf',
  keywords: ['pdf', 'form', 'fields', 'inspect', 'acroform', 'list'],

  input: {
    accept: ['application/pdf'],
    min: 1,
    max: 1,
    sizeLimit: 100 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  chainSuggestions: ['pdf-flatten', 'pdf-info', 'pdf-metadata'],

  defaults: defaultPdfFormFieldsParams,
  paramSchema: {
    includeValues: {
      type: 'boolean',
      label: 'include values',
      help: 'Read the currently-filled value for each field (when present).',
    },
  },

  async run(
    inputs: File[],
    params: PdfFormFieldsParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('pdf-form-fields accepts exactly one file.');
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 20, message: 'Loading PDF' });

    const lib = await import('@cantoo/pdf-lib');
    if (ctx.signal.aborted) throw new Error('Aborted');

    const bytes = await inputs[0]!.arrayBuffer();
    const doc = await lib.PDFDocument.load(bytes);

    if (ctx.signal.aborted) throw new Error('Aborted');
    ctx.onProgress({ stage: 'processing', percent: 70, message: 'Reading fields' });

    const form = doc.getForm();
    const wantValues = params.includeValues !== false;

    const fields = form.getFields().map((f): FieldEntry => {
      const entry: FieldEntry = {
        name: f.getName(),
        type: detectType(f, lib),
        isRequired: false,
        isReadOnly: false,
      };

      // Required / read-only are accessor methods on PDFField in pdf-lib.
      try { entry.isRequired = f.isRequired(); } catch { /* not all field types expose this */ }
      try { entry.isReadOnly = f.isReadOnly(); } catch { /* same */ }

      if (wantValues) {
        try {
          if (f instanceof lib.PDFTextField) {
            const v = f.getText();
            if (v != null) entry.value = v;
          } else if (f instanceof lib.PDFCheckBox) {
            entry.value = f.isChecked();
          } else if (f instanceof lib.PDFRadioGroup) {
            entry.options = f.getOptions();
            const selected = f.getSelected();
            if (selected != null) entry.value = selected;
          } else if (f instanceof lib.PDFDropdown) {
            entry.options = f.getOptions();
            entry.value = f.getSelected();
          } else if (f instanceof lib.PDFOptionList) {
            entry.options = f.getOptions();
            entry.value = f.getSelected();
          }
        } catch {
          /* skip fields whose value access throws */
        }
      }

      return entry;
    });

    const out: PdfFormFieldsResult = { count: fields.length, fields };
    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};

function detectType(f: unknown, lib: typeof PdfLib): FieldEntry['type'] {
  if (f instanceof lib.PDFTextField) return 'text';
  if (f instanceof lib.PDFCheckBox) return 'checkbox';
  if (f instanceof lib.PDFRadioGroup) return 'radio-group';
  if (f instanceof lib.PDFDropdown) return 'dropdown';
  if (f instanceof lib.PDFOptionList) return 'option-list';
  if (f instanceof lib.PDFButton) return 'button';
  if (f instanceof lib.PDFSignature) return 'signature';
  return 'unknown';
}
