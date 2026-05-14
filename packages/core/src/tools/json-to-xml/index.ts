import type { ToolModule, ToolRunContext } from '../../types.js';

export interface JsonToXmlParams {
  /** Root tag name when the JSON top-level is an array or has multiple keys. */
  rootName?: string;
  /** Whether to indent the output for readability. */
  indent?: boolean;
  /** Tag name used to wrap text content alongside attributes. */
  textNodeName?: string;
  /** Attribute prefix used in the input JSON to mark XML attributes. */
  attrPrefix?: string;
}

export const defaultJsonToXmlParams: JsonToXmlParams = {
  rootName: 'root',
  indent: true,
  textNodeName: '#text',
  attrPrefix: '@_',
};

const JsonToXmlComponentStub = (): unknown => null;

export const jsonToXml: ToolModule<JsonToXmlParams> = {
  id: 'json-to-xml',
  slug: 'json-to-xml',
  name: 'JSON to XML',
  description:
    'Serialize JSON as XML via fast-xml-parser. Mirrors xml-to-json — keys prefixed with @_ become attributes, the special key #text becomes the element text content. Round-trip with xml-to-json on simple shapes.',
  category: 'convert',
  presence: 'both',
  keywords: ['xml', 'json', 'convert', 'serialize', 'soap'],

  input: {
    accept: ['application/json', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: { mime: 'application/xml' },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultJsonToXmlParams,

  paramSchema: {
    rootName: {
      type: 'string',
      label: 'root tag',
      help: 'Wrapping element when the JSON has multiple top-level keys or is an array.',
      placeholder: 'root',
    },
    indent: {
      type: 'boolean',
      label: 'pretty-print',
    },
    textNodeName: {
      type: 'string',
      label: 'text node key',
      placeholder: '#text',
    },
    attrPrefix: {
      type: 'string',
      label: 'attribute prefix',
      placeholder: '@_',
    },
  },

  Component: JsonToXmlComponentStub,

  async run(inputs: File[], params: JsonToXmlParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('json-to-xml accepts exactly one file.');
    ctx.onProgress({ stage: 'loading-deps', percent: 15, message: 'Loading XML builder' });
    const { XMLBuilder } = await import('fast-xml-parser');
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 40, message: 'Parsing JSON' });
    const text = await inputs[0]!.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Input is not valid JSON: ${msg}`);
    }

    ctx.onProgress({ stage: 'processing', percent: 75, message: 'Building XML' });
    const rootName = params.rootName ?? 'root';
    const builder = new XMLBuilder({
      format: params.indent ?? true,
      indentBy: '  ',
      attributeNamePrefix: params.attrPrefix ?? '@_',
      textNodeName: params.textNodeName ?? '#text',
      ignoreAttributes: false,
      suppressEmptyNode: false,
    });

    // Determine the top-level structure. fast-xml-parser's builder expects a
    // dict with a single root key OR will emit the object as a top-level set
    // of elements (which produces invalid XML). Wrap if needed.
    let toBuild: unknown = parsed;
    const isObject = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
    const topKeys = isObject ? Object.keys(parsed as Record<string, unknown>).filter((k) => !k.startsWith((params.attrPrefix ?? '@_'))) : [];
    if (!isObject || topKeys.length !== 1) {
      toBuild = { [rootName]: parsed };
    }

    const xml = builder.build(toBuild);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([xml], { type: 'application/xml' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/xml'],
  },
};
