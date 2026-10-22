import { describe, expect, it } from 'vitest';
import { beautifyCode, codeBeautifier } from '../../src/utilities/code-beautifier.js';
import { calculateAspectRatio } from '../../src/utilities/aspect-ratio.js';
import { robotsText } from '../../src/utilities/text-developer.js';
import type { ToolRunContext } from '../../src/types.js';

const context = (onProgress: ToolRunContext['onProgress'] = () => {}): ToolRunContext => ({
  signal: new AbortController().signal,
  cache: new Map(),
  executionId: 'text-core-source-correction2',
  onProgress,
});

describe('text core correction2 JSON facade lexemes', () => {
  it.each(['12345678901234567890', '1.0', '1e2', '-0', '1e309'])(
    'preserves the original strict JSON number token %s',
    async (lexeme) => {
      expect(await beautifyCode(`{"n":${lexeme}}`, 'json', context())).toBe(
        `{\n  "n": ${lexeme}\n}`,
      );
    },
  );

  it.each(['{"n":1,}', '{"n":NaN}', '{"n":+1}', '{"n":01}', "{'n':1}"])(
    'still refuses malformed strict JSON %s',
    async (source) => {
      await expect(beautifyCode(source, 'json', context())).rejects.toThrow();
    },
  );
});

describe('text core correction2 direct facade input', () => {
  it('refuses valid ASCII JSON with PNG MIME before reading bytes or progress', async () => {
    class ObservedFile extends File {
      reads = 0;

      override arrayBuffer(): Promise<ArrayBuffer> {
        this.reads += 1;
        return super.arrayBuffer();
      }
    }
    const file = new ObservedFile(['{"a":1}'], 'code.png', { type: 'image/png' });
    const stages: string[] = [];
    let output: unknown;
    let refusal: unknown;
    try {
      output = await codeBeautifier.run(
        [file],
        { language: 'json' },
        context((progress) => stages.push(progress.stage)),
      );
    } catch (error) {
      refusal = error;
    }
    expect.soft(refusal).toBeInstanceOf(Error);
    expect.soft(output).toBeUndefined();
    expect.soft(file.reads).toBe(0);
    expect(stages).toEqual([]);
  });
});

describe('text core correction2 aspect fields used by the chosen mode', () => {
  it('computes a missing width despite the unused width being empty', () => {
    expect(
      calculateAspectRatio({
        mode: 'missingWidth',
        width: '',
        height: '900',
        ratioWidth: '16',
        ratioHeight: '9',
      }),
    ).toMatchObject({ width: '1600', height: '900', ratio: '16:9', approximate: false });
  });

  it('computes a missing height despite the unused height being empty', () => {
    expect(
      calculateAspectRatio({
        mode: 'missingHeight',
        width: '1600',
        height: '',
        ratioWidth: '16',
        ratioHeight: '9',
      }),
    ).toMatchObject({ width: '1600', height: '900', ratio: '16:9', approximate: false });
  });

  it('reduces dimensions despite unused ratio fields being empty', () => {
    expect(
      calculateAspectRatio({
        mode: 'ratio',
        width: '1600',
        height: '900',
        ratioWidth: '',
        ratioHeight: '',
      }),
    ).toMatchObject({ width: '1600', height: '900', ratio: '16:9', approximate: false });
  });

  it('still refuses an empty used dimension and a nontyped unused field', () => {
    expect(() => calculateAspectRatio({ mode: 'ratio', height: '' })).toThrow();
    expect(() => calculateAspectRatio({ mode: 'ratio', ratioWidth: 16 })).toThrow();
  });
});

describe('text core correction2 case-insensitive robots groups', () => {
  it('refuses a nonconsecutive user agent repeated with different letter case', () => {
    expect(() =>
      robotsText({
        groupsJson: JSON.stringify([
          { userAgent: 'Bot', rule: 'Allow', path: '/' },
          { userAgent: '*', rule: 'Disallow', path: '/private/' },
          { userAgent: 'bot', rule: 'Allow', path: '/public/' },
        ]),
        sitemapsJson: '[]',
      }),
    ).toThrow(/consecutive/);
  });

  it('emits one header with the first raw spelling for adjacent case-insensitive agents', () => {
    expect(
      robotsText({
        groupsJson: JSON.stringify([
          { userAgent: 'Bot', rule: 'Disallow', path: '/private/' },
          { userAgent: 'bot', rule: 'Allow', path: '/private/public/' },
        ]),
        sitemapsJson: '[]',
      }),
    ).toBe('User-agent: Bot\nDisallow: /private/\nAllow: /private/public/\n');
  });

  it('retains supported literal path syntax and encoded-control refusal', () => {
    expect(
      robotsText({
        groupsJson: JSON.stringify([
          { userAgent: '*', rule: 'Allow', path: '/search?q=a&x=1' },
          { userAgent: '*', rule: 'Allow', path: '/caf%C3%A9' },
          { userAgent: '*', rule: 'Disallow', path: '/*.pdf$' },
        ]),
        sitemapsJson: '[]',
      }),
    ).toBe('User-agent: *\nAllow: /search?q=a&x=1\nAllow: /caf%C3%A9\nDisallow: /*.pdf$\n');
    expect(() =>
      robotsText({
        groupsJson: JSON.stringify([{ userAgent: '*', rule: 'Allow', path: '/%0A' }]),
        sitemapsJson: '[]',
      }),
    ).toThrow();
  });
});
