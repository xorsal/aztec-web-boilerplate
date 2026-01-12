# Aztec SDK Bugs Found During Public Function Implementation

## Overview

These bugs were discovered while implementing `balance_of_public` and `drip_to_public` calls with EIP-712 signing.

## Bug 1: Function Artifact Lookup Only Searches `artifact.functions`

**Affected Files:**
1. `@aztec/pxe/dest/storage/contract_data_provider/contract_data_provider.js` - `#findFunctionArtifactBySelector`
2. `@aztec/pxe/dest/contract_function_simulator/proxied_contract_data_source.js` - `getFunctionArtifact` proxy
3. `@aztec/pxe/dest/error_enriching.js` - `enrichSimulationError`

**Root Cause:**
When `loadContractArtifact()` processes a contract JSON, it places unconstrained public functions in `artifact.nonDispatchPublicFunctions` instead of `artifact.functions`. However, several SDK methods only search `artifact.functions`, causing "Function artifact not found" errors.

**Symptom:**
```
Could not find function artifact in contract Token for function '0xff7949f2' when enriching error callstack
```

**Fix:**
Search both arrays: `[...artifact.functions, ...(artifact.nonDispatchPublicFunctions ?? [])]`

**Patch Applied:** Yes, see `patches/@aztec+pxe+3.0.0-devnet.20251212.patch`

## Bug 2: Public Functions Marked as `is_public: false` in Entrypoint

**Affected File:** Custom code in `Eip712AccountEntrypoint.ts`

**Root Cause:**
The `EncodedAppEntrypointCalls.create()` method hardcodes `is_public: false` for all calls.

**Fix Applied:**
Now checks `call.type === FunctionType.PUBLIC` to correctly set `is_public`.

**Status:** RESOLVED

## Bug 3: `Cannot read properties of undefined (reading 'length')`

**Status:** RESOLVED - was caused by SDK lookup issues (Bug 1)

## EIP-712 Support for Public Functions

**Background:**
Initially, EIP-712 clear signing appeared incompatible with public functions due to hash separator differences:
- Public function calldata uses `computeCalldataHash` with `PUBLIC_CALLDATA` separator (43)
- Private function args uses `computeVarArgsHash` with `FUNCTION_ARGS` separator (44)

**Solution Implemented:**
The Noir contract now dynamically selects the correct hash separator based on the `is_public` flag from the AppPayload:

```noir
// In eip712.nr
pub fn compute_aztec_args_hash(args: [Field; MAX_SERIALIZED_ARGS], len: u32, is_public: bool) -> Field {
    let generator_index = if is_public {
        GENERATOR_INDEX__PUBLIC_CALLDATA  // 43
    } else {
        GENERATOR_INDEX__FUNCTION_ARGS    // 44
    };
    // ... hash computation with selected separator
}
```

**Key Changes:**
1. Added `extract_is_public()` function to extract `is_public` flag from serialized AppPayload
2. Modified `compute_aztec_args_hash()` to accept `is_public` parameter
3. Updated `entrypoint5` verification to pass `is_public` from AppPayload

**Result:**
EIP-712 clear signing now works for **both private and public functions**.

## Workarounds Applied

1. **Skip simulation for unconstrained public functions:** Since `loadContractArtifact` filters out bytecode for unconstrained functions, simulation fails. We skip simulation for these functions.

2. **Direct node_modules patches:** Applied patches to `contract_data_provider.js`, `proxied_contract_data_source.js`, and `error_enriching.js` to search both `functions` and `nonDispatchPublicFunctions` arrays.

3. **Raw artifact cache:** Registered raw JSON artifacts before processing to retain `is_unconstrained` flags for function type checking.
