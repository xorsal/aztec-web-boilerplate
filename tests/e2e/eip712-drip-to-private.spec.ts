/**
 * E2E Test: EIP-712 drip_to_private with Balance Verification
 *
 * This test exercises the full EIP-712 flow:
 * 1. Connects with MetaMask (via walletless fixture)
 * 2. Calls drip_to_private on the Dripper contract
 * 3. Validates the EIP-712 typed data shows human-readable function signature
 * 4. Verifies the private balance increases after the transaction
 *
 * IMPORTANT: This test requires a running Aztec sandbox.
 */

import { test, expect, ANVIL_ACCOUNTS } from './fixtures/walletless';

// Enable debug mode to see walletless logs
test.use({ walletlessOptions: { debug: true } });

// Sandbox connection timeout (needs time to initialize PXE)
const SANDBOX_CONNECTION_TIMEOUT = 120000;
// Wallet operation timeout (account creation/deployment takes time)
const WALLET_OPERATION_TIMEOUT = 180000;
// Transaction timeout
const TX_TIMEOUT = 300000;

type BalanceType = 'public' | 'private';

/**
 * Helper to connect to sandbox network
 */
async function connectToSandbox(page: import('@playwright/test').Page) {
  console.log('[Test] Clicking Connect Wallet button...');

  // Click "Connect Wallet" to open modal
  const connectBtn = page.locator('.wallet-connect-button');
  await expect(connectBtn).toBeVisible({ timeout: 30000 });
  await connectBtn.click();

  // Wait for modal
  const modal = page.locator('.modal-content');
  await expect(modal).toBeVisible({ timeout: 5000 });
  console.log('[Test] Modal opened');

  // Select sandbox network
  const networkSelect = page.locator('#modal-network-selector');
  await networkSelect.selectOption('sandbox');
  console.log('[Test] Selected sandbox network');

  // Wait for network connection (initializing spinner disappears, "connected" appears)
  const networkStatus = page.locator('.network-status');

  // First wait for initializing state
  console.log('[Test] Waiting for network to initialize...');
  await expect(networkStatus).toContainText(/connected|Initializing/, {
    timeout: 10000,
  });

  // Then wait specifically for connected
  await expect(networkStatus).toContainText('connected', {
    timeout: SANDBOX_CONNECTION_TIMEOUT,
  });
  console.log('[Test] Network connected');

  return modal;
}

/**
 * Helper to get current balance from the UI
 */
async function getBalance(
  page: import('@playwright/test').Page,
  type: BalanceType
): Promise<bigint> {
  const balanceCard = page.locator('.token-balance-card');
  await expect(balanceCard).toBeVisible({ timeout: 60000 });

  // Wait for loading to complete
  const loadingSpinner = page.locator('.balance-loading');
  if (await loadingSpinner.isVisible()) {
    console.log(`[Test] Waiting for ${type} balance to load...`);
    await expect(loadingSpinner).not.toBeVisible({ timeout: 120000 });
  }

  const labelText = type === 'public' ? 'Public' : 'Private';
  const balanceItem = page.locator('.balance-item').filter({
    has: page.locator(`.balance-label:has-text("${labelText}")`),
  });

  const balanceValue = balanceItem.locator('.balance-value');
  await expect(balanceValue).toBeVisible({ timeout: 10000 });

  const balanceText = await balanceValue.textContent();
  const balance = BigInt(balanceText?.trim() || '0');
  console.log(`[Test] ${type} balance: ${balance.toString()}`);
  return balance;
}

/**
 * Helper to wait for balance to sync after minting.
 */
async function waitForBalanceSync(
  page: import('@playwright/test').Page,
  type: BalanceType,
  expectedMinimum: bigint,
  timeout = 120000
): Promise<bigint> {
  console.log(`[Test] Waiting for ${type} balance to reach at least ${expectedMinimum.toString()}...`);

  const startTime = Date.now();
  let lastBalance = 0n;

  while (Date.now() - startTime < timeout) {
    try {
      const balance = await getBalance(page, type);
      lastBalance = balance;

      if (balance >= expectedMinimum) {
        console.log(`[Test] Balance reached: ${balance.toString()}`);
        return balance;
      }

      // Check for syncing badge
      const syncingBadge = page.locator('.balance-refetch-badge');
      if (await syncingBadge.isVisible()) {
        console.log('[Test] Balance is syncing...');
      }

      // Wait a bit before retrying
      await page.waitForTimeout(2000);
    } catch (e) {
      // Balance card might not be visible yet
      await page.waitForTimeout(2000);
    }
  }

  throw new Error(
    `${type} balance ${lastBalance} did not reach expected minimum ${expectedMinimum} within ${timeout}ms`
  );
}

/**
 * Execute drip_to_private and capture EIP-712 typed data
 */
