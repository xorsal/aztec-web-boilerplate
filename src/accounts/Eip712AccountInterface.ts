/**
 * EIP-712 Account Interface
 *
 * Custom AccountInterface implementation that uses Eip712AccountEntrypoint.
 * This enables EIP-712 typed data signing with capsule-based signature delivery.
 */

import type { AccountInterface, AuthWitnessProvider, ChainInfo } from '@aztec/aztec.js/account';
import type { CompleteAddress, AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/aztec.js/fields';
import type { AuthWitness } from '@aztec/stdlib/auth-witness';
import type { GasSettings } from '@aztec/stdlib/gas';
import type { ExecutionPayload, TxExecutionRequest } from '@aztec/stdlib/tx';
import { Eip712AccountEntrypoint, type Eip712AccountEntrypointOptions } from './Eip712AccountEntrypoint';

/**
 * Account interface implementation for EIP-712 accounts.
 * Uses Eip712AccountEntrypoint which calls `entrypoint5` instead of `entrypoint`.
 */
export class Eip712AccountInterface implements AccountInterface {
  private entrypoint: Eip712AccountEntrypoint;
  private chainId: Fr;
  private version: Fr;

  constructor(
    private authWitnessProvider: AuthWitnessProvider,
    private address: CompleteAddress,
    chainInfo: ChainInfo
  ) {
    this.chainId = chainInfo.chainId;
    this.version = chainInfo.version;
    this.entrypoint = new Eip712AccountEntrypoint(
      address.address,
      authWitnessProvider,
      chainInfo.chainId.toNumber(),
      chainInfo.version.toNumber()
    );
  }

  createTxExecutionRequest(
    exec: ExecutionPayload,
    gasSettings: GasSettings,
    options: Eip712AccountEntrypointOptions
  ): Promise<TxExecutionRequest> {
    return this.entrypoint.createTxExecutionRequest(exec, gasSettings, options);
  }

  createAuthWit(messageHash: Fr): Promise<AuthWitness> {
    return this.authWitnessProvider.createAuthWit(messageHash);
  }

  getCompleteAddress(): CompleteAddress {
    return this.address;
  }

  getAddress(): AztecAddress {
    return this.address.address;
  }

  getChainId(): Fr {
    return this.chainId;
  }

  getVersion(): Fr {
    return this.version;
  }
}
