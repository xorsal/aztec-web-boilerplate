/**
 * E2E Test Helpers for Secret Santa Web UI
 *
 * These helpers provide common actions for testing the Secret Santa game flow.
 */

import { Page, expect } from '@playwright/test';

// Timeout configurations (blockchain transactions are slow)
export const TIMEOUTS = {
  walletConnection: 60_000,
  networkInit: 60_000,
  contractConnection: 30_000,
  transaction: 120_000,
  gameStatePolling: 10_000,
};

/**
 * Wait for the app to be ready (navbar visible)
 */
export async function waitForAppReady(page: Page): Promise<void> {
  await expect(page.locator('.navbar')).toBeVisible({ timeout: TIMEOUTS.networkInit });
}

/**
 * Connect wallet by creating or reconnecting an embedded account.
 *
 * @param page - Playwright page
 * @param useConfiguredCredentials - If true, uses "Connect Existing Account" to use
 *   configured credentials (VITE_EMBEDDED_ACCOUNT_SECRET_KEY).
 *   If false or not specified, creates a new random account.
 */
export async function connectEmbeddedWallet(
  page: Page,
  useConfiguredCredentials: boolean = false
): Promise<void> {
  // Click Connect Wallet button
  const connectBtn = page.locator('[data-testid="connect-wallet-button"]');
  await expect(connectBtn).toBeVisible({ timeout: TIMEOUTS.walletConnection });
  await connectBtn.click();

  // Wait for modal to appear
  const modal = page.locator('.modal-content');
  await expect(modal).toBeVisible();

  // Select sandbox network
  const networkSelector = page.locator('[data-testid="network-selector"]');
  await expect(networkSelector).toBeVisible();
  await networkSelector.selectOption('sandbox');

  // Wait for network to initialize (the "connected" status in modal)
  await expect(page.locator('.network-status.connected')).toBeVisible({
    timeout: TIMEOUTS.networkInit,
  });

  const existingAccountBtn = page.locator('[data-testid="connect-existing-account"]');
  const createAccountBtn = page.locator('[data-testid="create-new-account"]');

  // Wait for buttons to be ready
  await expect(createAccountBtn).toBeVisible({ timeout: TIMEOUTS.walletConnection });

  if (useConfiguredCredentials) {
    // Use configured credentials (admin account)
    const isExistingEnabled = await existingAccountBtn.isEnabled().catch(() => false);
    if (isExistingEnabled) {
      await existingAccountBtn.click();
    } else {
      throw new Error('Configured credentials not available. Build app with VITE_EMBEDDED_ACCOUNT_SECRET_KEY');
    }
  } else {
    // Create a new random account
    await createAccountBtn.click();
  }

  // Wait for wallet to be connected (account address visible in header)
  await expect(page.locator('[data-testid="connected-account"]')).toBeVisible({
    timeout: TIMEOUTS.walletConnection,
  });
}

/**
 * Connect to an existing embedded account
 */
export async function connectExistingEmbeddedWallet(page: Page): Promise<void> {
  const connectBtn = page.locator('[data-testid="connect-wallet-button"]');
  await expect(connectBtn).toBeVisible({ timeout: TIMEOUTS.walletConnection });
  await connectBtn.click();

  const modal = page.locator('.modal-content');
  await expect(modal).toBeVisible();

  // Select sandbox network
  const networkSelector = page.locator('[data-testid="network-selector"]');
  await expect(networkSelector).toBeVisible();
  await networkSelector.selectOption('sandbox');

  // Wait for network to initialize
  await expect(page.locator('.network-status.connected')).toBeVisible({
    timeout: TIMEOUTS.networkInit,
  });

  // Click Connect Existing Account
  const existingAccountBtn = page.locator('[data-testid="connect-existing-account"]');
  await expect(existingAccountBtn).toBeEnabled({ timeout: TIMEOUTS.walletConnection });
  await existingAccountBtn.click();

  // Wait for wallet to be connected
  await expect(page.locator('[data-testid="connected-account"]')).toBeVisible({
    timeout: TIMEOUTS.walletConnection,
  });
}

/**
 * Connect to a deployed contract
 */
