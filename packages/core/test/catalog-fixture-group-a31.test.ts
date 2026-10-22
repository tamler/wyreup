import { expect, it } from 'vitest';
import {
  base64,
  caseConverter,
  colorConverter,
  compoundInterest,
  cronFromText,
  cssFormatter,
  csvJson,
  dateCalculator,
  ipSubnetCalc,
  jsonYaml,
  jwtDecoder,
  percentageCalculator,
  slug,
  textDeveloperTools,
  textEscape,
  timestampConverter,
  unitConverter,
  urlEncoder,
  xmlFormatter,
  type ToolRunContext,
} from '../src/index.js';
import { csvViewer } from '../dist/node/index.js';

const context = (): ToolRunContext => ({
  signal: new AbortController().signal,
  cache: new Map(),
  executionId: 'group-a31-independent-authorities',
  onProgress() {},
});

function textDeveloperTool(id: string) {
  const matches = textDeveloperTools.filter((tool) => tool.id === id);
  if (matches.length !== 1) throw new Error('Expected exactly one public textDeveloper tool.');
  return matches[0]!;
}

it('group-a31 number-to-words-converter', async () => {
  const inputs: File[] = [];
  const params = { numberText: '0' };
  const outputs = await textDeveloperTool('number-to-words-converter').run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  expect(JSON.parse(await outputs[0]!.text())).toMatchObject({ words: 'zero' });
});

it('group-a31 chmod-calculator', async () => {
  const inputs: File[] = [];
  const params = {};
  const outputs = await textDeveloperTool('chmod-calculator').run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  expect(JSON.parse(await outputs[0]!.text())).toEqual({
    octal: '0644',
    symbolic: 'rw-r--r--',
    command: "chmod 0644 -- 'data.txt'",
  });
});

it('group-a31 cron-from-text', async () => {
  const inputs: File[] = [];
  const params = {
    mode: 'fields',
    minute: '0,15-45/15',
    hour: '9-17/2',
    dayOfWeek: '7',
    currentDate: '2026-01-03T00:00:00Z',
    nextCount: 2,
  } as const;
  const outputs = await cronFromText.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  expect(JSON.parse(await outputs[0]!.text())).toMatchObject({
    nextRuns: ['2026-01-04T09:00:00.000Z', '2026-01-04T09:15:00.000Z'],
  });
});

it('group-a31 utm-link-builder', async () => {
  const inputs: File[] = [];
  const params = {
    url: 'https://example.com/p?x=a%20b&x=a+b&tilde=%7E&utm_source=old&utm_source=again#f%20g',
    source: 'A&B',
    medium: 'email',
    campaign: 'café',
  };
  const outputs = await textDeveloperTool('utm-link-builder').run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  expect(JSON.parse(await outputs[0]!.text())).toMatchObject({
    url: 'https://example.com/p?x=a%20b&x=a+b&tilde=%7E&utm_source=A%26B&utm_medium=email&utm_campaign=caf%C3%A9#f%20g',
  });
});

it('group-a31 px-to-rem-converter', async () => {
  const inputs: File[] = [];
  const params = {};
  const outputs = await textDeveloperTool('px-to-rem-converter').run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  expect(JSON.parse(await outputs[0]!.text())).toEqual({
    value: '1',
    approximation: false,
    unit: 'rem',
    rootPx: '16',
  });
});

it('group-a31 ip-subnet-calc', async () => {
  const inputs: File[] = [];
  const params = { cidr: '192.168.1.37/24' };
  const outputs = await ipSubnetCalc.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  expect(JSON.parse(await outputs[0]!.text())).toMatchObject({
    network: '192.168.1.0',
    inputIsNetworkAddress: false,
  });
});

it('group-a31 unit-converter', async () => {
  const inputs: File[] = [];
  const params = { value: 1, from: 'h', to: 's', category: 'time' } as const;
  const outputs = await unitConverter.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  expect(JSON.parse(await outputs[0]!.text())).toMatchObject({ valid: true, result: 3600 });
});

it('group-a31 case-converter', async () => {
  const inputs = [new File(['hello world'], 'input.txt', { type: 'text/plain' })];
  const params = { case: 'upper' } as const;
  const outputs = await caseConverter.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('text/plain');
  expect(await outputs[0]!.text()).toBe('HELLO WORLD');
});

it('group-a31 slug', async () => {
  const inputs = [new File(['Hello World'], 'input.txt', { type: 'text/plain' })];
  const params = {};
  const outputs = await slug.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('text/plain');
  expect(await outputs[0]!.text()).toBe('hello-world');
});