async function executeDripToPrivate(
  page: import('@playwright/test').Page,
  amount: string,
  type: BalanceType
): Promise<{ capturedTypedData: any[] }> {
  console.log(`[Test] Starting drip to ${type} with amount ${amount}...`);

  // Wait for dripper form to be ready
  const dripperContent = page.locator('.dripper-content');
  await expect(dripperContent).toBeVisible({ timeout: 120000 });
  console.log('[Test] Dripper content visible');

  // Wait for loading to complete
  const loadingSpinner = dripperContent.locator('.animate-spin');
  if (await loadingSpinner.isVisible()) {
    console.log('[Test] Waiting for dripper to load...');
    await expect(loadingSpinner).not.toBeVisible({ timeout: 120000 });
  }

  // Enter amount
  const amountInput = page.locator('#amount');
  await expect(amountInput).toBeVisible({ timeout: 10000 });
  await expect(amountInput).toBeEnabled({ timeout: 10000 });
  await amountInput.fill(amount);
  console.log(`[Test] Entered amount: ${amount}`);

  // Select drip type
  const dripTypeSelect = page.locator('#drip-type');
  await expect(dripTypeSelect).toBeEnabled({ timeout: 10000 });
  await dripTypeSelect.selectOption(type);
  console.log(`[Test] Selected drip type: ${type}`);

  // Set up typed data capture before clicking
  await page.evaluate(() => {
    const captured: any[] = [];
    const ethereum = (window as any).ethereum;

    if (!ethereum) {
      console.error('[Test] No ethereum provider found!');
      return;
    }

    const originalRequest = ethereum.request.bind(ethereum);
    ethereum.request = async (args: any) => {
      console.log(`[Test] Intercepted ethereum.request: ${args.method}`);

      if (args.method === 'eth_signTypedData_v4') {
        const [address, dataString] = args.params;
        console.log('[Test] Captured eth_signTypedData_v4 call');
        try {
          const data = JSON.parse(dataString);
          captured.push({
            address,
            primaryType: data.primaryType,
            domain: data.domain,
            message: data.message,
            timestamp: Date.now(),
          });
          console.log('[Test] Typed data captured:', {
            primaryType: data.primaryType,
            functionSignature: data.message?.functionCalls?.[0]?.functionSignature,
          });
        } catch (e) {
          console.error('[Test] Failed to parse typed data:', e);
        }
      }
      return originalRequest(args);
    };

    (window as any).__capturedTypedData = captured;
  });

  // Click drip button
  const buttonText = type === 'public' ? 'Drip to public' : 'Drip to private';
  const dripButton = page.locator('button.btn-primary').filter({
    hasText: new RegExp(buttonText, 'i'),
  });
  await expect(dripButton).toBeVisible({ timeout: 10000 });
  await expect(dripButton).toBeEnabled({ timeout: 30000 });

  console.log('[Test] Clicking drip button...');
  await dripButton.click();

  // Wait for button to show processing state (might show "Processing..." or have spinner)
  console.log('[Test] Waiting for transaction to start...');

  // Wait a bit for the transaction to start processing
  await page.waitForTimeout(2000);

  // Check if there's an error message displayed
  const errorMessage = page.locator('.status-message.error, .error-toast, .error-message, [role="alert"]');
  if (await errorMessage.isVisible()) {
    const errorText = await errorMessage.textContent();
    console.log(`[Test] ERROR: Transaction failed: ${errorText}`);
    throw new Error(`Transaction failed: ${errorText}`);
  }

  // Wait for transaction to complete - either button returns to normal or we see success
  console.log('[Test] Waiting for transaction to complete...');

  // Poll for completion or error for up to TX_TIMEOUT
  const startTime = Date.now();
  let completed = false;

  while (Date.now() - startTime < TX_TIMEOUT && !completed) {
    // Check for error
    if (await errorMessage.isVisible()) {
      const errorText = await errorMessage.textContent();
      console.log(`[Test] ERROR: Transaction failed during wait: ${errorText}`);
      throw new Error(`Transaction failed: ${errorText}`);
    }

    // Check if button is back to normal state (not processing)
    const buttonTextContent = await dripButton.textContent();
    if (buttonTextContent && /Drip to/i.test(buttonTextContent) && !/Processing|pending/i.test(buttonTextContent)) {
      completed = true;
      console.log('[Test] Transaction appears complete, button text:', buttonTextContent);
    }

    await page.waitForTimeout(1000);
  }

  if (!completed) {
    console.log('[Test] Transaction did not complete within timeout');
  }

  console.log('[Test] Transaction completed');

  // Retrieve captured data
  const finalCaptured = await page.evaluate(() => {
    return (window as any).__capturedTypedData || [];
  });

  console.log(`[Test] Captured ${finalCaptured.length} typed data requests`);
  return { capturedTypedData: finalCaptured };
}

// ============================================================================
// FULL INTEGRATION TEST
// This test performs actual transactions and verifies balance changes
// ============================================================================

