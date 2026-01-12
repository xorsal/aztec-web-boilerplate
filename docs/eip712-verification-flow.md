# EIP-712 Signature Verification Flow

## Overview

This document describes the EIP-712 signature flow between TypeScript (signing) and Noir (verification) for the Aztec EIP-712 account contract.

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TYPESCRIPT (Signing)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. BUILD DOMAIN SEPARATOR                                                  │
│     ┌─────────────────────────────────────────────────────────────────┐    │
│     │ domainSeparator = keccak256(                                    │    │
│     │   TYPE_HASH_DOMAIN ||                                           │    │
│     │   keccak256("Aztec") ||                                         │    │
│     │   keccak256("1") ||                                             │    │
│     │   chainId (31337) ||                                            │    │
│     │   verifyingContract (0x...0001)                                 │    │
│     └─────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  2. BUILD MESSAGE HASH (structHash)                                         │
│     ┌─────────────────────────────────────────────────────────────────┐    │
│     │ For each FunctionCall:                                          │    │
│     │   callHash = keccak256(                                         │    │
│     │     FUNCTION_CALL_TYPE_HASH ||                                  │    │
│     │     contract (target address) ||                                │    │
│     │     keccak256(functionSignature) ||                             │    │
│     │     keccak256(arguments[])                                      │    │
│     │   )                                                             │    │
│     │                                                                 │    │
│     │ appDomainHash = keccak256(                                      │    │
│     │   APP_DOMAIN_TYPE_HASH ||                                       │    │
│     │   keccak256("EVM Aztec Wallet") ||                              │    │
│     │   keccak256("1.0.0") ||                                         │    │
│     │   chainId ||                                                    │    │
│     │   salt                                                          │    │
│     │ )                                                               │    │
│     │                                                                 │    │
│     │ messageHash = keccak256(                                        │    │
│     │   ENTRYPOINT_AUTH_TYPE_HASH ||                                  │    │
│     │   appDomainHash ||                                              │    │
│     │   keccak256(callHash[0] || ... || callHash[4]) ||               │    │
│     │   txNonce                                                       │    │
│     │ )                                                               │    │
│     └─────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  3. COMPUTE FINAL PAYLOAD & SIGN                                            │
│     ┌─────────────────────────────────────────────────────────────────┐    │
│     │ payload = keccak256(0x1901 || domainSeparator || messageHash)   │    │
│     │ signature = eth_signTypedData_v4(payload) → (r, s, v)           │    │
│     └─────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  4. CREATE CAPSULE                                                          │
│     ┌─────────────────────────────────────────────────────────────────┐    │
│     │ capsule = {                                                     │    │
│     │   signature_r, signature_s,                                     │    │
│     │   function_signatures[], args[], target_addresses[],            │    │
│     │   chain_id, salt                                                │    │
│     │ }                                                               │    │
│     └─────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

                              ↓ Capsule injected to PXE ↓

┌─────────────────────────────────────────────────────────────────────────────┐
│                           NOIR (Verification)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. LOAD CAPSULE DATA                                                       │
│     ┌─────────────────────────────────────────────────────────────────┐    │
│     │ witness = load_eip712_witness_5(contract_address)               │    │
│     │ Extract: signature, function_signatures, args, etc.             │    │
│     └─────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  2. RECOMPUTE MESSAGE HASH (must match TypeScript!)                         │
│     ┌─────────────────────────────────────────────────────────────────┐    │
│     │ Same computation as TypeScript:                                 │    │
│     │   - hash_function_call() for each call                          │    │
│     │   - hash_app_domain()                                           │    │
│     │   - hash_entrypoint_authorization_5()                           │    │
│     └─────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  3. USE PRE-COMPUTED DOMAIN SEPARATOR                                       │
│     ┌─────────────────────────────────────────────────────────────────┐    │
│     │ DOMAIN_SEPARATOR = 0x0c4d2d20...e5a141 (constant)               │    │
│     └─────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  4. COMPUTE FINAL PAYLOAD & VERIFY                                          │
│     ┌─────────────────────────────────────────────────────────────────┐    │
│     │ payload = keccak256(0x1901 || DOMAIN_SEPARATOR || messageHash)  │    │
│     │ recovered_pubkey = ecrecover(payload, signature)                │    │
│     │ assert(recovered_pubkey == stored_pubkey)  ← FAILS HERE         │    │
│     └─────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Components That Must Match

| Component | TypeScript Location | Noir Location | Status |
|-----------|---------------------|---------------|--------|
| **Domain Separator** | `eip712-encoder.ts:319-332` | `main.nr:84-89` | ✅ Fixed |
| **Type Hashes** | `eip712-encoder.ts:55-102` | `eip712.nr:22-68` | ❓ Need to verify |
| **App Domain params** | `name="EVM Aztec Wallet"`, `version="1.0.0"` | `main.nr:62-73` | ❓ Need to verify |
| **Function signature format** | `eip712-helpers.ts` | `eip712.nr` | ❓ Need to verify |
| **Arguments encoding** | `uint256[]` as keccak256 | `hash_uint256_array()` | ❓ Need to verify |
| **Salt value** | `DEFAULT_APP_DOMAIN.salt` | Passed in capsule | ❓ Need to verify |

## File Locations

### TypeScript (Signing Side)
- `src/lib/eip712/eip712-encoder.ts` - Type hashes, hash functions
- `src/lib/eip712/eip712-account.ts` - Capsule creation, signing
- `src/lib/eip712/eip712-types.ts` - Type definitions, constants
- `src/accounts/Eip712AuthWitnessProvider.ts` - MetaMask integration
- `src/utils/eip712-helpers.ts` - Function signature building

### Noir (Verification Side)
- `contracts/eip712_account/src/main.nr` - Entrypoint, domain separator
- `contracts/eip712_account/src/eip712.nr` - Hash functions, type hashes, capsule loading

## Verification Checklist

### 1. Type Hashes (Must Be Identical)

**TypeScript (`eip712-encoder.ts`):**
```typescript
FUNCTION_CALL: keccak256("FunctionCall(bytes32 contract,string functionSignature,uint256[] arguments)")
APP_DOMAIN: keccak256("AppDomain(string name,string version,uint256 chainId,bytes32 salt)")
ENTRYPOINT_AUTHORIZATION_5: keccak256("EntrypointAuthorization(AppDomain appDomain,FunctionCall[5] functionCalls,uint256 txNonce)AppDomain(...)FunctionCall(...)")
```

**Noir (`eip712.nr`):**
```noir
FUNCTION_CALL_TYPE_HASH: [u8; 32] = [0xaa, 0xa2, ...]
APP_DOMAIN_TYPE_HASH: [u8; 32] = [0xca, 0x22, ...]
ENTRYPOINT_AUTHORIZATION_5_TYPE_HASH: [u8; 32] = [0x09, 0xa2, ...]
```

### 2. App Domain Parameters

**TypeScript (`eip712-encoder.ts:36-41`):**
```typescript
DEFAULT_APP_DOMAIN = {
  name: 'EVM Aztec Wallet',
  version: '1.0.0',
  chainId: 31337n,
  salt: '0x0000...0001',
}
```

**Noir (`main.nr:62-73`):**
```noir
APP_DOMAIN_NAME_HASH: [u8; 32] = [...] // keccak256("EVM Aztec Wallet")
APP_DOMAIN_VERSION_HASH: [u8; 32] = [...] // keccak256("1.0.0")
```

### 3. Function Signature Format

The function signature string must be formatted identically:
- TypeScript builds: `"drip_to_private((Field),u64)"` (structs expanded)
- Noir receives this in capsule and hashes it

### 4. Arguments Encoding

Both sides must encode arguments the same way:
- Each argument as 32-byte big-endian
- Hash of concatenated bytes (or empty hash for no args)

### 5. Salt Value

The salt must be passed correctly from TypeScript to Noir via capsule.

## Debugging Steps

1. **Compare Type Hashes**: Print hex values from both sides
2. **Compare App Domain Hash**: Compute and compare
3. **Compare Function Call Hash**: For a specific call, compute on both sides
4. **Compare Message Hash**: The full structHash
5. **Compare Final Payload**: The `0x1901 || domain || message` hash

## Related Tests

- `tests/unit/eip712-encoder.test.ts` - Encoder unit tests
- `tests/unit/eip712-account.test.ts` - Account signing tests
- `tests/integration/eip712-sandbox.test.ts` - Full integration tests
