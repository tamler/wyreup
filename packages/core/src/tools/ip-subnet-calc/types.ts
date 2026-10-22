export interface IpSubnetCalcParams {
  cidr?: string;
  splitEnabled?: boolean;
  splitPrefix?: number;
}

export interface IpSubnetResult {
  network: string;
  broadcast: string;
  firstUsable: string;
  lastUsable: string;
  usableCount: number;
  netmask: string;
  wildcard: string;
  prefix: number;
  inputIsNetworkAddress: boolean;
}

export const defaultIpSubnetCalcParams: IpSubnetCalcParams = {
  cidr: '192.168.1.0/24',
  splitEnabled: false,
  splitPrefix: 26,
};

export interface IpSubnetSplitResult {
  source: IpSubnetResult;
  splitPrefix: number;
  subnetCount: number;
  subnets: IpSubnetResult[];
}
