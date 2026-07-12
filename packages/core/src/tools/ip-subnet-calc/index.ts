import type { ToolModule, ToolRunContext } from '../../types.js';
import {
  defaultIpSubnetCalcParams,
  type IpSubnetCalcParams,
  type IpSubnetResult,
} from './types.js';

export type { IpSubnetCalcParams, IpSubnetResult } from './types.js';
export { defaultIpSubnetCalcParams } from './types.js';

function ipv4ToNumber(address: string): number {
  const octets = address.split('.');
  if (octets.length !== 4) throw new Error('Invalid IPv4 address: expected four octets.');

  let result = 0;
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) {
      throw new Error(`Invalid IPv4 octet: ${octet || '(empty)'}.`);
    }
    const value = Number(octet);
    if (value < 0 || value > 255) throw new Error(`Invalid IPv4 octet: ${octet}.`);
    result = (result * 256 + value) >>> 0;
  }
  return result;
}

function numberToIpv4(value: number): string {
  const unsigned = value >>> 0;
  return [unsigned >>> 24, (unsigned >>> 16) & 255, (unsigned >>> 8) & 255, unsigned & 255].join(
    '.',
  );
}

function calculateSubnet(cidr: string): IpSubnetResult {
  const match = /^([^/]+)\/(\d+)$/.exec(cidr.trim());
  if (!match) throw new Error('Invalid CIDR: expected an IPv4 address followed by /prefix.');

  const address = ipv4ToNumber(match[1]!);
  const prefix = Number(match[2]);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error('Invalid CIDR prefix: expected a number from 0 to 32.');
  }

  const netmask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const wildcard = ~netmask >>> 0;
  const network = (address & netmask) >>> 0;
  const broadcast = (network | wildcard) >>> 0;
  const isPointToPoint = prefix === 31;
  const isSingleHost = prefix === 32;
  const firstUsable = isPointToPoint || isSingleHost ? network : (network + 1) >>> 0;
  const lastUsable = isPointToPoint || isSingleHost ? broadcast : (broadcast - 1) >>> 0;
  const usableCount = isSingleHost ? 1 : isPointToPoint ? 2 : 2 ** (32 - prefix) - 2;

  return {
    network: numberToIpv4(network),
    broadcast: numberToIpv4(broadcast),
    firstUsable: numberToIpv4(firstUsable),
    lastUsable: numberToIpv4(lastUsable),
    usableCount,
    netmask: numberToIpv4(netmask),
    wildcard: numberToIpv4(wildcard),
    prefix,
    inputIsNetworkAddress: address === network,
  };
}

export const ipSubnetCalc: ToolModule<IpSubnetCalcParams> = {
  id: 'ip-subnet-calc',
  slug: 'ip-subnet-calc',
  name: 'IPv4 Subnet Calculator',
  description:
    'Calculate IPv4 network, broadcast, usable host range, netmask, and wildcard from CIDR notation. /31 follows RFC 3021 with two usable addresses; /32 represents one host.',
  llmDescription:
    'Calculate flat, one-level JSON details for an IPv4 CIDR: network and broadcast addresses, first and last usable addresses, usable host count, dotted netmask and wildcard, prefix, and whether the supplied address is the network address. IPv6 is not supported. /31 uses both addresses and /32 is a single host.',
  category: 'dev',
  categories: ['dev', 'inspect'],
  keywords: [
    'ipv4',
    'cidr',
    'subnet',
    'network',
    'broadcast',
    'netmask',
    'wildcard',
    'rfc 3021',
    'calculator',
  ],

  input: { accept: [], min: 0, max: 0 },
  output: { mime: 'application/json', multiple: false },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultIpSubnetCalcParams,

  paramSchema: {
    cidr: {
      type: 'string',
      label: 'IPv4 CIDR',
      help: 'Enter an IPv4 address and prefix length, such as 192.168.1.37/24.',
      placeholder: '192.168.1.0/24',
    },
  },

  async run(inputs: File[], params: IpSubnetCalcParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 0) throw new Error('ip-subnet-calc does not accept files.');
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 20, message: 'Calculating subnet' });
    const result = calculateSubnet(params.cidr ?? defaultIpSubnetCalcParams.cidr!);
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
