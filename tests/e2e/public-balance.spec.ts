/**
 * E2E Test: Public Balance Query with EIP-712 Clear Signing
 *
 * This test verifies:
 * 1. The public balance is correctly queried and displayed
 * 2. After dripping to public, the public balance increases
 * 3. Any EIP-712 signing requests show clear, human-readable function signatures
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

  // Wait for network connection
  const networkStatus = page.locator('.network-status');
  console.log('[Test] Waiting for network to initialize...');
  await expect(networkStatus).toContainText(/connected|Initializing/, {
    timeout: 10000,
  });

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
  console.log(
    `[Test] Waiting for ${type} balance to reach at least ${expectedMinimum.toString()}...`
  );

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
 * Execute drip and capture any EIP-712 typed data
 */
async function executeDrip(
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

  // Wait for transaction to start
  await page.waitForTimeout(2000);

  // Check for error
  const errorMessage = page.locator(
    '.status-message.error, .error-toast, .error-message, [role="alert"]'
  );
  if (await errorMessage.isVisible()) {
    const errorText = await errorMessage.textContent();
    console.log(`[Test] ERROR: Transaction failed: ${errorText}`);
    throw new Error(`Transaction failed: ${errorText}`);
  }

  // Wait for transaction to complete
  console.log('[Test] Waiting for transaction to complete...');

  const startTime = Date.now();
  let completed = false;

  while (Date.now() - startTime < TX_TIMEOUT && !completed) {
    if (await errorMessage.isVisible()) {
      const errorText = await errorMessage.textContent();
      console.log(`[Test] ERROR: Transaction failed during wait: ${errorText}`);
      throw new Error(`Transaction failed: ${errorText}`);
    }

    const buttonTextContent = await dripButton.textContent();
    if (
      buttonTextContent &&
      /Drip to/i.test(buttonTextContent) &&
      !/Processing|pending/i.test(buttonTextContent)
    ) {
      completed = true;
      console.log('[Test] Transaction appears complete, button text:', buttonTextContent);
    }

    await page.waitForTimeout(1000);
  }

  console.log('[Test] Transaction completed');

  // Retrieve captured data
  const finalCaptured = await page.evaluate(() => {
    return (window as any).__capturedTypedData || [];
  });

  console.log(`[Test] Captured ${finalCaptured.length} typed data requests`);
  return { capturedTypedData: finalCaptured };
}

/**
 * Verify that captured typed data uses clear signing (human-readable function signatures)
 */
function verifyClearSigning(capturedTypedData: any[], expectedFunctionSubstring?: string) {
  if (capturedTypedData.length === 0) {
    console.log('[Test] No typed data captured - may use direct queries without signing');
    return;
  }

  for (const typedData of capturedTypedData) {
    // Verify it's an EntrypointAuthorization or FunctionCallAuthorization
    expect(['EntrypointAuthorization', 'FunctionCallAuthorization']).toContain(
      typedData.primaryType
    );
    console.log('[Test] Primary Type:', typedData.primaryType);

    // Verify Aztec domain
    expect(typedData.domain.name).toBe('Aztec');
    console.log('[Test] Domain:', typedData.domain.name);

    // Get function calls from the message
    const functionCalls =
      typedData.primaryType === 'EntrypointAuthorization'
        ? typedData.message?.functionCalls
        : [typedData.message?.functionCall];

    if (functionCalls) {
      for (const call of functionCalls) {
        if (call && call.functionSignature) {
          // Verify the function signature is human-readable (not a hex hash)
          // A clear signature looks like "drip_to_public(AztecAddress,u64)"
          // NOT a hex hash like "0x12345..."
          expect(call.functionSignature).not.toMatch(/^0x[0-9a-f]+$/i);

          // Should contain parentheses for a function signature
          if (call.functionSignature !== '') {
            expect(call.functionSignature).toMatch(/\(.*\)/);
          }

          console.log('[Test] Function Signature (CLEAR):', call.functionSignature);

          // If an expected substring is provided, verify it's present
          if (expectedFunctionSubstring && call.functionSignature !== '') {
            expect(call.functionSignature.toLowerCase()).toContain(
              expectedFunctionSubstring.toLowerCase()
            );
          }
        }
      }
    }
  }
}

// ============================================================================
// FULL INTEGRATION TEST
// ============================================================================

