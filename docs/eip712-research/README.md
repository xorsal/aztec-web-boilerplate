# EIP-712 Research Notes

Research documentation for implementing EIP-712 clear signing support in Aztec account contracts.

## Contents

| File | Description |
|------|-------------|
| [01-background-research.md](./01-background-research.md) | Authwit recap, EIP-712 overview, and feasibility analysis |
| [02-authwits-spec.md](./02-authwits-spec.md) | Detailed specification for EIP-712 authwits implementation |
| [03-old-notes.md](./03-old-notes.md) | Deprecated notes and type mapping reference |

## Summary

The goal is to enable MetaMask users to see human-readable function names and arguments when authorizing Aztec transactions, rather than opaque hashes.

### Key Challenges

1. **Entrypoint authorization**: Called functions are unknown at compile time
2. **Proving costs**: Constraining EIP-712 `hashStruct` computation adds overhead
3. **Security vs UX**: Unconstrained argument structs enable phishing attacks

### Proposed Solution

Custom account contract that:
1. Receives function call data via oracle
2. Reconstructs and verifies the EIP-712 payload in Noir
3. Verifies ECDSA signature from MetaMask

## Source

Notion workspace: [Human-readable authwit requests](https://www.notion.so/2d19a4c092c780f991ace5510d7292c1)
