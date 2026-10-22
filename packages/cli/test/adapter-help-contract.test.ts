import { expect, it } from 'vitest';
import { createDefaultRegistry, type ToolModule } from '@wyreup/core';
import { mergeToolParams, toolParamHelp } from '../src/lib/tool-params.js';
import { admitToolParams, projectToolParamsSchema } from '../../mcp/src/param-schema.js';

const registry = createDefaultRegistry();
function tool(id: string): ToolModule {
  const result = registry.toolsById.get(id);
  if (!result) throw new Error(`Actual public tool missing: ${id}`);
  return result;
}
function description(module: ToolModule, key: string, activeContext?: Record<string, unknown>) {
  const schema = projectToolParamsSchema(module);
  const properties = schema.properties as Record<string, { description: string }>;
  if (activeContext) {
    const branches = schema.allOf as {
      if: { properties: Record<string, { enum: unknown[] }>; required: string[] };
      then: { properties: Record<string, { description: string }> };
    }[];
    const matching = branches.filter((branch) => Object.hasOwn(branch.then.properties, key));
    expect(matching).toHaveLength(1);
    const branch = matching[0]!;
    expect(branch.if.required.every((field) => Object.hasOwn(activeContext, field))).toBe(true);
    expect(
      Object.entries(branch.if.properties).every(([field, condition]) =>
        condition.enum.includes(activeContext[field]),
      ),
    ).toBe(true);
    return branch.then.properties[key]!.description;
  }
  const property = properties[key];
  if (!property) throw new Error(`Actual projected parameter missing: ${key}`);
  return property.description;
}
async function result(module: ToolModule, params: Record<string, unknown>): Promise<unknown> {
  const output = await module.run([], params, {
    signal: new AbortController().signal,
    executionId: 'documented-finance-example',
    cache: new Map(),
    onProgress() {},
  });
  const blobs = Array.isArray(output) ? output : [output];
  expect(blobs).toHaveLength(1);
  const blob = blobs[0];
  if (!blob) throw new Error('Actual finance output missing.');
  expect(blob.type).toBe('application/json');
  return JSON.parse(await blob.text()) as unknown;
}

it('documents the final fee band using the real omitted-bound format', () => {
  const module = tool('amazon-fba-profit-calculator');
  for (const help of [
    toolParamHelp(module, 'feeBandsJson'),
    description(module, 'feeBandsJson', { feeScheduleEnabled: true }),
  ]) {
    expect(help).toContain('final band omits upperBound');
    expect(help).not.toContain('final upperBound null');
  }
});
it('documents major currency units and their precision on both interfaces', () => {
  const module = tool('patreon-earnings-calculator');
  for (const help of [toolParamHelp(module, 'tiersJson'), description(module, 'tiersJson')]) {
    expect(help).toContain('major currency units');
    expect(help).toContain('currencyDecimals');
    expect(help).not.toContain('minor units');
  }
});
it('runs the documented two-band example through JSON, shorthand and MCP admission', async () => {
  const module = tool('amazon-fba-profit-calculator');
  const rows = JSON.stringify([{ upperBound: 100, percent: 10 }, { percent: 5 }]);
  const provided = {
    unitPrice: 200,
    feeScheduleEnabled: true,
    feeBandsJson: rows,
    fulfillmentFee: 0,
  };
  const variants = [
    mergeToolParams(module, provided, [], {}),
    mergeToolParams(
      module,
      {},
      ['unitPrice=200', 'feeScheduleEnabled=true', `feeBandsJson=${rows}`, 'fulfillmentFee=0'],
      {},
    ),
    admitToolParams(module, provided),
  ];
  for (const params of variants)
    expect(await result(module, params)).toMatchObject({ totalFees: 15, profit: 185 });
});
it('treats a five-unit monthly membership as five units rather than five minor units', async () => {
  const module = tool('patreon-earnings-calculator');
  const rows = JSON.stringify([{ name: 'Small', members: 1, monthlyPrice: 5 }]);
  const provided = { tiersJson: rows, platformRate: 0, paymentRate: 0, paymentFixed: 0 };
  for (const params of [
    mergeToolParams(module, provided, [], {}),
    admitToolParams(module, provided),
  ]) {
    expect(await result(module, params)).toMatchObject({
      merchandise: 5,
      revenue: 5,
      totalFees: 0,
      payout: 5,
      tiers: [
        {
          name: 'Small',
          successfulMembers: 1,
          failedMembers: 0,
          revenue: 5,
          collectedTax: 0,
          processingFees: 0,
        },
      ],
    });
  }
});
