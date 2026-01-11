/**
 * E2E Test: Mint to Public and Private Balance
 *
 * Tests the minting functionality for both:
 * 1. Walletless (MetaMask simulation via @wonderland/walletless)
 * 2. Embedded wallet (Create New Account)
 *
 * Completion criteria: Balance increases after minting
 *
 * Note: Accounts are deterministic when VITE_E2E_DETERMINISTIC_SALT is set.
 * This allows reusing already-deployed accounts across test runs.
 */

import { test, expect, ANVIL_ACCOUNTS } from './fixtures/walletless';
import { test as baseTest } from '@playwright/test';

const MINT_AMOUNT = '1';
const SANDBOX_CONNECTION_TIMEOUT = 120000;
const WALLET_OPERATION_TIMEOUT = 120000;

type BalanceType = 'public' | 'private';

/**
 * Helper to clear browser storage before each test
 */
async function clearBrowserStorage(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name) indexedDB.deleteDatabase(db.name);
    }
    localStorage.clear();
    sessionStorage.clear();
  });
}

/**
 * Helper to connect to sandbox network
 */
async function connectToSandbox(page: import('@playwright/test').Page) {
  // Click "Connect Wallet" to open modal
  const connectBtn = page.locator('.wallet-connect-button');
  await expect(connectBtn).toBeVisible({ timeout: 30000 });
  await connectBtn.click();

  // Wait for modal
  const modal = page.locator('.modal-content');
  await expect(modal).toBeVisible({ timeout: 5000 });

  // Select sandbox network
  const networkSelect = page.locator('#modal-network-selector');
  await networkSelect.selectOption('sandbox');

  // Wait for network connection
  const networkStatus = page.locator('.network-status');
  await expect(networkStatus).toContainText('connected', {
    timeout: SANDBOX_CONNECTION_TIMEOUT,
  });

  return modal;
}

/**
 * Helper to get current balance from the UI
 */
async function getBalance(
  page: import('@playwright/test').Page,
  type: BalanceType
): Promise<bigint> {
  // Wait for balance card to be visible
  const balanceCard = page.locator('.token-balance-card');
  await expect(balanceCard).toBeVisible({ timeout: 30000 });

  // Wait for loading to complete
  const loadingSpinner = page.locator('.balance-loading');
  if (await loadingSpinner.isVisible()) {
    await expect(loadingSpinner).not.toBeVisible({ timeout: 60000 });
  }

  // Get the balance value for the specified type
  const labelText = type === 'public' ? 'Public' : 'Private';
  const balanceItem = page.locator('.balance-item').filter({
    has: page.locator(`.balance-label:has-text("${labelText}")`),
  });

  const balanceValue = balanceItem.locator('.balance-value');
  await expect(balanceValue).toBeVisible({ timeout: 10000 });

  const balanceText = await balanceValue.textContent();
  return BigInt(balanceText?.trim() || '0');
}

/**
 * Helper to wait for balance to sync after minting.
 *
 * After a successful drip, the useDripper hook calls invalidateBalance() which
 * triggers a React Query refetch. We watch for the "Syncing" badge to appear
 * and disappear, then verify the balance updated.
 */
async function waitForBalanceSync(
  page: import('@playwright/test').Page,
  type: BalanceType,
  expectedMinimum: bigint,
  timeout = 30000
): Promise<bigint> {
  const syncingBadge = page.locator('.balance-refetch-badge');

  // Wait for the syncing badge to appear (refetch started)
  // It may already be visible or appear quickly after tx completes
  try {
    await expect(syncingBadge).toBeVisible({ timeout: 5000 });
    console.log('Balance syncing started...');
  } catch {
    // Badge might have already appeared and disappeared, or refetch was instant
    console.log('Syncing badge not seen (may have been too fast)');
  }

  // Wait for the syncing badge to disappear (refetch complete)
  await expect(syncingBadge).not.toBeVisible({ timeout: timeout });
  console.log('Balance sync complete');

  // Now read the updated balance
  const balance = await getBalance(page, type);

  if (balance < expectedMinimum) {
    throw new Error(
      `${type} balance ${balance} did not reach expected minimum ${expectedMinimum}`
    );
  }

  return balance;
}

/**
 * Helper to mint tokens
 */
