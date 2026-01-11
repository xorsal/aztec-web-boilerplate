/**
 * E2E Test: EIP-712 Clear Signing with Walletless
 *
 * Tests the EIP-712 typed data signing flow using the walletless fixture.
 * Verifies that MetaMask-style signing works correctly for Aztec transactions.
 */

import { test, expect, ANVIL_ACCOUNTS } from './fixtures/walletless';

// Enable debug mode to see EIP-712 typed data payloads
test.use({ walletlessOptions: { debug: true } });

test.describe('EIP-712 Clear Signing E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Clear IndexedDB and storage
    await page.goto('/');
    await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test('should sign EIP-712 typed data via walletless', async ({
    page,
    walletless,
  }) => {
    console.log('\n=== E2E: EIP-712 Typed Data Signing ===\n');
    console.log('Test account:', walletless.account.address);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Test EIP-712 signing directly through walletless provider
    const result = await page.evaluate(async (testAddress) => {
      const ethereum = (window as any).ethereum;
      if (!ethereum) throw new Error('No ethereum provider');

      // Simple EIP-712 typed data structure
      const typedData = {
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
            { name: 'chainId', type: 'uint256' },
          ],
          TestMessage: [
            { name: 'content', type: 'string' },
            { name: 'value', type: 'uint256' },
          ],
        },
        primaryType: 'TestMessage',
        domain: {
          name: 'EIP712 Test',
          version: '1',
          chainId: 31337,
        },
        message: {
          content: 'Hello EIP-712!',
          value: 42,
        },
      };

      // Request signature via eth_signTypedData_v4
      const signature = await ethereum.request({
        method: 'eth_signTypedData_v4',
        params: [testAddress, JSON.stringify(typedData)],
      });

      return { signature, typedData };
    }, walletless.account.address);

    // Verify signature format
    expect(result.signature).toMatch(/^0x[0-9a-f]{130}$/i);
    console.log('EIP-712 Signature:', result.signature.slice(0, 20) + '...');
    console.log('\n=== TEST PASSED ===\n');
  });

  test('should sign Aztec EntrypointAuthorization typed data', async ({
    page,
    walletless,
  }) => {
    console.log('\n=== E2E: Aztec Entrypoint Authorization ===\n');

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async (testAddress) => {
      const ethereum = (window as any).ethereum;
      if (!ethereum) throw new Error('No ethereum provider');

      // Aztec-style EIP-712 typed data for entrypoint authorization
      const typedData = {
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' },
          ],
          AppDomain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
            { name: 'chainId', type: 'uint256' },
            { name: 'salt', type: 'bytes32' },
          ],
          FunctionCall: [
            { name: 'contract', type: 'bytes32' },
            { name: 'functionSignature', type: 'string' },
            { name: 'arguments', type: 'uint256[]' },
          ],
          EntrypointAuthorization: [
            { name: 'appDomain', type: 'AppDomain' },
            { name: 'functionCalls', type: 'FunctionCall[5]' },
            { name: 'txNonce', type: 'uint256' },
          ],
        },
        primaryType: 'EntrypointAuthorization',
        domain: {
          name: 'Aztec',
          version: '1',
          chainId: 31337,
          verifyingContract: '0x0000000000000000000000000000000000000001',
        },
        message: {
          appDomain: {
            name: 'EVM Aztec Wallet',
            version: '1.0.0',
            chainId: 31337,
            salt: '0x0000000000000000000000000000000000000000000000000000000000000001',
          },
          functionCalls: [
            {
              contract:
                '0x000000000000000000000000000000000000000000000000000000000000007b',
              functionSignature: 'transfer_private(Field,Field,u128,Field)',
              arguments: [1, 2, 1000, 0],
            },
            // Empty slots (padded)
            ...Array(4).fill({
              contract:
                '0x0000000000000000000000000000000000000000000000000000000000000000',
              functionSignature: '',
              arguments: [],
            }),
          ],
          txNonce: 1,
        },
      };

      const signature = await ethereum.request({
        method: 'eth_signTypedData_v4',
        params: [testAddress, JSON.stringify(typedData)],
      });

      return {
        signature,
        functionCalls: typedData.message.functionCalls[0],
      };
    }, walletless.account.address);

    // Verify signature
    expect(result.signature).toMatch(/^0x[0-9a-f]{130}$/i);
    expect(result.functionCalls.functionSignature).toBe(
      'transfer_private(Field,Field,u128,Field)'
    );

    console.log('Function:', result.functionCalls.functionSignature);
    console.log('Arguments:', result.functionCalls.arguments);
    console.log('Signature:', result.signature.slice(0, 20) + '...');
    console.log('\n=== TEST PASSED ===\n');
  });

  test('should sign FunctionCallAuthorization (authwit) typed data', async ({
    page,
    walletless,
  }) => {
    console.log('\n=== E2E: Function Call Authorization (Authwit) ===\n');

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async (testAddress) => {
      const ethereum = (window as any).ethereum;
      if (!ethereum) throw new Error('No ethereum provider');

      // Authwit-style EIP-712 typed data
      const typedData = {
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' },
          ],
          AuthwitAppDomain: [
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'bytes32' },
          ],
          FunctionCall: [
            { name: 'contract', type: 'bytes32' },
            { name: 'functionSignature', type: 'string' },
            { name: 'arguments', type: 'uint256[]' },
          ],
          FunctionCallAuthorization: [
            { name: 'appDomain', type: 'AuthwitAppDomain' },
            { name: 'functionCall', type: 'FunctionCall' },
          ],
        },
        primaryType: 'FunctionCallAuthorization',
        domain: {
          name: 'Aztec',
          version: '1',
          chainId: 31337,
          verifyingContract: '0x0000000000000000000000000000000000000001',
        },
        message: {
          appDomain: {
            chainId: 31337,
            verifyingContract:
              '0x000000000000000000000000000000000000000000000000000000000000abcd',
          },
          functionCall: {
            contract:
              '0x000000000000000000000000000000000000000000000000000000000000007b',
            functionSignature: 'transfer_from(Field,Field,u128,Field)',
            arguments: [1, 2, 500, 0],
          },
        },
      };

      const signature = await ethereum.request({
        method: 'eth_signTypedData_v4',
        params: [testAddress, JSON.stringify(typedData)],
      });

      return {
        signature,
        functionCall: typedData.message.functionCall,
      };
    }, walletless.account.address);

    // Verify signature
    expect(result.signature).toMatch(/^0x[0-9a-f]{130}$/i);
    expect(result.functionCall.functionSignature).toBe(
      'transfer_from(Field,Field,u128,Field)'
    );

    console.log('Function:', result.functionCall.functionSignature);
    console.log('Arguments:', result.functionCall.arguments);
    console.log('Signature:', result.signature.slice(0, 20) + '...');
    console.log('\n=== TEST PASSED ===\n');
  });

  test('should sign with personal_sign as fallback', async ({
    page,
    walletless,
  }) => {
    console.log('\n=== E2E: Personal Sign Fallback ===\n');

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async (testAddress) => {
      const ethereum = (window as any).ethereum;
      if (!ethereum) throw new Error('No ethereum provider');

      // Hash to sign (simulating outer_hash from Aztec)
      const messageHash =
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

      const signature = await ethereum.request({
        method: 'personal_sign',
        params: [messageHash, testAddress],
      });

      return { signature, messageHash };
    }, walletless.account.address);

    // Verify signature format (65 bytes = 130 hex chars + 0x prefix)
    expect(result.signature).toMatch(/^0x[0-9a-f]{130}$/i);

    console.log('Message hash:', result.messageHash.slice(0, 20) + '...');
    console.log('Signature:', result.signature.slice(0, 20) + '...');
    console.log('\n=== TEST PASSED ===\n');
  });

  test('walletless provider should have correct account', async ({
    page,
    walletless,
  }) => {
    await page.goto('/');

    const accounts = await page.evaluate(async () => {
      return (window as any).ethereum.request({ method: 'eth_accounts' });
    });

    expect(accounts[0].toLowerCase()).toBe(
      walletless.account.address.toLowerCase()
    );
  });
});
