# EIP-712 Clear Signing Implementation Spec (v2)

**Purpose**: Document the current v2 implementation for consolidation into v3

## Overview

The EIP-712 clear signing implementation enables MetaMask users to see human-readable function names and arguments when authorizing Aztec transactions, instead of opaque hashes.

### Core Concept

```
User Action → TypeScript builds EIP-712 typed data → MetaMask signTypedData
    ↓
Signature + witness data stored in capsule (slot 0x1234567890abcdef)
    ↓
Noir contract loads capsule, reconstructs EIP-712 hash, verifies ECDSA signature
```

---

## Architecture

### Components

| Component | File | Purpose |
|-----------|------|---------|
| **UI Demo** | `src/components/ClearSigningDemo.tsx` | Full integration demo with 4-step flow |
| **Account Contract (TS)** | `src/accounts/Eip712AccountContract.ts` | AccountContract implementation for EIP-712 accounts |
| **Auth Provider** | `src/accounts/Eip712AuthWitnessProvider.ts` | Creates EIP-712 typed data and capsule fields |
| **EIP-712 Library** | `src/lib/eip712-clear-signing.ts` | Type definitions, hash computations, typed data builders |
| **Noir Contract** | `contracts/eip712_account/src/main.nr` | Account contract with EIP-712 verification |
| **Noir EIP-712** | `contracts/eip712_account/src/eip712.nr` | Hash functions, witness structures, capsule loading |

---

## Data Flow

### 1. ClearSigningDemo.tsx Flow

```
Step 1: Connect MetaMask
├── Request eth_accounts
├── Create viem WalletClient
├── Sign "Derive Aztec public key" message
├── Recover public key (x, y coordinates)
└── Derive secret key from signature hash

Step 2: Connect PXE
├── Connect to SharedPXEService (localhost:8080)
└── Get wallet from PXE instance

Step 3: Deploy Account
├── Create Eip712AccountContract(publicKeyX, publicKeyY, walletClient, ethAddress, chainId)
├── Create AccountManager with deterministic salt (keccak256(ethAddress))
├── Register contract class and instance with PXE
├── Add account to wallet
├── Check if already deployed, if not deploy with Sponsored FPC
└── Store accountAddress

Step 4: Sign and Send Transaction
├── Build transfer call (Token.transfer_public_to_public)
├── Create Eip712AuthWitnessProvider
├── Call provider.createAuthWitForEntrypoint() → EIP-712 signature + capsule fields
├── Create Capsule(accountAddress, EIP712_WITNESS_SLOT, capsuleData)
├── Get sponsored fee payment method
└── Send transaction with capsule
```

### 2. Eip712AuthWitnessProvider

**Key Methods:**

```typescript
// Standard AuthWitnessProvider interface (for deployment fallback)
createAuthWit(messageHash: Fr): Promise<AuthWitness>

// Clear signing for entrypoint (main feature)
createAuthWitForEntrypoint(input: EntrypointInput): Promise<AuthWitResult>

// Clear signing for individual authwits (assert_current_call_valid_authwit)
createAuthWitWithClearSigning(messageHash: Fr, preImage: AuthwitPreImageData): Promise<{authWitness, capsuleData}>
```

**EntrypointInput Structure:**

```typescript
interface EntrypointInput {
  targetAddress: Hex;           // Contract being called
  targetAddressBigInt?: bigint; // For consistent capsule serialization
  functionSignature: string;    // e.g., "transfer_public_to_public(Field,Field,u128,Field)"
  functionSelector: number;     // Aztec's FunctionSelector
  args: bigint[];               // Function arguments
  txNonce: bigint;              // Replay protection
}
```

### 3. Capsule Serialization (35 Fields)

```
Field Index | Content
------------|------------------------------------------
0-2         | Signature (packed: r[0..31], r[31]+s[0..30], s[30..32])
3-7         | Function signature (128 bytes = 4×31 + 4 bytes)
8           | Signature length
9-28        | Function args (20 fields, padded with zeros)
29          | Args length
30          | Target address
31          | Function selector
32          | Chain ID
33          | Transaction nonce
34          | Salt (first 31 bytes packed)
```

