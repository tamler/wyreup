import type { ToolModule, ToolRunContext } from '../../types.js';

export interface NumberBaseConverterParams {
  inputBase?: 2 | 8 | 10 | 16 | 'auto';
}

export interface NumberBaseResult {
  decimal: string;
  binary: string;
  octal: string;
  hexadecimal: string;
  binaryPadded: string;
  hexPadded: string;
}

export const defaultNumberBaseConverterParams: NumberBaseConverterParams = {
  inputBase: 'auto',
};

function detectBase(text: string): number {
  const trimmed = text.trim().toLowerCase();
  if (trimmed.startsWith('0x')) return 16;
  if (trimmed.startsWith('0b')) return 2;
  if (trimmed.startsWith('0o')) return 8;
  if (/^-?[0-9a-f]+$/.test(trimmed) && /[a-f]/.test(trimmed)) return 16;
  if (/^-?[01]+$/.test(trimmed)) return 2;
  if (/^-?[0-7]+$/.test(trimmed)) return 8;
  return 10;
}

function stripPrefix(text: string): string {
  return text.trim().replace(/^0x|^0b|^0o/i, '');
}

export const numberBaseConverter: ToolModule<NumberBaseConverterParams> = {
  id: 'number-base-converter',
  slug: 'number-base-converter',
  name: 'Number Base Converter',
  description:
    'Convert integers between decimal, binary, octal, and hexadecimal. Handles large numbers via BigInt.',
  category: 'dev',
  keywords: ['binary', 'hex', 'octal', 'decimal', 'base', 'convert', 'number', 'bitwise'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 1 * 1024 * 1024,
  },
  output: {
    mime: 'application/json',
    multiple: false,
  },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultNumberBaseConverterParams,

  paramSchema: {
    inputBase: {
      type: 'enum',
      label: 'Input base',
      options: [
        { value: 'auto', label: 'Auto-detect (0x, 0o, 0b prefix)' },
        { value: 2, label: 'Binary (base 2)' },
        { value: 8, label: 'Octal (base 8)' },
        { value: 10, label: 'Decimal (base 10)' },
        { value: 16, label: 'Hexadecimal (base 16)' },
      ],
    },
  },

  async run(
    inputs: File[],
    params: NumberBaseConverterParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'processing', percent: 0, message: 'Converting number base' });

    if (ctx.signal.aborted) throw new Error('Aborted');

    const raw = (await inputs[0]!.text()).trim();
    if (!raw) throw new Error('Input is empty');

    const negative = raw.startsWith('-');
    const absRaw = negative ? raw.slice(1) : raw;
    const stripped = stripPrefix(absRaw);

    let base: number;
    if (params.inputBase === 'auto' || params.inputBase === undefined) {
      base = detectBase(negative ? raw : raw);
    } else {
      base = params.inputBase;
    }

    let value: bigint;
    try {
      value = BigInt(`${negative ? '-' : ''}0x${BigInt(`0x0`).toString(16)}`);
      // Compute via parseInt for bases 2/8/16, direct BigInt for base 10
      if (base === 10) {
        value = BigInt(negative ? `-${stripped}` : stripped);
      } else if (base === 16) {
        value = BigInt(`${negative ? '-' : ''}0x${stripped}`);
      } else if (base === 2) {
        value = BigInt(`${negative ? '-' : ''}0b${stripped}`);
      } else if (base === 8) {
        value = BigInt(`${negative ? '-' : ''}0o${stripped}`);
      } else {
        throw new Error(`Unsupported base: ${base}`);
      }
    } catch {
      throw new Error(`Invalid input "${raw}" for base ${base}`);
    }

    const absVal = value < 0n ? -value : value;
    const sign = value < 0n ? '-' : '';

    const decStr = value.toString(10);
    const binStr = sign + absVal.toString(2);
    const octStr = sign + absVal.toString(8);
    const hexStr = sign + absVal.toString(16).toUpperCase();

    // Pad binary to nearest multiple of 8, hex to nearest multiple of 2
    const binAbs = absVal.toString(2);
    const hexAbs = absVal.toString(16).toUpperCase();
    const binPadded = sign + binAbs.padStart(Math.ceil(binAbs.length / 8) * 8, '0');
    const hexPadded = sign + hexAbs.padStart(Math.ceil(hexAbs.length / 2) * 2, '0');

    const result: NumberBaseResult = {
      decimal: decStr,
      binary: binStr,
      octal: octStr,
      hexadecimal: hexStr,
      binaryPadded: binPadded,
      hexPadded: hexPadded,
    };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
