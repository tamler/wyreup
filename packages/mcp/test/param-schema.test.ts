import { describe, expect, it } from 'vitest';
import { createDefaultRegistry, type ToolModule } from '@wyreup/core';
import { admitToolParams, projectToolParamsSchema, STRICT_TOOL_IDS } from '../src/param-schema.js';

const registry = createDefaultRegistry();
function tool(id: string): ToolModule {
  const found = registry.toolsById.get(id);
  if (!found) throw new Error(`Missing actual built tool: ${id}`);
  return found;
}
function properties(id: string): Record<string, Record<string, unknown>> {
  return projectToolParamsSchema(tool(id)).properties as Record<string, Record<string, unknown>>;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected an actual schema record.');
  return value as Record<string, unknown>;
}

function activeField(schema: Record<string, unknown>, key: string): Record<string, unknown> {
  const branches = schema.allOf;
  if (!Array.isArray(branches)) throw new Error('Expected conditional schema branches.');
  for (const branch of branches as unknown[]) {
    const then = record(record(branch).then);
    const fields = record(then.properties);
    if (Object.hasOwn(fields, key)) return { ...record(fields[key]), required: then.required };
  }
  throw new Error(`Missing conditional schema for ${key}.`);
}

describe('truthful typed parameter projection and native admission', () => {
  it('projects active required null as number plus required, never nullable/null-only', () => {
    const schema = projectToolParamsSchema(tool('loan-calculator'));
    expect(properties('loan-calculator').APR).toMatchObject({ type: 'number', minimum: 0 });
    expect(schema.required).toContain('APR');
    expect(() => admitToolParams(tool('loan-calculator'), {})).toThrow('APR');
    expect(() => admitToolParams(tool('loan-calculator'), { APR: null })).toThrow('APR');
    expect(admitToolParams(tool('loan-calculator'), { APR: 0 }).APR).toBe(0);
  });
  it('leaves inactive values unconstrained and binds active rules including implicit defaults', () => {
    const schema = projectToolParamsSchema(tool('paypal-fee-calculator'));
    const props = properties('paypal-fee-calculator');
    expect(props.cap).not.toHaveProperty('type');
    expect(activeField(schema, 'cap').required).toEqual(['cap']);
    expect(
      admitToolParams(tool('paypal-fee-calculator'), { percent: 0, fixed: 0, cap: [] }),
    ).not.toHaveProperty('cap');
    expect(() =>
      admitToolParams(tool('paypal-fee-calculator'), {
        percent: 0,
        fixed: 0,
        capEnabled: true,
        cap: null,
      }),
    ).toThrow('cap');
    const fixture: ToolModule = {
      ...tool('loan-calculator'),
      defaults: { control: true, number: 1 },
      paramSchema: {
        control: { type: 'boolean' },
        number: { type: 'number', min: 0, showWhen: { field: 'control', equals: true } },
      },
    };
    expect(JSON.stringify(projectToolParamsSchema(fixture).allOf)).toContain(
      '"not":{"required":["control"]}',
    );
  });
  it('exposes actual enum types, array items and factory integer semantics, not arbitrary UI steps', () => {
    expect(properties('number-base-converter').inputBase).not.toHaveProperty('enum');
    expect(
      activeField(projectToolParamsSchema(tool('number-base-converter')), 'inputBase').enum,
    ).toEqual(['auto', 2, 8, 10, 16]);
    expect(properties('loan-calculator').months).toHaveProperty('type', 'integer');
    expect(properties('lorem-ipsum').paragraphs).toMatchObject({ type: 'number', maximum: 1000 });
    expect(properties('lorem-ipsum').sentencesPerParagraph).toMatchObject({
      type: 'number',
      maximum: 100,
    });
    expect(properties('lorem-ipsum').paragraphs).not.toHaveProperty('multipleOf');
    expect(properties('lorem-ipsum').wordsPerSentence).toEqual({ type: 'array', items: {} });
    expect(JSON.stringify(projectToolParamsSchema(tool('date-calculator')))).toContain(
      '"items":{"type":"number"}',
    );
    expect(projectToolParamsSchema(tool('percentage-calculator')).additionalProperties).toBe(true);
    expect(projectToolParamsSchema(tool('slug')).additionalProperties).toBe(true);
    expect(properties('slug').maxLength).not.toHaveProperty('type', 'null');
  });
  it('projects only explicitly nullable bank fields and preserves review/mapping native JSON', () => {
    expect(properties('bank-statement-to-csv').opening).toHaveProperty(
      'anyOf',
      expect.arrayContaining([{ type: 'null' }]),
    );
    expect(properties('bank-statement-to-csv').statementYear).toHaveProperty(
      'anyOf',
      expect.arrayContaining([
        expect.objectContaining({ type: 'integer', minimum: 1900, maximum: 2100 }),
      ]),
    );
    const params = admitToolParams(tool('bank-statement-to-csv'), {
      opening: null,
      statementYear: null,
      pageDecisions: [],
      lineDecisions: [],
    });
    expect(params).toMatchObject({ opening: null, statementYear: null, lineDecisions: [] });
    expect(params.mapping).toMatchObject({ mode: 'signed-amount' });
  });
  it('refuses inherited/accessor/nonobject/unbounded data without invoking getters', () => {
    let reads = 0;
    const value = Object.defineProperty({}, 'APR', {
      enumerable: true,
      get() {
        reads++;
        return 0;
      },
    });
    expect(() => admitToolParams(tool('loan-calculator'), value)).toThrow('data properties');
    expect(reads).toBe(0);
    expect(() => admitToolParams(tool('loan-calculator'), Object.create({ APR: 0 }))).toThrow(
      'plain object',
    );
    expect(() => admitToolParams(tool('loan-calculator'), [])).toThrow('object');
    expect(() =>
      admitToolParams(tool('loan-calculator'), { APR: Number.POSITIVE_INFINITY }),
    ).toThrow('finite');
    expect(() => admitToolParams(tool('loan-calculator'), { APR: 0, extra: true })).toThrow(
      'Unknown parameter',
    );
    expect(() => admitToolParams(tool('lorem-ipsum'), { custom: 'x'.repeat(1048576) })).toThrow(
      '1 MiB',
    );
  });
  it('keeps legacy JSON numbers/default-only arrays and source-backed unknowns', () => {
    expect(
      admitToolParams(tool('lorem-ipsum'), {
        paragraphs: 2.5,
        sentencesPerParagraph: 2.5,
        wordsPerSentence: [1, 1],
        custom: true,
      }),
    ).toMatchObject({ paragraphs: 2.5, wordsPerSentence: [1, 1], custom: true });
    expect(admitToolParams(tool('percentage-calculator'), { custom: '5' }).custom).toBe('5');
    expect(admitToolParams(tool('slug'), {})).not.toHaveProperty('maxLength');
  });
  it('advertises string row contracts and does not double-encode values', () => {
    const groupsJson = '[{"userAgent":"*","rule":"Disallow","path":"/x"}]';
    expect(admitToolParams(tool('robots-txt-generator'), { groupsJson }).groupsJson).toBe(
      groupsJson,
    );
    const parsedGroups: unknown = JSON.parse(groupsJson);
    expect(() =>
      admitToolParams(tool('robots-txt-generator'), { groupsJson: parsedGroups }),
    ).toThrow('Expected text');
    expect(properties('robots-txt-generator').groupsJson).toMatchObject({
      type: 'string',
      maxLength: 100000,
    });
    expect(properties('robots-txt-generator').groupsJson?.description).toContain(
      'userAgent,rule,path',
    );
    expect(properties('nginx-redirect-generator').redirectsJson?.description).toContain(
      '301/302/307/308',
    );
    expect(properties('csp-header-generator').directivesJson?.description).toContain('max 10');
    expect(properties('patreon-earnings-calculator').tiersJson?.description).toContain(
      'failedMembers',
    );
  });
  it('contains exactly the reviewed literal strict IDs and preserves legacy exceptions', () => {
    expect(STRICT_TOOL_IDS.size).toBe(144);
    for (const id of [
      'lorem-ipsum',
      'percentage-calculator',
      'slug',
      'color-converter',
      'cron-from-text',
      'markdown-to-html',
    ])
      expect(STRICT_TOOL_IDS.has(id)).toBe(false);
    for (const id of STRICT_TOOL_IDS) expect(registry.toolsById.has(id), id).toBe(true);
  });
});