export async function connectToContract(
  page: Page,
  contractAddress: string,
  gameId: string = '1'
): Promise<void> {
  // Navigate to setup tab
  await page.locator('[data-testid="tab-setup"]').click();

  // Fill contract address
  const addressInput = page.locator('[data-testid="contract-address-input"]');
  await addressInput.fill(contractAddress);

  // Fill game ID
  const gameIdInput = page.locator('[data-testid="game-id-input"]');
  await gameIdInput.fill(gameId);

  // Click connect button
  const connectBtn = page.locator('[data-testid="connect-contract-button"]');
  await connectBtn.click();

  // Wait for connection
  await expect(page.locator('[data-testid="contract-connected"]')).toBeVisible({
    timeout: TIMEOUTS.contractConnection,
  });
}

/**
 * Set passphrase for encryption
 */
export async function setPassphrase(page: Page, passphrase: string): Promise<void> {
  const passphraseInput = page.locator('[data-testid="passphrase-input"]');
  await passphraseInput.fill(passphrase);

  const saveBtn = page.locator('[data-testid="save-settings-button"]');
  await saveBtn.click();

  // Wait for settings saved message
  await expect(page.locator('.success-message')).toBeVisible({ timeout: 5000 });
}

/**
 * Set sender slot (for returning players)
 */
export async function setSenderSlot(page: Page, slot: number): Promise<void> {
  const slotInput = page.locator('[data-testid="sender-slot-input"]');
  await slotInput.fill(slot.toString());

  const saveBtn = page.locator('[data-testid="save-settings-button"]');
  await saveBtn.click();

  await expect(page.locator('.success-message')).toBeVisible({ timeout: 5000 });
}

/**
 * Navigate to a tab
 */
export async function navigateToTab(
  page: Page,
  tabId: 'setup' | 'games' | 'join' | 'sender' | 'receiver' | 'reveal' | 'admin'
): Promise<void> {
  const tab = page.locator(`[data-testid="tab-${tabId}"]`);
  await expect(tab).toBeVisible();
  await tab.click();
}

/**
 * Enroll in a game (during ENROLLMENT phase)
 */
export async function enrollInGame(page: Page): Promise<void> {
  await navigateToTab(page, 'join');

  const enrollBtn = page.locator('[data-testid="enroll-button"]');
  await expect(enrollBtn).toBeVisible({ timeout: TIMEOUTS.gameStatePolling });
  await enrollBtn.click();

  // Wait for success message
  await expect(page.locator('[data-testid="join-success"]')).toBeVisible({
    timeout: TIMEOUTS.transaction,
  });
}

/**
 * Register as sender with a specific slot (during SENDER_REGISTRATION phase)
 */
export async function registerAsSender(page: Page, slot: number): Promise<void> {
  await navigateToTab(page, 'sender');

  // Select slot
  const slotSelect = page.locator('[data-testid="slot-select"]');
  await expect(slotSelect).toBeVisible({ timeout: TIMEOUTS.gameStatePolling });
  await slotSelect.selectOption(slot.toString());

  // Click register
  const registerBtn = page.locator('[data-testid="register-button"]');
  await registerBtn.click();

  // Wait for success
  await expect(page.locator('[data-testid="register-success"]')).toBeVisible({
    timeout: TIMEOUTS.transaction,
  });
}

/**
 * Claim as receiver with delivery address (during RECEIVER_CLAIM phase)
 */
export async function claimAsReceiver(page: Page, deliveryAddress: string): Promise<void> {
  await navigateToTab(page, 'receiver');

  // The slot is auto-assigned via cyclic permutation, so we just need to enter address
  // Wait for a claimable slot to be available
  const claimSlotSelect = page.locator('[data-testid="claim-slot-select"]');
  await expect(claimSlotSelect).toBeVisible({ timeout: TIMEOUTS.gameStatePolling });

  // Select the first available slot (contract handles the actual assignment)
  const options = await claimSlotSelect.locator('option').all();
  if (options.length > 1) {
    // Skip the "Choose a slot..." placeholder
    await claimSlotSelect.selectOption({ index: 1 });
  }

  // Enter delivery address
  const addressInput = page.locator('[data-testid="delivery-address-input"]');
  await addressInput.fill(deliveryAddress);

  // Click claim
  const claimBtn = page.locator('[data-testid="claim-button"]');
  await claimBtn.click();

  // Wait for either success or error
  const successLocator = page.locator('[data-testid="claim-success"]');
  const errorLocator = page.locator('[data-testid="claim-error"]');

  // Use Promise.race to detect whichever appears first
  const result = await Promise.race([
    successLocator.waitFor({ state: 'visible', timeout: TIMEOUTS.transaction }).then(() => 'success'),
    errorLocator.waitFor({ state: 'visible', timeout: TIMEOUTS.transaction }).then(() => 'error'),
  ]);

  if (result === 'error') {
    const errorText = await errorLocator.textContent();
    throw new Error(`Claim failed: ${errorText}`);
  }
}