---

## EIP-712 Structures

### Domain

```typescript
domain: {
  name: 'Aztec',
  version: '1',
  chainId: number,
}
```

### EntrypointAuthorization (for entrypoint)

```typescript
EntrypointAuthorization {
  appDomain: AppDomain {
    name: 'EVM Aztec Wallet',
    version: '1.0.0',
    chainId: uint256,
    salt: bytes32,
  },
  functionCall: FunctionCall {
    contract: bytes32,           // Target contract address (padded)
    functionSignature: string,   // Human-readable signature
    arguments: uint256[],        // Arguments (NOT hashed!)
  },
  txNonce: uint256,
}
```

### FunctionCallAuthorization (for authwits)

```typescript
FunctionCallAuthorization {
  appDomain: AuthwitAppDomain {
    chainId: uint256,
    verifyingContract: bytes32,  // Contract requesting the authwit
  },
  functionCall: FunctionCall {
    contract: bytes32,
    functionSignature: string,
    arguments: uint256[],
  },
}
```

---

## Noir Contract

### Storage

```noir
struct Storage<Context> {
    signing_public_key: SinglePrivateImmutable<EcdsaPublicKeyNote, Context>,
}
```

### Entrypoint (Dual-Mode)

The entrypoint supports two verification modes:

1. **EIP-712 Mode** (capsule present): Human-readable MetaMask signing
2. **Fallback Mode** (no capsule): Standard ECDSA for deployment

```noir
fn entrypoint(app_payload: AppPayload, fee_payment_method: u8, cancellable: bool) {
    let maybe_witness = load_eip712_witness(self.address);

    if maybe_witness.is_none() {
        // Fallback: Standard ECDSA verification
        AccountActions::init(self.context, is_valid_impl).entrypoint(...);
    } else {
        // EIP-712 clear signing mode
        let witness = maybe_witness.unwrap();

        // 1. Verify witness data matches AppPayload
        //    - Find call matching witness.target_address
        //    - Verify args_hash matches (compute_aztec_calldata_hash or compute_aztec_args_hash)
        //    - Verify function_selector matches

        // 2. Compute EIP-712 hashes
        //    - hash_function_call(target, signature, args)
        //    - hash_app_domain(name_hash, version_hash, chain_id, salt)
        //    - hash_entrypoint_authorization(app_domain_hash, function_call_hash, tx_nonce)
        //    - compute_domain_separator(chain_id)
        //    - compute_eip712_payload(domain_separator, message_hash)

        // 3. Verify ECDSA signature
        std::ecdsa_secp256k1::verify_signature(pub_key_x, pub_key_y, signature, eip712_payload);

        // 4. Execute calls
        app_payload.execute_calls(self.context);
    }
}
```

### Authwit Verification (verify_private_authwit)

For individual function call authorization (e.g., Token.transfer_from):

```noir
fn verify_private_authwit(inner_hash: Field) -> Field {
    let witness = load_eip712_authwit_witness(self.address);

    // 1. Verify witness.inner_hash matches parameter
    assert(witness.inner_hash == inner_hash);

    // 2. Reconstruct inner_hash from pre-image
    let computed_args_hash = compute_aztec_args_hash(witness.function_args, witness.args_length);
    let computed_selector = compute_function_selector(witness.function_signature, witness.signature_length);
    let reconstructed = compute_inner_hash(witness.target_address, computed_selector, computed_args_hash);
    assert(reconstructed == inner_hash);

    // 3. Compute EIP-712 FunctionCallAuthorization hash
    let function_call_hash = hash_function_call(...);
    let authwit_domain_hash = hash_authwit_app_domain(chain_id, verifying_contract);
    let message_hash = hash_function_call_authorization(authwit_domain_hash, function_call_hash);
    let eip712_payload = compute_eip712_payload(domain_separator, message_hash);

    // 4. Verify signature
    assert(std::ecdsa_secp256k1::verify_signature(...));

    // Return IS_VALID_SELECTOR
    0x47dacd73
}
```

### is_valid_impl (Dual-Mode)

Supports clear signing with capsule or fallback with opaque hash:

