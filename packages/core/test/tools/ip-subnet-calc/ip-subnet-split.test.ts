import { describe, expect, it } from 'vitest';
import { calculateSubnet, ipSubnetCalc, splitIpv4Subnet } from '../../../src/tools/ip-subnet-calc/index.js';
import type { ToolRunContext } from '../../../src/types.js';

const ctx = (): ToolRunContext => ({ signal: new AbortController().signal, cache: new Map(), onProgress: () => {}, executionId: 'subnet-split' });
describe('bounded subnet splitting', () => {
  it('aligns a host CIDR and emits all four /26 subnets in order', () => {
    const result = splitIpv4Subnet('192.168.1.37/24', 26);
    expect(result.subnetCount).toBe(4);
    expect(result.subnets.map(row => row.network)).toEqual(['192.168.1.0', '192.168.1.64', '192.168.1.128', '192.168.1.192']);
    expect(result.subnets.map(row => row.usableCount)).toEqual([62, 62, 62, 62]);
    expect(result.subnets[3]).toMatchObject({ broadcast: '192.168.1.255', firstUsable: '192.168.1.193', lastUsable: '192.168.1.254' });
  });
  it('handles unsigned /0 and both /31 and /32 endpoint semantics', () => {
    expect(calculateSubnet('255.255.255.255/0')).toMatchObject({ network: '0.0.0.0', broadcast: '255.255.255.255', usableCount: 4294967294 });
    expect(splitIpv4Subnet('255.255.255.253/31', 32).subnets.map(row => [row.network, row.usableCount])).toEqual([['255.255.255.252', 1], ['255.255.255.253', 1]]);
    expect(splitIpv4Subnet('192.0.2.0/30', 31).subnets.map(row => row.usableCount)).toEqual([2, 2]);
    expect(splitIpv4Subnet('1.2.3.4/0', 12).subnets).toHaveLength(4096);
    expect(() => splitIpv4Subnet('0.0.0.0/0', 32)).toThrow('4,096');
  });
  it('rejects wider, fractional and invalid prefixes before expansion', () => {
    for (const prefix of [23, 26.5, 33, Infinity]) expect(() => splitIpv4Subnet('192.0.2.0/24', prefix)).toThrow();
    const controller = new AbortController(); controller.abort();
    expect(() => splitIpv4Subnet('192.0.2.0/24', 26, controller.signal)).toThrow('cancelled');
  });
  it('retains the flat default artifact and strictly validates new parameters', async () => {
    const result = await ipSubnetCalc.run([], {}, ctx()) as Blob[];
    expect(JSON.parse(await result[0]!.text())).toMatchObject({ network: '192.168.1.0', usableCount: 254 });
    expect(JSON.parse(await result[0]!.text())).not.toHaveProperty('source');
    await expect(ipSubnetCalc.run([], { splitEnabled: true, splitPrefix: 26.5 }, ctx())).rejects.toThrow();
    await expect(ipSubnetCalc.run([], { unknown: true } as never, ctx())).rejects.toThrow();
    const split = await ipSubnetCalc.run([], { cidr: '192.0.2.0/24', splitEnabled: true, splitPrefix: 26 }, ctx()) as Blob[];
    expect(JSON.parse(await split[0]!.text())).toMatchObject({ subnetCount: 4 });
  });
});
