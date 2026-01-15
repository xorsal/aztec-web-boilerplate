export * from './types';
export * from './constants';
export * from './sandbox';
export * from './devnet';

import { DEVNET_CONFIG } from './devnet';
import { SANDBOX_CONFIG } from './sandbox';
import { NetworkConfig } from './types';

export const AVAILABLE_NETWORKS: NetworkConfig[] = [
  SANDBOX_CONFIG,
  DEVNET_CONFIG,
];

export const DEFAULT_NETWORK = SANDBOX_CONFIG;

export function getNetworkConfig(name: 'sandbox' | 'devnet'): NetworkConfig {
  switch (name) {
    case 'sandbox':
      return SANDBOX_CONFIG;
    case 'devnet':
      return DEVNET_CONFIG;
    default:
      return SANDBOX_CONFIG;
  }
}