it('group-a31 markdown-table-generator', async () => {
  const inputs = [
    new File(['name,note\nA,"a|b\\c\n<script>""x""</script>"\n'], 'fixture.txt', { type: 'text/plain' }),
  ];
  const params = {};
  const outputs = await textDeveloperTool('markdown-table-generator').run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('text/markdown');
  expect(await outputs[0]!.text()).toBe(
    '| name | note |\n| --- | --- |\n| A | a\\|b\\\\c<br>&lt;script&gt;&quot;x&quot;&lt;/script&gt; |\n',
  );
});

it('group-a31 bulk-meta-description-generator', async () => {
  const inputs = [
    new File(['title,topic,url\nHello,World,https://example.com/\n,Ignored,/empty'], 'fixture.txt', { type: 'text/plain' }),
  ];
  const params = { maxGraphemes: 20 };
  const outputs = await textDeveloperTool('bulk-meta-description-generator').run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('text/csv');
  expect(await outputs[0]!.text()).toBe(
    'url,title,description,graphemeCount,truncated,error\nhttps://example.com/,Hello,Hello: World,12,false,\n/empty,,,0,false,Empty title',
  );
});

it('group-a31 javascript-minifier', async () => {
  const inputs = [new File(['export const value = 2;'], 'fixture.txt', { type: 'text/plain' })];
  const params = { module: true };
  const outputs = await textDeveloperTool('javascript-minifier').run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('text/javascript');
  expect(await outputs[0]!.text()).toBe('export const value=2;');
});

it('group-a31 url-encoder', async () => {
  const inputs = [new File(['hello world & foo=bar'], 'test.txt', { type: 'text/plain' })];
  const params = { mode: 'encode', scope: 'component' } as const;
  const outputs = await urlEncoder.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('text/plain');
  expect(await outputs[0]!.text()).toBe('hello%20world%20%26%20foo%3Dbar');
});

it('group-a31 timestamp-converter', async () => {
  const inputs = [new File(['1776000000'], 'ts.txt', { type: 'text/plain' })];
  const params = {};
  const outputs = await timestampConverter.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  expect(JSON.parse(await outputs[0]!.text())).toMatchObject({
    valid: true,
    epochSeconds: 1776000000,
    epochMilliseconds: 1776000000000,
  });
});

it('group-a31 jwt-decoder', async () => {
  const inputs = [
    new File(['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'], 'token.txt', { type: 'text/plain' }),
  ];
  const params = {};
  const outputs = await jwtDecoder.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  expect(JSON.parse(await outputs[0]!.text())).toMatchObject({
    valid: true,
    header: { alg: 'HS256', typ: 'JWT' },
    payload: { sub: '1234567890', name: 'John Doe' },
  });
});

it('group-a31 css-formatter', async () => {
  const inputs = [new File([`${' '.repeat(100_000)}a`], 'styles.css', { type: 'text/css' })];
  const params = { mode: 'minify' } as const;
  const outputs = await cssFormatter.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('text/css');
  expect(await outputs[0]!.text()).toBe('a');
});

it('group-a31 xml-formatter', async () => {
  const inputs = [new File(['<root>\n  <child>hello</child>\n  <other>world</other>\n</root>'], 'input.xml', { type: 'text/xml' })];
  const params = { mode: 'minify' } as const;
  const outputs = await xmlFormatter.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('text/xml');
  expect(await outputs[0]!.text()).toBe('<root><child>hello</child><other>world</other></root>');
});

it('group-a31 text-escape', async () => {
  const inputs = [new File(['\\u0048\\u0065\\u006C\\u006C\\u006F'], 'uni.txt', { type: 'text/plain' })];
  const params = { mode: 'decode-unicode' } as const;
  const outputs = await textEscape.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('text/plain');
  expect(await outputs[0]!.text()).toBe('Hello');
});

it('group-a31 json-yaml', async () => {
  const inputs = [new File(['x: 1\n'], 'input.txt', { type: 'text/plain' })];
  const params = { direction: 'yaml-to-json' } as const;
  const outputs = await jsonYaml.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('text/plain');
  expect(JSON.parse(await outputs[0]!.text())).toEqual({ x: 1 });
});

it('group-a31 base64', async () => {
  const inputs = [new File(['Hello, World!'], 'test.txt', { type: 'text/plain' })];
  const params = { mode: 'encode' } as const;
  const outputs = await base64.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('text/plain');
  expect(await outputs[0]!.text()).toBe('SGVsbG8sIFdvcmxkIQ==');
});

