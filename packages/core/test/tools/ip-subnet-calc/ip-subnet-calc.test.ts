import { describe, expect, it } from 'vitest';
import { ipSubnetCalc } from '../../../src/tools/ip-subnet-calc/index.js';
import type {
  IpSubnetCalcParams,
  IpSubnetResult,
} from '../../../src/tools/ip-subnet-calc/types.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

async function run(params: IpSubnetCalcParams): Promise<IpSubnetResult> {
  const [output] = (await ipSubnetCalc.run([], params, makeCtx())) as Blob[];
  expect(output!.type).toBe('application/json');
  return JSON.parse(await output!.text()) as IpSubnetResult;
}

describe('ip-subnet-calc — metadata', () => {
  it('declares params-only developer and inspect metadata', () => {
    expect(ipSubnetCalc.category).toBe('dev');
    expect(ipSubnetCalc.categories).toEqual(['dev', 'inspect']);
    expect(ipSubnetCalc.input).toEqual({ accept: [], min: 0, max: 0 });
    expect(ipSubnetCalc.defaults).toEqual({ cidr: '192.168.1.0/24' });
    expect(ipSubnetCalc.llmDescription).toBeTruthy();
  });
});

describe('ip-subnet-calc — run()', () => {
  it('calculates a /24 and recognizes its network address', async () => {
    expect(await run({ cidr: '192.168.1.0/24' })).toEqual({
      network: '192.168.1.0',
      broadcast: '192.168.1.255',
      firstUsable: '192.168.1.1',
      lastUsable: '192.168.1.254',
      usableCount: 254,
      netmask: '255.255.255.0',
      wildcard: '0.0.0.255',
      prefix: 24,
      inputIsNetworkAddress: true,
    });
  });

  it('calculates a /16 and normalizes a host address to its network', async () => {
    const result = await run({ cidr: '10.20.30.40/16' });
    expect(result).toMatchObject({
      network: '10.20.0.0',
      broadcast: '10.20.255.255',
      firstUsable: '10.20.0.1',
      lastUsable: '10.20.255.254',
      usableCount: 65534,
      netmask: '255.255.0.0',
      wildcard: '0.0.255.255',
      inputIsNetworkAddress: false,
    });
  });

  it('uses both addresses for an RFC 3021 /31', async () => {
    expect(await run({ cidr: '192.0.2.10/31' })).toMatchObject({
      network: '192.0.2.10',
      broadcast: '192.0.2.11',
      firstUsable: '192.0.2.10',
      lastUsable: '192.0.2.11',
      usableCount: 2,
    });
  });

  it('treats a /32 as one host', async () => {
    expect(await run({ cidr: '203.0.113.7/32' })).toMatchObject({
      network: '203.0.113.7',
      broadcast: '203.0.113.7',
      firstUsable: '203.0.113.7',
      lastUsable: '203.0.113.7',
      usableCount: 1,
      inputIsNetworkAddress: true,
    });
  });

  it('normalizes 192.168.1.37/24 to 192.168.1.0', async () => {
    const result = await run({ cidr: '192.168.1.37/24' });
    expect(result.network).toBe('192.168.1.0');
    expect(result.inputIsNetworkAddress).toBe(false);
  });

  it('rejects invalid octets and prefixes', async () => {
    await expect(run({ cidr: '192.168.300.1/24' })).rejects.toThrow('Invalid IPv4 octet');
    await expect(run({ cidr: '192.168.1.1/33' })).rejects.toThrow('Invalid CIDR prefix');
  });
});
