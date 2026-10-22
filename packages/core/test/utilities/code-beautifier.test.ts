import { describe, expect, it } from 'vitest';
import { beautifyCode, codeBeautifier, type BeautifierLanguage } from '../../src/utilities/code-beautifier.js';
import type { ToolRunContext } from '../../src/types.js';
const context = (): ToolRunContext => ({ signal: new AbortController().signal, cache: new Map(), executionId: 'beautifier', onProgress: () => {} });
describe('real installed code formatters', () => {
  it('uses Babel/Estree formatting without executing input', async () => {
    expect(await beautifyCode('const x={a:1}', 'javascript', context())).toBe('const x = { a: 1 };\n');
    expect(await beautifyCode('globalThis.__wyreupExecuted=true', 'javascript', context())).toBe('globalThis.__wyreupExecuted = true;\n');
    expect(globalThis).not.toHaveProperty('__wyreupExecuted');
  });
  it.each< [BeautifierLanguage, string, string] >([
    ['json', '{"a":1}', '{\n  "a": 1\n}'],
    ['css', 'a{color:red}', 'a {\n  color: red;\n}\n'],
    ['html', '<p>x</p>', '<p>x</p>\n'],
    ['xml', '<root><a>x</a></root>', '<root>\n  <a>x</a>\n</root>\n'],
    ['sql', 'select a from t', 'SELECT\n  a\nFROM\n  t'],
  ])('formats %s with its existing engine', async (language, text, expected) => {
    expect(await beautifyCode(text, language, context())).toBe(expected);
  });
  it('surfaces genuine parse errors and parameter/input failures', async () => {
    await expect(beautifyCode('{bad}', 'json', context())).rejects.toThrow();
    await expect(beautifyCode('a { color:', 'css', context())).rejects.toThrow();
    await expect(beautifyCode('const =', 'javascript', context())).rejects.toThrow();
    await expect(beautifyCode('x', 'unknown' as never, context())).rejects.toThrow();
    await expect(codeBeautifier.run([new File([new Uint8Array([0xc3])], 'bad.txt')], {}, context())).rejects.toThrow();
    await expect(codeBeautifier.run([new File(['x'], 'code.txt')], { unknown: true }, context())).rejects.toThrow();
    const ctx = context(); const controller = new AbortController(); controller.abort();
    await expect(beautifyCode('const x=1', 'javascript', { ...ctx, signal: controller.signal })).rejects.toThrow('cancelled');
  });
});