it('group-a31 csv-json', async () => {
  const inputs = [new File(['a,b\r\n\r\n'], 'mixed.csv', { type: 'text/csv' })];
  const params = {
    direction: 'csv-to-csv',
    sourceDelimiter: ',',
    targetDelimiter: '\t',
    recordNewline: 'lf',
  } as const;
  const outputs = await csvJson.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('text/plain');
  expect(await outputs[0]!.text()).toBe('"a"\t"b"\n""\n');
});

it('group-a31 robots-txt-generator', async () => {
  const inputs: File[] = [];
  const params = {
    groupsJson: '[{"userAgent":"*","rule":"Disallow","path":"/private/"},{"userAgent":"*","rule":"Allow","path":"/private/public/"},{"userAgent":"ExampleBot","rule":"Disallow","path":""}]',
    sitemapsJson: '[{"url":"https://example.com/sitemap.xml"}]',
  };
  const outputs = await textDeveloperTool('robots-txt-generator').run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('text/plain');
  expect(await outputs[0]!.text()).toBe(
    'User-agent: *\nDisallow: /private/\nAllow: /private/public/\n\nUser-agent: ExampleBot\nDisallow:\n\nSitemap: https://example.com/sitemap.xml\n',
  );
});

it('group-a31 csp-header-generator', async () => {
  const inputs: File[] = [];
  const params = {};
  const outputs = await textDeveloperTool('csp-header-generator').run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('text/plain');
  expect(await outputs[0]!.text()).toBe("Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'");
});

it('group-a31 hreflang-tag-generator', async () => {
  const inputs: File[] = [];
  const params = {
    linksJson: '[{"language":"en_US","url":"https://example.com/?a=1&b=2"},{"language":"x-default","url":"https://example.com/?a=1&b=2"}]',
  };
  const outputs = await textDeveloperTool('hreflang-tag-generator').run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('text/html');
  expect(await outputs[0]!.text()).toBe(
    '<link rel="alternate" hreflang="en-US" href="https://example.com/?a=1&amp;b=2">\n<link rel="alternate" hreflang="x-default" href="https://example.com/?a=1&amp;b=2">\n',
  );
});

it('group-a31 nginx-redirect-generator', async () => {
  const inputs: File[] = [];
  const params = {
    redirectsJson: '[{"source":"/old","destination":"/new?a=1&b=2","status":301}]',
  };
  const outputs = await textDeveloperTool('nginx-redirect-generator').run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('text/plain');
  expect(await outputs[0]!.text()).toBe('location = /old { return 301 "/new?a=1&b=2"; }\n');
});

it('group-a31 color-converter', async () => {
  const inputs = [new File(['#ff0000'], 'color.txt', { type: 'text/plain' })];
  const params = {};
  const outputs = await colorConverter.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  expect(JSON.parse(await outputs[0]!.text())).toMatchObject({
    valid: true,
    hex: '#ff0000',
    rgb: { r: 255, g: 0, b: 0 },
  });
});

it('group-a31 css-gradient-generator', async () => {
  const inputs: File[] = [];
  const params = {};
  const outputs = await textDeveloperTool('css-gradient-generator').run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  expect(JSON.parse(await outputs[0]!.text())).toMatchObject({
    css: 'linear-gradient(90deg, rgba(255, 0, 0, 1) 0%, rgba(0, 0, 255, 1) 100%)',
  });
});

it('group-a31 compound-interest', async () => {
  const inputs: File[] = [];
  const params = {
    principal: 1000,
    annualRate: 10,
    years: 1,
    compoundingPerYear: 1,
    monthlyContribution: 100,
  };
  const outputs = await compoundInterest.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  expect(JSON.parse(await outputs[0]!.text())).toMatchObject({ finalBalance: 2354.05 });
});

it('group-a31 percentage-calculator', async () => {
  const inputs: File[] = [];
  const params = { mode: 'percent-of', value: 20, base: 200 } as const;
  const outputs = await percentageCalculator.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  expect(JSON.parse(await outputs[0]!.text())).toMatchObject({ valid: true, result: 40 });
});

it('group-a31 date-calculator', async () => {
  const inputs: File[] = [];
  const params = { mode: 'day-of-week', date1: '2026-01-01' } as const;
  const outputs = await dateCalculator.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  expect(JSON.parse(await outputs[0]!.text())).toMatchObject({ valid: true, dayName: 'Thursday' });
});

it('group-a31 csv-viewer', async () => {
  const inputs = [new File(['name,count\r\n"two, commas",2\r\n"line\ninside",03\r\n'], 'fixture.csv', { type: 'text/csv' })];
  const params = { delimiter: 'comma' } as const;
  const outputs = await csvViewer.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('text/csv');
  expect(await outputs[0]!.text()).toBe('name,count\r\n"two, commas",2\r\n"line\ninside",03\r\n');
});