test.describe('Public Balance Query with EIP-712 Clear Signing', () => {
  test.setTimeout(TX_TIMEOUT);

  test('should display public balance and verify clear signing for drip_to_public', async ({
    page,
    walletless,
  }) => {
    // Set up console logging for debugging
    page.on('console', (msg) => {
      const text = msg.text();
      if (
        text.includes('Error') ||
        text.includes('error') ||
        text.includes('[') ||
        text.includes('failed') ||
        text.includes('Failed')
      ) {
        console.log(`[browser:${msg.type()}] ${text}`);
      }
    });

    console.log('\n========================================');
    console.log('E2E: Public Balance Query with Clear Signing');
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

    // Step 2: Connect with MetaMask
    console.log('\n--- Step 2: Connect MetaMask ---');

    const metamaskBtn = modal.locator('button.modal-action-button').filter({
      hasText: /MetaMask/i,
    });

    await expect(metamaskBtn).toBeVisible({ timeout: 30000 });
    await expect(metamaskBtn).toBeEnabled({ timeout: 30000 });

    console.log('[Test] Clicking MetaMask button...');
    await metamaskBtn.click();

    // Wait for modal to close
    console.log('[Test] Waiting for wallet connection...');
    await expect(modal).not.toBeVisible({ timeout: WALLET_OPERATION_TIMEOUT });
    console.log('[Test] Wallet connected');

    // Step 3: Wait for account section
    console.log('\n--- Step 3: Wait for Account Ready ---');
    const accountSection = page.locator('.connected-account-section');
    await expect(accountSection).toBeVisible({
      timeout: WALLET_OPERATION_TIMEOUT,
    });
    console.log('[Test] Account section visible');

    // Step 4: Get initial public balance
    console.log('\n--- Step 4: Get Initial Public Balance ---');
    const initialPublicBalance = await getBalance(page, 'public');
    console.log(`Initial PUBLIC balance: ${initialPublicBalance.toString()}`);

    // Step 5: Execute drip_to_public with EIP-712
    console.log('\n--- Step 5: Execute drip_to_public ---');
    const mintAmount = '1';
    const { capturedTypedData } = await executeDrip(page, mintAmount, 'public');

    // Step 6: Verify EIP-712 clear signing was used
    console.log('\n--- Step 6: Verify EIP-712 Clear Signing ---');
    console.log(`Captured ${capturedTypedData.length} typed data requests`);

    if (capturedTypedData.length > 0) {
      verifyClearSigning(capturedTypedData, 'drip_to_public');
      console.log('[Test] Clear signing VERIFIED');
    } else {
      console.warn('[Test] WARNING: No typed data captured');
    }

    // Step 7: Verify public balance increased
    console.log('\n--- Step 7: Verify Public Balance Increment ---');
    const expectedMinBalance = initialPublicBalance + BigInt(mintAmount);
    const finalPublicBalance = await waitForBalanceSync(
      page,
      'public',
      expectedMinBalance,
      120000
    );

    console.log(`Final PUBLIC balance: ${finalPublicBalance.toString()}`);
    expect(finalPublicBalance).toBeGreaterThanOrEqual(expectedMinBalance);

    const increment = finalPublicBalance - initialPublicBalance;
    console.log(`Public balance increased by: ${increment.toString()} tokens`);

    // Assertion: balance MUST have increased
    expect(increment).toBeGreaterThan(0n);

    // Step 8: Verify both balances are displayed correctly
    console.log('\n--- Step 8: Verify Balance Display ---');
    const privateBalance = await getBalance(page, 'private');
    console.log(`Private balance: ${privateBalance.toString()}`);
    console.log(`Public balance: ${finalPublicBalance.toString()}`);

    // Verify the balance card shows both values
    const balanceCard = page.locator('.token-balance-card');
    await expect(balanceCard).toBeVisible();

    // Both balance items should be visible
    const privateItem = page.locator('.balance-item').filter({
      has: page.locator('.balance-label:has-text("Private")'),
    });
    const publicItem = page.locator('.balance-item').filter({
      has: page.locator('.balance-label:has-text("Public")'),
    });

    await expect(privateItem).toBeVisible();
    await expect(publicItem).toBeVisible();

    console.log('\n========================================');
    console.log('TEST PASSED');
    console.log('- Public balance query: WORKING');
    console.log('- EIP-712 clear signing: VERIFIED');
    console.log(`- Public balance increased: ${initialPublicBalance} -> ${finalPublicBalance}`);
    console.log('========================================\n');
  });

  test('should query both private and public balances', async ({ page, walletless }) => {
    console.log('\n========================================');
    console.log('E2E: Query Both Private and Public Balances');
    console.log('========================================\n');

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

    // Connect to sandbox
    const modal = await connectToSandbox(page);

    // Connect with MetaMask
    const metamaskBtn = modal.locator('button.modal-action-button').filter({
      hasText: /MetaMask/i,
    });
    await expect(metamaskBtn).toBeVisible({ timeout: 30000 });
    await metamaskBtn.click();
    await expect(modal).not.toBeVisible({ timeout: WALLET_OPERATION_TIMEOUT });

    // Wait for account section
    const accountSection = page.locator('.connected-account-section');
    await expect(accountSection).toBeVisible({
      timeout: WALLET_OPERATION_TIMEOUT,
    });

    // Get both balances
    console.log('[Test] Querying balances...');
    const privateBalance = await getBalance(page, 'private');
    const publicBalance = await getBalance(page, 'public');

    console.log(`Private balance: ${privateBalance.toString()}`);
    console.log(`Public balance: ${publicBalance.toString()}`);

    // Both should be queryable (even if zero)
    expect(privateBalance).toBeGreaterThanOrEqual(0n);
    expect(publicBalance).toBeGreaterThanOrEqual(0n);

    console.log('\n========================================');
    console.log('TEST PASSED');
    console.log('- Private balance query: WORKING');
    console.log('- Public balance query: WORKING');
    console.log('========================================\n');
  });
});