async function mintTokens(
  page: import('@playwright/test').Page,
  amount: string,
  type: BalanceType
) {
  // Wait for dripper form to be visible
  const dripperContent = page.locator('.dripper-content');
  await expect(dripperContent).toBeVisible({ timeout: 60000 });

  // Wait for contracts to load (loading spinner should disappear)
  const loadingSpinner = dripperContent.locator('.animate-spin');
  if (await loadingSpinner.isVisible()) {
    await expect(loadingSpinner).not.toBeVisible({ timeout: 120000 });
  }

  // Enter amount
  const amountInput = page.locator('#amount');
  await expect(amountInput).toBeVisible({ timeout: 10000 });
  await expect(amountInput).toBeEnabled({ timeout: 10000 });
  await amountInput.fill(amount);

  // Select drip type
  const dripTypeSelect = page.locator('#drip-type');
  await expect(dripTypeSelect).toBeEnabled({ timeout: 10000 });
  await dripTypeSelect.selectOption(type);

  // Find the drip button
  const dripButton = page.locator('button.btn-primary').filter({
    hasText: new RegExp(`Drip to ${type}`, 'i'),
  });
  await expect(dripButton).toBeVisible({ timeout: 10000 });
  await expect(dripButton).toBeEnabled({ timeout: 30000 });

  // Log button state before clicking
  const buttonText = await dripButton.textContent();
  console.log('Drip button text before click:', buttonText);

  // Click the drip button
  await dripButton.click();
  console.log('Drip button clicked');

  // Wait for transaction to process
  const startTime = Date.now();
  let sawProcessing = false;

  while (Date.now() - startTime < WALLET_OPERATION_TIMEOUT) {
    const currentText = await dripButton.textContent();

    if (currentText?.includes('Processing')) {
      sawProcessing = true;
      console.log('Transaction processing...');
    }

    // Check if processing is done (back to "Drip to")
    if (sawProcessing && currentText?.includes('Drip to')) {
      console.log('Transaction completed');
      break;
    }

    // Also check for success notification
    const successNotification = page.locator('.error-item.info');
    if (await successNotification.isVisible()) {
      const notifText = await successNotification.textContent();
      if (notifText?.includes('Successfully minted')) {
        console.log('Success notification appeared:', notifText);
        break;
      }
    }

    await page.waitForTimeout(500);
  }
}

// ============================================================================
// MINT TO PUBLIC TESTS
// ============================================================================

test.describe('Mint to Public - Walletless (MetaMask)', () => {
  test.beforeEach(async ({ page }) => {
    await clearBrowserStorage(page);
  });

  test('should mint tokens to public balance via walletless MetaMask', async ({
    page,
    walletless,
  }) => {
    console.log('\n=== E2E: Mint to Public via Walletless ===\n');
    console.log('Test account:', walletless.account.address);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const modal = await connectToSandbox(page);
    console.log('Sandbox connected');

    const metamaskBtn = modal.locator('button:has-text("MetaMask")');
    await expect(metamaskBtn).toBeEnabled({ timeout: 10000 });
    await metamaskBtn.click();
    console.log('MetaMask button clicked, waiting for wallet connection...');

    await expect(modal).not.toBeVisible({ timeout: WALLET_OPERATION_TIMEOUT });
    console.log('Wallet connected');

    const accountSection = page.locator('.connected-account-section');
    await expect(accountSection).toBeVisible({
      timeout: WALLET_OPERATION_TIMEOUT,
    });

    const initialBalance = await getBalance(page, 'public');
    console.log('Initial public balance:', initialBalance.toString());

    console.log(`Minting ${MINT_AMOUNT} tokens to public balance...`);
    await mintTokens(page, MINT_AMOUNT, 'public');
    console.log('Mint transaction submitted');

    const expectedMinBalance = initialBalance + BigInt(MINT_AMOUNT);
    const finalBalance = await waitForBalanceSync(
      page,
      'public',
      expectedMinBalance
    );
    console.log('Final public balance:', finalBalance.toString());

    expect(finalBalance).toBeGreaterThanOrEqual(expectedMinBalance);
    console.log(
      `Balance increased by ${(finalBalance - initialBalance).toString()} tokens`
    );

    console.log('\n=== TEST PASSED ===\n');
  });
});

baseTest.describe('Mint to Public - Embedded Wallet (Create New Account)', () => {
  baseTest.beforeEach(async ({ page }) => {
    await clearBrowserStorage(page);
  });

  baseTest(
    'should mint tokens to public balance via embedded wallet',
    async ({ page }) => {
      console.log('\n=== E2E: Mint to Public via Embedded Wallet ===\n');

      await page.goto('/');
      await page.waitForLoadState('networkidle');

      const modal = await connectToSandbox(page);
      console.log('Sandbox connected');

      const createAccountBtn = modal.locator(
        'button:has-text("Create New Account")'
      );
      await expect(createAccountBtn).toBeEnabled({ timeout: 10000 });
      await createAccountBtn.click();
      console.log(
        'Create New Account clicked, waiting for account creation...'
      );

      await expect(modal).not.toBeVisible({ timeout: WALLET_OPERATION_TIMEOUT });
      console.log('Account created and connected');

      const accountSection = page.locator('.connected-account-section');
      await expect(accountSection).toBeVisible({
        timeout: WALLET_OPERATION_TIMEOUT,
      });

      const initialBalance = await getBalance(page, 'public');
      console.log('Initial public balance:', initialBalance.toString());

      console.log(`Minting ${MINT_AMOUNT} tokens to public balance...`);
      await mintTokens(page, MINT_AMOUNT, 'public');
      console.log('Mint transaction submitted');

      const expectedMinBalance = initialBalance + BigInt(MINT_AMOUNT);
      const finalBalance = await waitForBalanceSync(
        page,
        'public',
        expectedMinBalance
      );
      console.log('Final public balance:', finalBalance.toString());

      expect(finalBalance).toBeGreaterThanOrEqual(expectedMinBalance);
      console.log(
        `Balance increased by ${(finalBalance - initialBalance).toString()} tokens`
      );

      console.log('\n=== TEST PASSED ===\n');
    }
  );
});

