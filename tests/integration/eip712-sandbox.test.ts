/**
 * Integration Test: EIP-712 Account against Aztec Sandbox
 *
 * Tests the complete EIP-712 clear signing flow:
 * 1. Deploy EIP-712 account contract
 * 2. Deploy token contract
 * 3. Mint tokens to private balance
 * 4. Verify balance increased
 *
 * This test requires the Aztec sandbox to be running on localhost:8080
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createAztecNodeClient, type AztecNode } from '@aztec/aztec.js/node';
import { createPXE } from '@aztec/pxe/server';
import { getPXEConfig } from '@aztec/pxe/config';
import type { PXE } from '@aztec/pxe/server';
import { Fr } from '@aztec/aztec.js/fields';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { AccountManager, type Wallet } from '@aztec/aztec.js/wallet';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { getContractInstanceFromInstantiationParams } from '@aztec/aztec.js/contracts';
import { AuthWitness } from '@aztec/stdlib/auth-witness';
import { SPONSORED_FPC_SALT } from '@aztec/constants';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import type { Hex } from 'viem';

import { MinimalWallet } from '../../src/utils/MinimalWallet';
import { Eip712AccountContract } from '../../src/accounts/Eip712AccountContract';
import {
  Eip712Account,
  createEip712Account,
  type FunctionCallInput,
} from '../../src/lib/eip712';
import { Eip712AccountContractArtifact } from '../../src/artifacts/Eip712Account';
import { TokenContract } from '../../src/artifacts/Token';

// Test configuration
const PXE_URL = process.env.PXE_URL || 'http://localhost:8080';
const TEST_TIMEOUT = 600_000; // 10 minutes for sandbox operations

// Use Anvil's first account private key for deterministic testing
const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;

describe('EIP-712 Sandbox Integration', () => {
  let aztecNode: AztecNode;
  let pxe: PXE;
  let minimalWallet: MinimalWallet;
  let eip712Signer: Eip712Account;
  let wallet: Wallet;
  let tokenAddress: AztecAddress;
  let sponsoredFeePaymentMethod: SponsoredFeePaymentMethod;

  beforeAll(async () => {
    // Connect to Aztec Node
    aztecNode = createAztecNodeClient(PXE_URL);
    const nodeInfo = await aztecNode.getNodeInfo();
    console.log('Connected to sandbox, chain ID:', nodeInfo.l1ChainId);

    // Create local PXE connected to node
    const l1Contracts = await aztecNode.getL1ContractAddresses();
    const pxeConfig = getPXEConfig();
    pxeConfig.l1Contracts = l1Contracts;
    pxeConfig.proverEnabled = false;

    pxe = await createPXE(aztecNode, pxeConfig, {
      useLogSuffix: 'test',
    });
    console.log('PXE initialized');

    // Create minimal wallet for bootstrapping account creation
    minimalWallet = new MinimalWallet(pxe, aztecNode);

    // Register SponsoredFPC contract for fee payment
    const sponsoredFPCInstance = await getContractInstanceFromInstantiationParams(
      SponsoredFPCContractArtifact,
      { salt: new Fr(SPONSORED_FPC_SALT) }
    );
    await pxe.registerContract({
      instance: sponsoredFPCInstance,
      artifact: SponsoredFPCContractArtifact,
    });
    sponsoredFeePaymentMethod = new SponsoredFeePaymentMethod(
      sponsoredFPCInstance.address
    );
    console.log('SponsoredFPC registered at:', sponsoredFPCInstance.address.toString());

    // Create EIP-712 signing account
    eip712Signer = createEip712Account(
      TEST_PRIVATE_KEY,
      BigInt(nodeInfo.l1ChainId)
    );
    console.log('EIP-712 Signer ETH Address:', eip712Signer.getEthAddress());
  }, TEST_TIMEOUT);

  it('should connect to sandbox', async () => {
    const nodeInfo = await aztecNode.getNodeInfo();
    expect(nodeInfo).toBeDefined();
    expect(nodeInfo.l1ChainId).toBeGreaterThan(0);
    console.log('Sandbox node info:', {
      chainId: nodeInfo.l1ChainId,
      protocolVersion: nodeInfo.protocolVersion,
    });
  });

  it('should generate valid EIP-712 account keys', () => {
    const pubKey = eip712Signer.getPublicKey();
    expect(pubKey.x).toHaveLength(32);
    expect(pubKey.y).toHaveLength(32);

    const ethAddress = eip712Signer.getEthAddress();
    expect(ethAddress).toMatch(/^0x[0-9a-f]{40}$/i);
    console.log('Public key X:', Buffer.from(pubKey.x).toString('hex').slice(0, 16) + '...');
    console.log('Public key Y:', Buffer.from(pubKey.y).toString('hex').slice(0, 16) + '...');
  });

  it('should sign entrypoint authorization with human-readable data', async () => {
    const calls: FunctionCallInput[] = [
      {
        targetAddress: 123n,
        functionSignature: 'transfer_private(Field,Field,u128,Field)',
        args: [1n, 2n, 1000n, 0n],
      },
    ];

    const oracleData = await eip712Signer.signEntrypoint5(calls, 1n);

    // Verify signature structure
    expect(oracleData.ecdsaSignature).toHaveLength(64);
    expect(oracleData.functionSignatures).toHaveLength(5);
    expect(oracleData.targetAddresses[0]).toBe(123n);
    expect(oracleData.argsLengths[0]).toBe(4);

    // Log the clear-signing data
    console.log('\n=== EIP-712 Clear Signing Data ===');
    console.log('Function:', calls[0].functionSignature);
    console.log('Arguments:', calls[0].args.map(String));
    console.log('Target:', calls[0].targetAddress.toString());
    console.log('Signature (r||s):', Buffer.from(oracleData.ecdsaSignature).toString('hex').slice(0, 32) + '...');
  });

  it('should sign authwit with human-readable function call', async () => {
    const call: FunctionCallInput = {
      targetAddress: 456n,
      functionSignature: 'transfer_from(Field,Field,u128,Field)',
      args: [1n, 2n, 500n, 0n],
    };

    const oracleData = await eip712Signer.signAuthwit(
      call,
      '0x0000000000000000000000000000000000000001'
    );

    expect(oracleData.ecdsaSignature).toHaveLength(64);
    expect(oracleData.targetAddress).toBe(456n);

    console.log('\n=== EIP-712 Authwit Data ===');
    console.log('Function:', call.functionSignature);
    console.log('Arguments:', call.args.map(String));
    console.log('Signature:', Buffer.from(oracleData.ecdsaSignature).toString('hex').slice(0, 32) + '...');
  });

  it('should create capsule with correct field count', async () => {
    const calls: FunctionCallInput[] = [
      {
        targetAddress: 789n,
        functionSignature: 'mint_to_private(Field,u128)',
        args: [1n, 10000n],
      },
    ];

    const contractAddress = AztecAddress.fromBigInt(999n);
    const capsule = await eip712Signer.createWitnessCapsule5(
      calls,
      0n,
      contractAddress
    );

    // Verify capsule has 150 fields (EIP712_WITNESS_5_SERIALIZED_LEN - was 145, +5 for selectors)
    expect(capsule.data).toHaveLength(150);
    console.log('Capsule created with', capsule.data.length, 'fields');
  });

  it(
    'should deploy EIP-712 account and mint tokens',
    async () => {
      console.log('\n=== Deploying EIP-712 Account ===');

      const pubKeyArrays = eip712Signer.getPublicKeyArrays();

      // Create auth witness provider that uses the EIP-712 signer
      // For deployment, we use personal_sign fallback
      const authWitProvider = {
        createAuthWit: async (messageHash: Fr): Promise<AuthWitness> => {
          // Sign the message hash with personal_sign style
          // This is the fallback mode for initial deployment
          const msgBytes = messageHash.toBuffer();

          // Import viem account for signing
          const { privateKeyToAccount } = await import('viem/accounts');
          const account = privateKeyToAccount(TEST_PRIVATE_KEY);

          // Sign with personal_sign (Ethereum message signing)
          const signature = await account.signMessage({
            message: { raw: msgBytes },
          });

          // Parse signature (remove v, keep r || s as bytes)
          const sigHex = signature.slice(2);
          const r = Buffer.from(sigHex.slice(0, 64), 'hex');
          const s = Buffer.from(sigHex.slice(64, 128), 'hex');

          // Convert to field array (one field per byte)
          const witnessFields: Fr[] = [];
          for (let i = 0; i < 32; i++) {
            witnessFields.push(new Fr(r[i]));
          }
          for (let i = 0; i < 32; i++) {
            witnessFields.push(new Fr(s[i]));
          }

          return new AuthWitness(messageHash, witnessFields);
        },
      };

      // Create account contract
      const accountContract = new Eip712AccountContract(
        Buffer.from(pubKeyArrays.x),
        Buffer.from(pubKeyArrays.y),
        authWitProvider
      );

      // Create account manager using MinimalWallet
      const secretKey = Fr.random();
      const accountManager = await AccountManager.create(
        minimalWallet,
        secretKey,
        accountContract
      );

      // Get the address before deployment
      const accountAddress = await accountManager.getCompleteAddress();
      console.log('Account address:', accountAddress.address.toString());

      // Get account and register with wallet
      const account = await accountManager.getAccount();
      minimalWallet.addAccount(account);

      // Register contract with wallet (includes account registration via secretKey)
      const instance = accountManager.getInstance();
      const artifact = await accountManager.getAccountContract().getContractArtifact();
      await minimalWallet.registerContract(instance, artifact, secretKey);
      console.log('Account registered with PXE');

      // Deploy the account
      console.log('Deploying account contract...');
      const deployMethod = await accountManager.getDeployMethod();
      const deployTx = await deployMethod
        .send({
          from: AztecAddress.ZERO,
          fee: { paymentMethod: sponsoredFeePaymentMethod },
          skipClassPublication: true,
          skipInstancePublication: true,
        })
        .wait({ timeout: 120 });
      console.log('Account deployed! Tx hash:', deployTx.txHash.toString());

      // Use minimalWallet for token operations (has full Wallet interface)
      wallet = minimalWallet;

      // Deploy Token contract using constructor_with_minter
      console.log('\n=== Deploying Token Contract ===');
      const tokenDeploy = await TokenContract.deployWithOpts(
        {
          wallet: minimalWallet,
          method: 'constructor_with_minter',
        },
        'TestToken',             // name
        'TST',                   // symbol
        18n,                     // decimals
        accountManager.address,  // minter
        accountManager.address   // upgrade_authority
      )
        .send({
          from: accountManager.address,
          fee: { paymentMethod: sponsoredFeePaymentMethod },
        })
        .wait();

      tokenAddress = tokenDeploy.contract.address;
      console.log('Token deployed at:', tokenAddress.toString());

      // Check initial balance (should be 0)
      const tokenContract = await TokenContract.at(tokenAddress, minimalWallet);
      const initialBalance = await tokenContract.methods
        .balance_of_private(accountManager.address)
        .simulate({ from: accountManager.address });
      console.log('Initial private balance:', initialBalance.toString());
      expect(initialBalance).toBe(0n);

      // Mint tokens to private balance
      console.log('\n=== Minting Tokens ===');
      const mintAmount = 1000n;
      await tokenContract.methods
        .mint_to_private(accountManager.address, mintAmount)
        .send({
          from: accountManager.address,
          fee: { paymentMethod: sponsoredFeePaymentMethod },
        })
        .wait();
      console.log('Minted', mintAmount.toString(), 'tokens');

      // Check final balance
      const finalBalance = await tokenContract.methods
        .balance_of_private(accountManager.address)
        .simulate({ from: accountManager.address });
      console.log('Final private balance:', finalBalance.toString());

      // THE ULTIMATE VERIFICATION: Balance increased!
      expect(finalBalance).toBe(mintAmount);
      console.log('\n=== SUCCESS: Private balance increased! ===');
    },
    TEST_TIMEOUT
  );
});
