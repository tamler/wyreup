import type { ToolModule, ToolRunContext } from '../../types.js';

export interface XmlToJsonParams {
  /** Preserve XML attributes — they'll appear under the @_attr or `@:attr` keys. */
  preserveAttributes?: boolean;
  /** Try to type-cast numeric / boolean text values rather than leaving them as strings. */
  parseValues?: boolean;
  /** How to wrap repeated child elements — array of objects or object with array values. */
  arrayMode?: 'always' | 'auto';
}

export const defaultXmlToJsonParams: XmlToJsonParams = {
  preserveAttributes: true,
  parseValues: false,
  arrayMode: 'auto',
};

const XmlToJsonComponentStub = (): unknown => null;

export const xmlToJson: ToolModule<XmlToJsonParams> = {
  id: 'xml-to-json',
  slug: 'xml-to-json',
  name: 'XML to JSON',
  description:
    'Convert XML to JSON via fast-xml-parser. Attributes can be preserved (under @_attr keys), numeric / boolean text can be auto-typed, and repeated child elements get wrapped in arrays consistently. Inverse of json-to-xml.',
  category: 'convert',
  presence: 'both',
  keywords: ['xml', 'json', 'convert', 'parse', 'soap', 'rss'],

  input: {
    accept: ['application/xml', 'text/xml', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultXmlToJsonParams,

  paramSchema: {
    preserveAttributes: {
      type: 'boolean',
      label: 'preserve attributes',
      help: 'XML attributes appear in the JSON under keys prefixed with @_ (e.g. <a id="1">x</a> → {"a":{"@_id":"1","#text":"x"}}).',
    },
    parseValues: {
      type: 'boolean',
      label: 'parse values',
      help: 'Coerce numeric / boolean text. Off by default to preserve fidelity for round-trips.',
    },
    arrayMode: {
      type: 'enum',
      label: 'array mode',
      help: '"auto" emits arrays only when the same child name repeats. "always" wraps every child in an array for shape consistency.',
      options: [
        { value: 'auto', label: 'auto — array only when repeated' },
        { value: 'always', label: 'always — every child is an array' },
      ],
    },
  },

  Component: XmlToJsonComponentStub,

  async run(inputs: File[], params: XmlToJsonParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('xml-to-json accepts exactly one file.');
    ctx.onProgress({ stage: 'loading-deps', percent: 15, message: 'Loading XML parser' });
    const { XMLParser } = await import('fast-xml-parser');
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Parsing XML' });
    const text = await inputs[0]!.text();
    const parserOptions: Record<string, unknown> = {
      ignoreAttributes: !(params.preserveAttributes ?? true),
      attributeNamePrefix: '@_',
      parseAttributeValue: params.parseValues ?? false,
      parseTagValue: params.parseValues ?? false,
      trimValues: true,
    };
    if (params.arrayMode === 'always') {
      parserOptions.isArray = () => true;
    }
    const parser = new XMLParser(parserOptions);
    let parsed: unknown;
    try {
      parsed = parser.parse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not parse XML: ${msg}`);
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(parsed, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