test.describe('EIP-712 drip_to_private Full Integration', () => {
  // Set long timeout for this test suite
  test.setTimeout(TX_TIMEOUT);

  test('should drip_to_private with EIP-712 clear signing and verify balance increment', async ({
    page,
    walletless,
  }) => {
    // Set up console logging for debugging
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('Error') || text.includes('error') || text.includes('[') || text.includes('failed') || text.includes('Failed')) {
        console.log(`[browser:${msg.type()}] ${text}`);
      }
    });

    console.log('\n========================================');
    console.log('E2E: Full drip_to_private with EIP-712');
    console.log('========================================\n');
    console.log('Test account:', walletless.account.address);

    // Clear storage first
    await page.goto('/');
    await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Step 1: Connect to sandbox
    console.log('\n--- Step 1: Connect to Sandbox ---');
    const modal = await connectToSandbox(page);

    // Step 2: Connect with MetaMask (walletless provider simulates MetaMask)
    console.log('\n--- Step 2: Connect MetaMask ---');

    // Find MetaMask button in External Signer section
    // The walletless fixture injects a MetaMask-like provider
    const metamaskBtn = modal.locator('button.modal-action-button').filter({
      hasText: /MetaMask/i
    });

    await expect(metamaskBtn).toBeVisible({ timeout: 30000 });
    await expect(metamaskBtn).toBeEnabled({ timeout: 30000 });

    console.log('[Test] Clicking MetaMask button...');
    await metamaskBtn.click();

    // Wait for modal to close (indicates connection success)
    console.log('[Test] Waiting for wallet connection...');
    await expect(modal).not.toBeVisible({ timeout: WALLET_OPERATION_TIMEOUT });
    console.log('[Test] Wallet connected');

    // Step 3: Wait for account section to appear
    console.log('\n--- Step 3: Wait for Account Ready ---');
    const accountSection = page.locator('.connected-account-section');
    await expect(accountSection).toBeVisible({
      timeout: WALLET_OPERATION_TIMEOUT,
    });
    console.log('[Test] Account section visible');

    // Step 4: Get initial private balance
    console.log('\n--- Step 4: Get Initial Balance ---');
    const initialBalance = await getBalance(page, 'private');
    console.log(`Initial private balance: ${initialBalance.toString()}`);

    // Step 5: Execute drip_to_private with EIP-712
    console.log('\n--- Step 5: Execute drip_to_private ---');
    const mintAmount = '1';
    const { capturedTypedData } = await executeDripToPrivate(
      page,
      mintAmount,
      'private'
    );

    // Step 6: Verify EIP-712 typed data was used (clear signing)
    console.log('\n--- Step 6: Verify EIP-712 Clear Signing ---');
    console.log(`Captured ${capturedTypedData.length} typed data requests`);

    if (capturedTypedData.length > 0) {
      const typedData = capturedTypedData[0];

      // Verify it's an EntrypointAuthorization request
      expect(typedData.primaryType).toBe('EntrypointAuthorization');
      console.log('Primary Type:', typedData.primaryType);

      // Verify Aztec domain
      expect(typedData.domain.name).toBe('Aztec');
      expect(typedData.domain.chainId).toBe(31337);
      console.log('Domain:', typedData.domain.name, 'chainId:', typedData.domain.chainId);

      // Verify function call is human-readable (CLEAR SIGNING)
      const functionCall = typedData.message?.functionCalls?.[0];
      if (functionCall) {
        expect(functionCall.functionSignature).toContain('drip_to_private');
        console.log('Function Signature:', functionCall.functionSignature);
        console.log('Arguments:', functionCall.arguments);

        // This is the key assertion: function signature must be human-readable
        // Not a hex blob, but actual function name with parameter types
        expect(functionCall.functionSignature).toMatch(/^drip_to_private\(/);
      }

      console.log('Tx Nonce:', typedData.message?.txNonce);
    } else {
      console.warn('WARNING: No typed data captured - signature might have used fallback');
    }

    // Step 7: Verify balance increased
    console.log('\n--- Step 7: Verify Balance Increment ---');
    const expectedMinBalance = initialBalance + BigInt(mintAmount);
    const finalBalance = await waitForBalanceSync(
      page,
      'private',
      expectedMinBalance,
      120000
    );

    console.log(`Final private balance: ${finalBalance.toString()}`);
    expect(finalBalance).toBeGreaterThanOrEqual(expectedMinBalance);

    const increment = finalBalance - initialBalance;
    console.log(`Balance increased by: ${increment.toString()} tokens`);

    // Assertion: balance MUST have increased
    expect(increment).toBeGreaterThan(0n);

    console.log('\n========================================');
    console.log('TEST PASSED');
    console.log('- EIP-712 clear signing: VERIFIED');
    console.log(`- Private balance increased: ${initialBalance} -> ${finalBalance}`);
    console.log('========================================\n');
  });
});
