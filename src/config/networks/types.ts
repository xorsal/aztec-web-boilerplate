import type { AztecNetwork } from './constants';

export interface NetworkConfig {
  name: AztecNetwork;
  displayName: string;
  description: string;
  nodeUrl: string;
  deployerAddress: string;
  dripperContractAddress: string;
  dripperDeploymentSalt: string;
  tokenContractAddress: string;
  tokenDeploymentSalt: string;
  secretSantaContractAddress: string;
  secretSantaDeploymentSalt: string;
  proverEnabled: boolean;
  isTestnet: boolean;
}
