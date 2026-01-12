/**
 * Register raw contract artifacts for EIP-712 clear signing.
 *
 * The `loadContractArtifact` function from @aztec/aztec.js filters out some functions
 * (like unconstrained public functions) from the processed artifact. However, we need
 * access to all function signatures for EIP-712 clear signing.
 *
 * This module imports the raw JSON artifacts and registers them with the EIP-712 helper
 * system so that function signatures can be resolved for all functions.
 */

import { registerRawArtifact } from './eip712-helpers';

// Import raw JSON artifacts
import DripperJson from '../target/dripper-Dripper.json';
import TokenJson from '../target/token_contract-Token.json';

/**
 * Initialize artifact registration for EIP-712 clear signing.
 * Call this once at application startup.
 */
export function initializeArtifactRegistry(): void {
  console.log('[registerArtifacts] Registering raw artifacts for EIP-712 clear signing...');

  // Register each contract artifact
  registerRawArtifact('Dripper', DripperJson);
  registerRawArtifact('Token', TokenJson);

  console.log('[registerArtifacts] Artifacts registered:', {
    dripper: DripperJson.functions?.map((f: any) => f.name),
    token: TokenJson.functions?.length + ' functions',
  });
}