```noir
fn is_valid_impl(context: &mut PrivateContext, outer_hash: Field) -> bool {
    let maybe_witness = load_is_valid_authwit_witness(context.this_address());

    if maybe_witness.is_some() {
        // Clear signing mode: verify EIP-712 FunctionCallAuthorization
        // Similar to verify_private_authwit
    } else {
        // Fallback: Sign opaque hash with AztecAuthorization(bytes32 messageHash)
        let witness: [Field; 64] = get_auth_witness(outer_hash);
        // Compute EIP-712 hash and verify
    }
}
```

---

## Capsule Slots

| Slot | Value | Purpose |
|------|-------|---------|
| `EIP712_WITNESS_SLOT` | `0x1234567890abcdef` | Entrypoint witness |
| `EIP712_AUTHWIT_SLOT` | `0xabcdef1234567890` | verify_private_authwit witness |
| `EIP712_IS_VALID_AUTHWIT_SLOT` | `0xfedcba0987654321` | is_valid_impl authwit witness |

---

## Pre-computed Type Hashes

All type hashes are pre-computed and hardcoded in Noir for efficiency:

```noir
// keccak256("FunctionCall(bytes32 contract,string functionSignature,uint256[] arguments)")
FUNCTION_CALL_TYPE_HASH

// keccak256("AppDomain(string name,string version,uint256 chainId,bytes32 salt)")
APP_DOMAIN_TYPE_HASH

// keccak256("EntrypointAuthorization(AppDomain appDomain,FunctionCall functionCall,uint256 txNonce)...")
ENTRYPOINT_AUTHORIZATION_TYPE_HASH

// keccak256("AuthwitAppDomain(uint256 chainId,bytes32 verifyingContract)")
AUTHWIT_APP_DOMAIN_TYPE_HASH

// keccak256("FunctionCallAuthorization(AuthwitAppDomain appDomain,FunctionCall functionCall)...")
FUNCTION_CALL_AUTHORIZATION_TYPE_HASH

// keccak256("EIP712Domain(string name,string version,uint256 chainId)")
EIP712_DOMAIN_TYPE_HASH

// keccak256("Aztec")
EIP712_DOMAIN_NAME_HASH

// keccak256("1")
EIP712_DOMAIN_VERSION_HASH
```

---

## Aztec Hash Compatibility

The implementation must match Aztec's hash computations:

### Private Functions

```noir
args_hash = poseidon2_hash_with_separator([args...], GENERATOR_INDEX__FUNCTION_ARGS)
```

### Public Functions

```noir
args_hash = poseidon2_hash_with_separator([selector, args...], GENERATOR_INDEX__PUBLIC_CALLDATA)
```

### Inner Hash (for authwits)

```noir
inner_hash = poseidon2_hash_with_separator(
    [caller, selector, args_hash],
    GENERATOR_INDEX__AUTHWIT_INNER
)
```

---

## Known Issues / TODOs

1. **Multiple calls**: Current implementation only handles single function calls in entrypoint
2. **Fee payment detection**: Need to properly handle fee payment calls (FPC) vs user calls
3. **Gas optimization**: Consider reducing keccak256 calls in Noir
4. **Error messages**: Improve assertion messages for debugging
5. **Authwit capsule**: `createAuthWitWithClearSigning` needs integration testing

---

## Testing

### Unit Tests (Vitest)

- `tests/unit/eip712-signing.test.ts` - TypeScript hash computations
- `tests/unit/eip712-capsule.test.ts` - Capsule serialization

### Integration Tests

- `tests/integration/eip712-capsule.test.ts` - Full flow with sandbox

### Noir Tests

- `contracts/eip712_account/src/eip712.nr` - Hash function tests, serialization tests

### E2E Tests (Playwright)

- `tests/e2e/clear-signing.spec.ts` - Full UI flow with MetaMask

---

## Dependencies

### TypeScript

```json
{
  "@aztec/aztec.js": "3.0.0-devnet.20251212",
  "viem": "^2.x"
}
```

### Noir

```toml
aztec = { tag = "v3.0.0-nightly.20251212" }
keccak256 = { ... }
```