/**
 * Reveal delivery address (during COMPLETED phase)
 */
export async function revealAddress(page: Page): Promise<string> {
  await navigateToTab(page, 'reveal');

  // Click reveal button
  const revealBtn = page.locator('[data-testid="reveal-button"]');
  await expect(revealBtn).toBeVisible({ timeout: TIMEOUTS.gameStatePolling });
  await revealBtn.click();

  // Wait for result
  await expect(page.locator('[data-testid="delivery-result"]')).toBeVisible({
    timeout: TIMEOUTS.transaction,
  });

  // Get the revealed address
  const addressBox = page.locator('[data-testid="revealed-address"]');
  return await addressBox.textContent() ?? '';
}

/**
 * Get the list of existing game IDs from the games panel
 */
async function getExistingGameIds(page: Page): Promise<number[]> {
  await navigateToTab(page, 'games');

  const noGamesLocator = page.locator('p:has-text("No games available")');
  const gameItemLocator = page.locator('.game-item');

  // Wait for either games to appear or "No games available" message
  // This ensures the games list has actually loaded
  try {
    await Promise.race([
      gameItemLocator.first().waitFor({ state: 'visible', timeout: 60000 }),
      noGamesLocator.waitFor({ state: 'visible', timeout: 60000 }),
    ]);
  } catch {
    // If neither appears after timeout, assume no games
    return [];
  }

  // Click refresh to ensure game list is up to date
  const refreshBtn = page.locator('button:has-text("Refresh")');
  if (await refreshBtn.isVisible().catch(() => false)) {
    await refreshBtn.click();
    // Wait for refresh to complete - either new games appear or list stabilizes
    await page.waitForTimeout(3000);
  }

  // Check if there are no games
  if (await noGamesLocator.isVisible().catch(() => false)) {
    return [];
  }

  // Get all game items
  const count = await gameItemLocator.count();
  const ids: number[] = [];

  for (let i = 0; i < count; i++) {
    const text = await gameItemLocator.nth(i).textContent();
    const match = text?.match(/Game #(\d+)/);
    if (match) {
      ids.push(parseInt(match[1], 10));
    }
  }

  return ids;
}

/**
 * Create a new game (admin only)
 * Returns the ID of the newly created game
 */
export async function createGame(
  page: Page,
  minParticipants: number,
  maxParticipants: number
): Promise<number> {
  await navigateToTab(page, 'admin');

  // Fill min participants
  const minInput = page.locator('[data-testid="min-participants-input"]');
  await minInput.fill(minParticipants.toString());

  // Fill max participants
  const maxInput = page.locator('[data-testid="max-participants-input"]');
  await maxInput.fill(maxParticipants.toString());

  // Click create
  const createBtn = page.locator('[data-testid="create-game-button"]');
  await createBtn.click();

  // Wait for success
  await expect(page.locator('[data-testid="admin-success"]')).toBeVisible({
    timeout: TIMEOUTS.transaction,
  });

  // Navigate to games tab to find the newly created game
  await navigateToTab(page, 'games');

  // Wait for games to load - this can take a while if there are many games
  // Wait for either game items OR the "No games" message
  const gameItemLocator = page.locator('.game-item');
  const noGamesLocator = page.locator('p:has-text("No games available")');

  // Wait up to 3 minutes for games to load
  try {
    await Promise.race([
      gameItemLocator.first().waitFor({ state: 'visible', timeout: 180000 }),
      noGamesLocator.waitFor({ state: 'visible', timeout: 180000 }),
    ]);
  } catch {
    throw new Error('Games list did not load within timeout');
  }

  // If no games message appeared, something is wrong
  if (await noGamesLocator.isVisible().catch(() => false)) {
    throw new Error('No games found after creating a game');
  }

  // Click refresh to ensure we see the latest
  const refreshBtn = page.locator('button:has-text("Refresh")');
  if (await refreshBtn.isVisible().catch(() => false)) {
    await refreshBtn.click();
    // Wait for refresh to complete
    await page.waitForTimeout(5000);
  }

  // Find all games and get the highest ID that's in Enrollment phase with 0 participants
  // (newly created games are always in Enrollment phase with 0 participants)
  const count = await gameItemLocator.count();
  let maxEnrollmentGameId = 0;

  for (let i = 0; i < count; i++) {
    const gameItem = gameItemLocator.nth(i);
    const text = await gameItem.textContent();

    // Check if it's in Enrollment phase with 0 participants
    if (text?.includes('Enrollment') && text?.includes('0 /')) {
      const match = text.match(/Game #(\d+)/);
      if (match) {
        const gameId = parseInt(match[1], 10);
        if (gameId > maxEnrollmentGameId) {
          maxEnrollmentGameId = gameId;
        }
      }
    }
  }

  if (maxEnrollmentGameId === 0) {
    throw new Error('Could not find newly created game in Enrollment phase');
  }

  return maxEnrollmentGameId;
}

/**
 * Select a game from the games list
 */
export async function selectGame(page: Page, gameId: number): Promise<void> {
  await navigateToTab(page, 'games');

  // Click refresh to ensure game list is up to date
  const refreshBtn = page.locator('button:has-text("Refresh")');
  if (await refreshBtn.isVisible().catch(() => false)) {
    await refreshBtn.click();
    // Wait for refresh to complete
    await page.waitForTimeout(2000);
  }

  // Wait for the game item to appear (use regex for exact match)
  const gameItem = page.locator('.game-item').filter({
    has: page.locator('.game-id', { hasText: new RegExp(`^Game #${gameId}$`) }),
  });
  await expect(gameItem).toBeVisible({ timeout: TIMEOUTS.transaction });
  await gameItem.click();

  // Wait for game tabs to appear (join tab should be visible after selecting a game)
  await expect(page.locator('[data-testid="tab-join"]')).toBeVisible({
    timeout: TIMEOUTS.gameStatePolling,
  });
}

/**
 * Advance game phase (admin only)
 */
export async function advancePhase(page: Page): Promise<void> {
  await navigateToTab(page, 'admin');

  const advanceBtn = page.locator('[data-testid="advance-phase-button"]');
  await expect(advanceBtn).toBeVisible({ timeout: TIMEOUTS.gameStatePolling });
  await advanceBtn.click();

  // Wait for success
  await expect(page.locator('[data-testid="admin-success"]')).toBeVisible({
    timeout: TIMEOUTS.transaction,
  });
}

/**
 * Wait for a specific game phase
 */
export async function waitForPhase(
  page: Page,
  phaseName: string,
  maxWait: number = 30_000
): Promise<void> {
  // Check the phase banner
  await expect(page.locator('.phase-badge')).toContainText(phaseName, {
    timeout: maxWait,
  });
}

/**
 * Get current phase from UI
 */
export async function getCurrentPhase(page: Page): Promise<string> {
  const phaseBadge = page.locator('.phase-badge');
  const text = await phaseBadge.textContent();
  return text?.replace('Phase: ', '') ?? '';
}

/**
 * Check if user is admin
 */
export async function isAdmin(page: Page): Promise<boolean> {
  const adminTab = page.locator('[data-testid="tab-admin"]');
  return await adminTab.isVisible();
}

/**
 * Setup a player with wallet, contract connection, and passphrase
 */
export async function setupPlayer(
  page: Page,
  contractAddress: string,
  passphrase: string,
  gameId: string = '1'
): Promise<void> {
  await waitForAppReady(page);
  await connectEmbeddedWallet(page);
  await connectToContract(page, contractAddress, gameId);
  await setPassphrase(page, passphrase);
}
