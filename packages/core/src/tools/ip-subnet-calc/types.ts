export interface IpSubnetCalcParams {
  cidr?: string;
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
};
