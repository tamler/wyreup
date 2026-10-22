import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDefaultRegistry, type ToolModule, type ToolRunContext } from '@wyreup/core';
import {
  mergeToolParams,
  parseToolFlag,
  readToolParamsJson,
  STRICT_TOOL_IDS,
  toolParamHelp,
} from '../src/lib/tool-params.js';
import { extFromMime, inferMimeFromPath } from '../src/lib/mime.js';

const registry = createDefaultRegistry();
function tool(id: string): ToolModule {
  const found = registry.toolsById.get(id);
  if (!found) throw new Error(`Missing actual built tool: ${id}`);
  return found;
}
function context(): ToolRunContext {
  return {
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'adapter-unit',
    onProgress() {},
  };
}
const directories: string[] = [];
async function file(bytes: string | Uint8Array): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'wyreup-param-test-'));
  directories.push(directory);
  const path = join(directory, 'params.json');
  await writeFile(path, bytes);
  return path;
}
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe('bounded local parameter JSON', () => {
  it('retains explicit null, arrays, decimal strings and inert prototype keys', async () => {
    const path = await file('{"opening":null,"rows":[],"ratio":".125","__proto__":{"x":1}}');
    const params = await readToolParamsJson(path, context().signal);
    expect(params.opening).toBeNull();
    expect(params.rows).toEqual([]);
    expect(params.ratio).toBe('.125');
    expect(Object.getPrototypeOf(params)).toBeNull();
    expect(Object.hasOwn(params, '__proto__')).toBe(true);
    expect({}).not.toHaveProperty('x');
  });
  it.each(['null', '[]', 'true', '"text"'])('refuses a nonobject root %s', async (body) => {
    await expect(readToolParamsJson(await file(body), context().signal)).rejects.toThrow('object');
  });
  it.each([
    new Uint8Array([0xef, 0xbb, 0xbf, 123, 125]),
    new Uint8Array([123, 34, 120, 34, 58, 34, 0xff, 34, 125]),
    new TextEncoder().encode('{bad}'),
  ])('refuses BOM, malformed UTF-8 or malformed JSON %#', async (bytes) => {
    await expect(readToolParamsJson(await file(bytes), context().signal)).rejects.toThrow(/UTF-8/);
  });
  it('accepts an exact 1 MiB object and refuses the next byte', async () => {
    const body = `{"x":"${' '.repeat(1048576 - 8)}"}`;
    expect(Buffer.byteLength(body)).toBe(1048576);
    expect((await readToolParamsJson(await file(body), context().signal)).x).toHaveLength(
      1048576 - 8,
    );
    await expect(readToolParamsJson(await file(`${body} `), context().signal)).rejects.toThrow(
      '1 MiB',
    );
  });
  it('rejects URLs/stdin and stops an already-aborted read before opening', async () => {
    await expect(
      readToolParamsJson('https://example.com/params.json', context().signal),
    ).rejects.toThrow('local');
    await expect(readToolParamsJson('-', context().signal)).rejects.toThrow('local');
    const controller = new AbortController();
    controller.abort();
    await expect(readToolParamsJson('/missing.json', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});

describe('typed direct parameter merge', () => {
  it('applies JSON, ordered repeat flags, then named flags without erasing omitted values', () => {
    const params = mergeToolParams(
      tool('cron-from-text'),
      { minute: '5', timezone: 'UTC', nextCount: 2 },
      ['nextCount=3', 'nextCount=4'],
      { nextCount: '1', minute: undefined },
    );
    expect(params).toMatchObject({ minute: '5', timezone: 'UTC', nextCount: 1 });
  });
  it('keeps exact aspect strings and typed enum choices', () => {
    const params = mergeToolParams(
      tool('aspect-ratio-calculator'),
      {},
      ['width=.125', 'height=.05'],
      {},
    );
    expect(params.width).toBe('.125');
    expect(params.height).toBe('.05');
    expect(parseToolFlag(tool('number-base-converter'), 'inputBase', '16', {})).toBe(16);
  });
  it.each(['', ' ', '0x10', '1oops', 'NaN', 'Infinity', '1e400'])(
    'rejects incomplete/nondecimal numeric text %j',
    (text) => {
      expect(() => parseToolFlag(tool('cron-from-text'), 'nextCount', text, {})).toThrow('decimal');
    },
  );
  it.each(['+.5', '-1.25', '1e2'])('accepts complete decimal grammar %s', (text) => {
    expect(parseToolFlag(tool('lorem-ipsum'), 'paragraphs', text, {})).toBe(Number(text));
  });
  it('accepts only exact boolean literals', () => {
    expect(parseToolFlag(tool('lorem-ipsum'), 'startWithLorem', 'false', {})).toBe(false);
    expect(() => parseToolFlag(tool('lorem-ipsum'), 'startWithLorem', '1', {})).toThrow(
      'true or false',
    );
  });
  it('refuses ambiguous string/number enum spellings with JSON guidance', () => {
    const fixture: ToolModule = {
      ...tool('lorem-ipsum'),
      paramSchema: {
        choice: {
          type: 'enum',
          options: [
            { value: '1', label: 'string' },
            { value: 1, label: 'number' },
          ],
        },
      },
    };
    expect(() => parseToolFlag(fixture, 'choice', '1', {})).toThrow('--params-json');
  });
  it('resolves cascading enum choices using current merged controls', () => {
    const fixture: ToolModule = {
      ...tool('lorem-ipsum'),
      paramSchema: {
        unit: {
          type: 'enum',
          options: [{ value: 'fallback', label: 'fallback' }],
          optionsFrom: { field: 'family', map: { length: [{ value: 'mm', label: 'mm' }] } },
        },
      },
    };
    expect(parseToolFlag(fixture, 'unit', 'mm', { family: 'length' })).toBe('mm');
    expect(parseToolFlag(fixture, 'unit', 'fallback', { family: 'length' })).toBe('fallback');
    const strictFixture: ToolModule = { ...fixture, id: 'loan-calculator' };
    expect(parseToolFlag(strictFixture, 'unit', 'mm', { family: 'length' })).toBe('mm');
    expect(() => parseToolFlag(strictFixture, 'unit', 'fallback', { family: 'length' })).toThrow(
      'declared',
    );
  });
  it('preserves default-only arrays and actual fractional Lorem runtime bounds', async () => {
    const params = mergeToolParams(
      tool('lorem-ipsum'),
      {},
      [
        'paragraphs=2.5',
        'sentencesPerParagraph=2.5',
        'wordsPerSentence=[1,1]',
        'startWithLorem=false',
      ],
      {},
    );
    const result = await tool('lorem-ipsum').run([], params, context());
    const body = await (Array.isArray(result) ? result[0]! : result).text();
    expect(body.split('\n\n')).toHaveLength(3);
    expect(body.split('\n\n').every((paragraph) => paragraph.match(/\./g)?.length === 3)).toBe(
      true,
    );
    expect(
      mergeToolParams(
        tool('lorem-ipsum'),
        {},
        ['paragraphs=1000', 'sentencesPerParagraph=100'],
        {},
      ),
    ).toMatchObject({ paragraphs: 1000, sentencesPerParagraph: 100 });
  });
  it('leaves legacy unknown fields/coercion and optional undefined defaults available', () => {
    expect(
      mergeToolParams(tool('percentage-calculator'), { custom: [1] }, ['other=10'], {}),
    ).toMatchObject({ custom: [1], other: 10 });
    expect(mergeToolParams(tool('slug'), {}, [], {})).not.toHaveProperty('maxLength');
    expect(STRICT_TOOL_IDS.has('slug')).toBe(false);
  });
  it('rejects reviewed strict unknowns/accessors and ignores inactive raw conditional values', () => {
    expect(() =>
      mergeToolParams(
        tool('loan-calculator'),
        { APR: 0, secretCanary: 'DO_NOT_ECHO_VALUE' },
        [],
        {},
      ),
    ).toThrow('Unknown parameter: secretCanary');
    let reads = 0;
    const accessor = Object.defineProperty({}, 'APR', {
      enumerable: true,
      get() {
        reads++;
        return 0;
      },
    });
    expect(() => mergeToolParams(tool('loan-calculator'), accessor, [], {})).toThrow(
      'data properties',
    );
    expect(reads).toBe(0);
    const params = mergeToolParams(
      tool('paypal-fee-calculator'),
      { percent: 0, fixed: 0, capEnabled: false, cap: { ignored: true } },
      [],
      {},
    );
    expect(params).not.toHaveProperty('cap');
    expect(() => mergeToolParams(tool('loan-calculator'), {}, [], {})).toThrow('APR');
  });
  it('parses bank mapping/review JSON and explicit nullable anchors/year', () => {
    const params = mergeToolParams(
      tool('bank-statement-to-csv'),
      { opening: '100.00' },
      ['opening=null', 'statementYear=null', 'lineDecisions=[]', 'pageDecisions=[]'],
      {},
    );
    expect(params).toMatchObject({
      opening: null,
      statementYear: null,
      lineDecisions: [],
      pageDecisions: [],
    });
    expect(params.mapping).toMatchObject({ mode: 'signed-amount' });
  });
  it('parses real row arrays but keeps generator/finance JSON row strings once encoded', () => {
    const pieces =
      '[{"thicknessIn":1,"widthIn":12,"lengthFt":8,"quantity":2,"pricePerBoardFoot":3}]';
    expect(
      mergeToolParams(tool('board-foot-calculator'), {}, [`pieces=${pieces}`], {}).pieces,
    ).toEqual(JSON.parse(pieces));
    const groups = '[{"userAgent":"*","rule":"Disallow","path":"/private"}]';
    expect(
      mergeToolParams(tool('robots-txt-generator'), {}, [`groupsJson=${groups}`], {}).groupsJson,
    ).toBe(groups);
    const tiers =
      '[{"name":"Basic","members":1,"monthlyPrice":5,"failedMembers":0,"taxPerMember":0,"paymentPercent":0,"paymentFixed":0}]';
    expect(
      mergeToolParams(
        tool('patreon-earnings-calculator'),
        { platformRate: 0, paymentRate: 0, paymentFixed: 0 },
        [`tiersJson=${tiers}`],
        {},
      ).tiersJson,
    ).toBe(tiers);
    const parsedGroups: unknown = JSON.parse(groups);
    expect(() =>
      mergeToolParams(tool('robots-txt-generator'), { groupsJson: parsedGroups }, [], {}),
    ).toThrow('Expected text');
    expect(toolParamHelp(tool('robots-txt-generator'), 'groupsJson')).toContain(
      'userAgent,rule,path',
    );
    expect(toolParamHelp(tool('patreon-earnings-calculator'), 'tiersJson')).toContain(
      'failedMembers',
    );
  });
  it.each([
    ['model.stl', 'model/stl', '.stl'],
    ['camera.NEF', 'image/tiff', '.tiff'],
    ['image.psd', 'image/vnd.adobe.photoshop', '.psd'],
    ['sheet.tsv', 'text/tab-separated-values', '.tsv'],
    ['code.js', 'text/javascript', '.js'],
    ['query.sql', 'application/sql', '.sql'],
  ])('maps the actual file extension %s', (path, mime, extension) => {
    expect(inferMimeFromPath(path)).toBe(mime);
    expect(extFromMime(mime)).toBe(extension);
  });
});