// ============================================================================
// MINT TO PRIVATE TESTS
// ============================================================================

test.describe('Mint to Private - Walletless (MetaMask)', () => {
  test.beforeEach(async ({ page }) => {
    await clearBrowserStorage(page);
  });

  test('should mint tokens to private balance via walletless MetaMask', async ({
    page,
    walletless,
  }) => {
    console.log('\n=== E2E: Mint to Private via Walletless ===\n');
    console.log('Test account:', walletless.account.address);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const modal = await connectToSandbox(page);
    console.log('Sandbox connected');

    const metamaskBtn = modal.locator('button:has-text("MetaMask")');
    await expect(metamaskBtn).toBeEnabled({ timeout: 10000 });
    await metamaskBtn.click();
    console.log('MetaMask button clicked, waiting for wallet connection...');

    await expect(modal).not.toBeVisible({ timeout: WALLET_OPERATION_TIMEOUT });
    console.log('Wallet connected');

    const accountSection = page.locator('.connected-account-section');
    await expect(accountSection).toBeVisible({
      timeout: WALLET_OPERATION_TIMEOUT,
    });

    const initialBalance = await getBalance(page, 'private');
    console.log('Initial private balance:', initialBalance.toString());

    console.log(`Minting ${MINT_AMOUNT} tokens to private balance...`);
    await mintTokens(page, MINT_AMOUNT, 'private');
    console.log('Mint transaction submitted');

    const expectedMinBalance = initialBalance + BigInt(MINT_AMOUNT);
    const finalBalance = await waitForBalanceSync(
      page,
      'private',
      expectedMinBalance
    );
    console.log('Final private balance:', finalBalance.toString());

    expect(finalBalance).toBeGreaterThanOrEqual(expectedMinBalance);
    console.log(
      `Balance increased by ${(finalBalance - initialBalance).toString()} tokens`
    );

    console.log('\n=== TEST PASSED ===\n');
  });
});

baseTest.describe(
  'Mint to Private - Embedded Wallet (Create New Account)',
  () => {
    baseTest.beforeEach(async ({ page }) => {
      await clearBrowserStorage(page);
    });

    baseTest(
      'should mint tokens to private balance via embedded wallet',
      async ({ page }) => {
        console.log('\n=== E2E: Mint to Private via Embedded Wallet ===\n');

        await page.goto('/');
        await page.waitForLoadState('networkidle');

        const modal = await connectToSandbox(page);
        console.log('Sandbox connected');

        const createAccountBtn = modal.locator(
          'button:has-text("Create New Account")'
        );
        await expect(createAccountBtn).toBeEnabled({ timeout: 10000 });
        await createAccountBtn.click();
        console.log(
          'Create New Account clicked, waiting for account creation...'
        );

        await expect(modal).not.toBeVisible({
          timeout: WALLET_OPERATION_TIMEOUT,
        });
        console.log('Account created and connected');

        const accountSection = page.locator('.connected-account-section');
        await expect(accountSection).toBeVisible({
          timeout: WALLET_OPERATION_TIMEOUT,
        });

        const initialBalance = await getBalance(page, 'private');
        console.log('Initial private balance:', initialBalance.toString());

        console.log(`Minting ${MINT_AMOUNT} tokens to private balance...`);
        await mintTokens(page, MINT_AMOUNT, 'private');
        console.log('Mint transaction submitted');

        const expectedMinBalance = initialBalance + BigInt(MINT_AMOUNT);
        const finalBalance = await waitForBalanceSync(
          page,
          'private',
          expectedMinBalance
        );
        console.log('Final private balance:', finalBalance.toString());

        expect(finalBalance).toBeGreaterThanOrEqual(expectedMinBalance);
        console.log(
          `Balance increased by ${(finalBalance - initialBalance).toString()} tokens`
        );

        console.log('\n=== TEST PASSED ===\n');
      }
    );
  }
);
