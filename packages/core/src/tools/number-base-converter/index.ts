import type { ToolModule, ToolRunContext } from '../../types.js';

export interface NumberBaseConverterParams {
  conversionKind?: 'numeric' | 'utf8-bytes';
  direction?: 'encode' | 'decode';
  byteFormat?: 'binary' | 'hex' | 'decimal';
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
  conversionKind: 'numeric',
  direction: 'encode',
  byteFormat: 'binary',
  inputBase: 'auto',
};

/** Convert exact text to UTF-8 byte groups, or strictly decode such groups. */
export function convertUtf8Bytes(
  text: string,
  direction: 'encode' | 'decode',
  byteFormat: 'binary' | 'hex' | 'decimal',
): string {
  if (!['encode', 'decode'].includes(direction)) throw new Error('Invalid byte direction');
  if (!['binary', 'hex', 'decimal'].includes(byteFormat)) throw new Error('Invalid byte format');
  if (direction === 'encode') {
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(++i);
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('Unpaired UTF-16 surrogate');
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        throw new Error('Unpaired UTF-16 surrogate');
      }
    }
    const bytes = new TextEncoder().encode(text);
    if (bytes.length > 1024 * 1024) throw new Error('Input exceeds 1 MiB');
    return Array.from(bytes, (byte) =>
      byteFormat === 'binary'
        ? byte.toString(2).padStart(8, '0')
        : byteFormat === 'hex'
          ? byte.toString(16).padStart(2, '0')
          : String(byte),
    ).join(' ');
  }
  if (text.length > 1024 * 1024) throw new Error('Input exceeds 1 MiB');
  const trimmed = text.replace(/^ +| +$/g, '');
  if (!trimmed) return '';
  const groups = trimmed.split(/ +/);
  const bytes = groups.map((group) => {
    const valid =
      byteFormat === 'binary'
        ? /^[01]{8}$/.test(group)
        : byteFormat === 'hex'
          ? /^[0-9a-fA-F]{2}$/.test(group)
          : /^(?:0|[1-9][0-9]{0,2})$/.test(group);
    if (!valid) throw new Error('Invalid byte group');
    const byte = Number.parseInt(
      group,
      byteFormat === 'binary' ? 2 : byteFormat === 'hex' ? 16 : 10,
    );
    if (byte > 255) throw new Error('Byte must be between 0 and 255');
    return byte;
  });
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(new Uint8Array(bytes));
  } catch {
    throw new Error('Invalid UTF-8 byte sequence');
  }
}

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

export const numberBaseConverter: ToolModule<NumberBaseConverterParams> = {
  id: 'number-base-converter',
  slug: 'number-base-converter',
  name: 'Number Base Converter',
  description:
    'Convert integers between decimal, binary, octal, and hexadecimal, or encode and decode UTF-8 byte groups. Numeric mode returns JSON; UTF-8 mode returns plain text.',
  category: 'dev',
  keywords: ['binary', 'hex', 'octal', 'decimal', 'base', 'convert', 'number', 'bitwise'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 1 * 1024 * 1024,
  },
  output: {
    mime: '*/*',
    multiple: false,
  },

  // Both numeric JSON and UTF-8 text can be encoded or hashed as exact bytes.
  chainSuggestions: ['base64', 'hash'],

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultNumberBaseConverterParams,

  paramSchema: {
    conversionKind: {
      type: 'enum',
      label: 'Conversion',
      options: [
        { value: 'numeric', label: 'Integer bases (JSON)' },
        { value: 'utf8-bytes', label: 'UTF-8 bytes (plain text)' },
      ],
    },
    direction: {
      type: 'enum',
      label: 'Direction',
      options: [
        { value: 'encode', label: 'Text to bytes' },
        { value: 'decode', label: 'Bytes to text' },
      ],
      showWhen: { field: 'conversionKind', equals: 'utf8-bytes' },
    },
    byteFormat: {
      type: 'enum',
      label: 'Byte format',
      options: [
        { value: 'binary', label: '8-bit binary groups' },
        { value: 'hex', label: 'Hexadecimal pairs' },
        { value: 'decimal', label: 'Decimal bytes' },
      ],
      help: 'Byte groups use ASCII spaces. Encoding preserves all whitespace; decoding rejects invalid UTF-8.',
      showWhen: { field: 'conversionKind', equals: 'utf8-bytes' },
    },
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
      showWhen: { field: 'conversionKind', equals: 'numeric' },
    },
  },

  async run(
    inputs: File[],
    params: NumberBaseConverterParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'processing', percent: 0, message: 'Converting number base' });

    if (ctx.signal.aborted) throw new Error('Aborted');

    if (inputs.length !== 1 || !inputs[0]) throw new Error('Exactly one text file is required');
    if (inputs[0].size > 1024 * 1024) throw new Error('Input exceeds 1 MiB');
    if (
      params.conversionKind !== undefined &&
      !['numeric', 'utf8-bytes'].includes(params.conversionKind)
    ) {
      throw new Error('Invalid conversion kind');
    }
    if (params.conversionKind === 'utf8-bytes') {
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
          await inputs[0].arrayBuffer(),
        );
      } catch {
        throw new Error('Input must be valid UTF-8 text');
      }
      if (ctx.signal.aborted) throw new Error('Aborted');
      const output = convertUtf8Bytes(
        text,
        params.direction ?? 'encode',
        params.byteFormat ?? 'binary',
      );
      ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
      return [new Blob([output], { type: 'text/plain' })];
    }

    const raw = (await inputs[0].text()).trim();
    if (ctx.signal.aborted) throw new Error('Aborted');
    if (!raw) throw new Error('Input is empty');
    if (/^[+-]{2}/.test(raw)) throw new Error('Use at most one integer sign.');
    if (/\s/.test(raw)) throw new Error('Integer digits cannot contain whitespace.');
    if (params.inputBase !== undefined && !['auto', 2, 8, 10, 16].includes(params.inputBase))
      throw new Error(`Unsupported base: ${String(params.inputBase)}`);

    const negative = raw.startsWith('-');
    const absRaw = /^[+-]/.test(raw) ? raw.slice(1) : raw;

    let base: number;
    if (params.inputBase === 'auto' || params.inputBase === undefined) {
      base = detectBase(raw.startsWith('+') ? raw : absRaw);
    } else {
      base = params.inputBase;
    }

    let value: bigint;
    try {
      const prefix = base === 16 ? /^0x/i : base === 2 ? /^0b/i : base === 8 ? /^0o/i : /$^/;
      const stripped = absRaw.replace(prefix, '');
      const digits =
        base === 16
          ? /^[0-9a-f]+$/i
          : base === 2
            ? /^[01]+$/
            : base === 8
              ? /^[0-7]+$/
              : /^[0-9]+$/;
      if (!digits.test(stripped)) throw new Error('Invalid integer digits');
      if (base === 10) {
        value = BigInt(stripped);
      } else if (base === 16) {
        value = BigInt(`0x${stripped}`);
      } else if (base === 2) {
        value = BigInt(`0b${stripped}`);
      } else if (base === 8) {
        value = BigInt(`0o${stripped}`);
      } else {
        throw new Error(`Unsupported base: ${base}`);
      }
      if (negative) value = -value;
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
    expectedOutputMime: ['application/json', 'text/plain'],
  },
};
