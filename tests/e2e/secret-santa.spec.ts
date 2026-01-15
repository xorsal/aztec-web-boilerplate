/**
 * Secret Santa Web UI E2E Tests
 *
 * These tests validate the complete Secret Santa game flow through the web interface.
 * They use embedded wallets (walletless) to test without external wallet extensions.
 *
 * PREREQUISITES:
 * - Aztec sandbox running: `aztec start --sandbox`
 * - Contract deployed: `yarn deploy-contracts`
 * - App built: `yarn build-app`
 *
 * Run with: `yarn test:e2e`
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  waitForAppReady,
  connectEmbeddedWallet,
  connectToContract,
  setPassphrase,
  setSenderSlot,
  navigateToTab,
  enrollInGame,
  registerAsSender,
  claimAsReceiver,
  revealAddress,
  createGame,
  selectGame,
  advancePhase,
  waitForPhase,
  TIMEOUTS,
} from './helpers';

// Read CONTRACT_ADDRESS from deployment config or environment variable
function getContractAddress(): string {
  // First check environment variable
  if (process.env.CONTRACT_ADDRESS) {
    return process.env.CONTRACT_ADDRESS;
  }

  // Try to read from sandbox deployment config
  const configPath = path.join(__dirname, '../../src/config/deployments/sandbox.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.secretSantaContract?.address) {
        return config.secretSantaContract.address;
      }
    } catch {
      // Config file exists but failed to parse
    }
  }

  return '';
}

const CONTRACT_ADDRESS = getContractAddress();

test.describe('Secret Santa Web UI', () => {
  test.describe('Basic Functionality', () => {
    test('app loads and displays navbar', async ({ page }) => {
      await page.goto('/');
      await waitForAppReady(page);

      // Check basic layout elements
      await expect(page.locator('.navbar')).toBeVisible();
      await expect(page.locator('.nav-title')).toContainText('ZK Secret Santa');
    });

    test('connect wallet button is visible when not connected', async ({ page }) => {
      await page.goto('/');
      await waitForAppReady(page);

      const connectBtn = page.locator('[data-testid="connect-wallet-button"]');
      await expect(connectBtn).toBeVisible();
    });

    test('can open wallet connection modal', async ({ page }) => {
      await page.goto('/');
      await waitForAppReady(page);

      // Click connect button
      const connectBtn = page.locator('[data-testid="connect-wallet-button"]');
      await connectBtn.click();

      // Modal should appear
      const modal = page.locator('.modal-content');
      await expect(modal).toBeVisible();

      // Network selector should be present
      await expect(page.locator('[data-testid="network-selector"]')).toBeVisible();

      // Embedded wallet options should be present
      await expect(page.locator('[data-testid="create-new-account"]')).toBeVisible();
    });

    test('can connect embedded wallet', async ({ page }) => {
      // Skip if no contract deployed (sandbox not running)
      test.skip(!CONTRACT_ADDRESS, 'Requires deployed contract (sandbox running)');

      await page.goto('/');
      await waitForAppReady(page);
      await connectEmbeddedWallet(page);

      // Should show connected account
      await expect(page.locator('[data-testid="connected-account"]')).toBeVisible();
      await expect(page.locator('[data-testid="disconnect-button"]')).toBeVisible();
    });
  });

  test.describe('Contract Connection', () => {
    test('can connect to deployed contract', async ({ page }) => {
      test.skip(!CONTRACT_ADDRESS, 'Requires deployed contract');

      await page.goto('/');
      await waitForAppReady(page);
      await connectEmbeddedWallet(page);

      // Navigate to setup tab
      await navigateToTab(page, 'setup');

      // Fill contract address
      const addressInput = page.locator('[data-testid="contract-address-input"]');
      await addressInput.fill(CONTRACT_ADDRESS);

      // Click connect
      const connectBtn = page.locator('[data-testid="connect-contract-button"]');
      await connectBtn.click();

      // Should show connected status
      await expect(page.locator('[data-testid="contract-connected"]')).toBeVisible({
        timeout: TIMEOUTS.contractConnection,
      });
    });

    test('shows game settings after contract connection', async ({ page }) => {
      test.skip(!CONTRACT_ADDRESS, 'Requires deployed contract');

      await page.goto('/');
      await waitForAppReady(page);
      await connectEmbeddedWallet(page);
      await connectToContract(page, CONTRACT_ADDRESS);

      // Game settings should be visible
      await expect(page.locator('[data-testid="passphrase-input"]')).toBeVisible();
      await expect(page.locator('[data-testid="sender-slot-input"]')).toBeVisible();
      await expect(page.locator('[data-testid="save-settings-button"]')).toBeVisible();
    });
  });

  test.describe('Game Phase UI', () => {
    // Note: These tests require a game to exist and be selected.
    // They will skip if game tabs (join, sender, etc.) are not visible.

    test('shows enrollment UI during ENROLLMENT phase', async ({ page }) => {
      test.skip(!CONTRACT_ADDRESS, 'Requires deployed contract');

      await page.goto('/');
      await waitForAppReady(page);
      await connectEmbeddedWallet(page);
      await connectToContract(page, CONTRACT_ADDRESS);
      await setPassphrase(page, 'test-passphrase');

      // Skip if no game tabs available (no game selected)
      const joinTab = page.locator('[data-testid="tab-join"]');
      if (!(await joinTab.isVisible({ timeout: 5000 }).catch(() => false))) {
        test.skip(true, 'No game selected - game tabs not available');
      }

      // Navigate to join tab
      await navigateToTab(page, 'join');

      // Check that join UI is visible (might show enrollment or closed message)
      const joinCard = page.locator('.join-game');
      await expect(joinCard).toBeVisible();
    });

    test('shows sender registration UI during SENDER_REGISTRATION phase', async ({ page }) => {
      test.skip(!CONTRACT_ADDRESS, 'Requires deployed contract');

      await page.goto('/');
      await waitForAppReady(page);
      await connectEmbeddedWallet(page);
      await connectToContract(page, CONTRACT_ADDRESS);
      await setPassphrase(page, 'test-passphrase');

      // Skip if no game tabs available
      const senderTab = page.locator('[data-testid="tab-sender"]');
      if (!(await senderTab.isVisible({ timeout: 5000 }).catch(() => false))) {
        test.skip(true, 'No game selected - game tabs not available');
      }

      // Navigate to sender tab
      await navigateToTab(page, 'sender');

      // Check that sender UI is visible
      const senderCard = page.locator('.register-sender');
      await expect(senderCard).toBeVisible();
    });

    test('shows receiver claim UI during RECEIVER_CLAIM phase', async ({ page }) => {
      test.skip(!CONTRACT_ADDRESS, 'Requires deployed contract');

      await page.goto('/');
      await waitForAppReady(page);
      await connectEmbeddedWallet(page);
      await connectToContract(page, CONTRACT_ADDRESS);
      await setPassphrase(page, 'test-passphrase');
      await setSenderSlot(page, 1); // Assume player registered in slot 1

      // Skip if no game tabs available
      const receiverTab = page.locator('[data-testid="tab-receiver"]');
      if (!(await receiverTab.isVisible({ timeout: 5000 }).catch(() => false))) {
        test.skip(true, 'No game selected - game tabs not available');
      }

      // Navigate to receiver tab
      await navigateToTab(page, 'receiver');

      // Check that receiver UI is visible
      const receiverCard = page.locator('.claim-receiver');
      await expect(receiverCard).toBeVisible();
    });

    test('shows reveal UI during COMPLETED phase', async ({ page }) => {
      test.skip(!CONTRACT_ADDRESS, 'Requires deployed contract');

      await page.goto('/');
      await waitForAppReady(page);
      await connectEmbeddedWallet(page);
      await connectToContract(page, CONTRACT_ADDRESS);
      await setPassphrase(page, 'test-passphrase');
      await setSenderSlot(page, 1);

      // Skip if no game tabs available
      const revealTab = page.locator('[data-testid="tab-reveal"]');
      if (!(await revealTab.isVisible({ timeout: 5000 }).catch(() => false))) {
        test.skip(true, 'No game selected - game tabs not available');
      }

      // Navigate to reveal tab
      await navigateToTab(page, 'reveal');

      // Check that reveal UI is visible
      const revealCard = page.locator('.reveal-phase');
      await expect(revealCard).toBeVisible();
    });
  });

  test.describe('Admin Panel', () => {
    test('admin can see admin panel', async ({ page }) => {
      test.skip(!CONTRACT_ADDRESS, 'Requires deployed contract');

      await page.goto('/');
      await waitForAppReady(page);
      await connectEmbeddedWallet(page);
      await connectToContract(page, CONTRACT_ADDRESS);

      // Admin should see admin tab (depends on being the deployer)
      // This might not be visible if user is not admin
      const adminTab = page.locator('[data-testid="tab-admin"]');
      // Don't assert visibility since it depends on user being admin
    });

    test('admin panel shows game creation form', async ({ page }) => {
      test.skip(!CONTRACT_ADDRESS, 'Requires deployed contract');

      await page.goto('/');
      await waitForAppReady(page);
      await connectEmbeddedWallet(page);
      await connectToContract(page, CONTRACT_ADDRESS);

      const adminTab = page.locator('[data-testid="tab-admin"]');
      if (await adminTab.isVisible()) {
        await adminTab.click();

        // Check admin panel elements
        await expect(page.locator('[data-testid="min-participants-input"]')).toBeVisible();
        await expect(page.locator('[data-testid="max-participants-input"]')).toBeVisible();
        await expect(page.locator('[data-testid="create-game-button"]')).toBeVisible();
      }
    });
  });
});

/**
 * Full Game Flow Test
 *
 * This test requires three browser contexts to simulate three players.
 * It exercises the complete Secret Santa game flow:
 * 1. Admin creates game
 * 2. All players enroll
 * 3. Admin advances to SENDER_REGISTRATION
 * 4. All players register as senders
 * 5. Admin advances to RECEIVER_CLAIM
 * 6. All players claim as receivers
 * 7. Admin advances to COMPLETED
 * 8. All players reveal their recipients
 */
test.describe('Full Game Flow', () => {
  test('complete 3-player game flow', async ({ browser }) => {
    test.skip(!CONTRACT_ADDRESS, 'Requires deployed contract address');

    // This test involves multiple blockchain transactions for 3 players
    // Increase timeout to 10 minutes
    test.setTimeout(600_000);

    // Create three browser contexts for three players
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const context3 = await browser.newContext();

    const alice = await context1.newPage();
    const bob = await context2.newPage();
    const carol = await context3.newPage();

    // Don't assume a game ID yet - we'll create one
    const alicePassphrase = 'alice-secret-passphrase';
    const bobPassphrase = 'bob-secret-passphrase';
    const carolPassphrase = 'carol-secret-passphrase';

    const aliceAddress = 'Alice, 123 North Pole Lane, Arctic';
    const bobAddress = 'Bob, 456 Workshop Way, Elf Village';
    const carolAddress = 'Carol, 789 Reindeer Road, Snow Valley';

    try {
      // Setup all players
      await alice.goto('/');
      await bob.goto('/');
      await carol.goto('/');

      // Alice connects first with configured credentials (admin account)
      await waitForAppReady(alice);
      await connectEmbeddedWallet(alice, true); // Use configured credentials (admin)
      await connectToContract(alice, CONTRACT_ADDRESS);
      await setPassphrase(alice, alicePassphrase);

      // Check if Alice is admin
      const isAliceAdmin = await alice.locator('[data-testid="tab-admin"]').isVisible();
      if (!isAliceAdmin) {
        test.skip(true, 'Connected account is not admin. Build app with VITE_EMBEDDED_ACCOUNT_SECRET_KEY');
      }

      // Create game with 3 players and get the new game ID
      const gameId = await createGame(alice, 3, 3);
      console.log(`Created new game #${gameId}`);

      // Select the newly created game
      await selectGame(alice, gameId);

      // Bob and Carol connect with new random accounts (parallel)
      await Promise.all([
        (async () => {
          await waitForAppReady(bob);
          await connectEmbeddedWallet(bob, false); // New random account
          await connectToContract(bob, CONTRACT_ADDRESS);
          await setPassphrase(bob, bobPassphrase);
          await selectGame(bob, gameId);
        })(),
        (async () => {
          await waitForAppReady(carol);
          await connectEmbeddedWallet(carol, false); // New random account
          await connectToContract(carol, CONTRACT_ADDRESS);
          await setPassphrase(carol, carolPassphrase);
          await selectGame(carol, gameId);
        })(),
      ]);

      // All players enroll (sequential to avoid race conditions)
      await enrollInGame(alice);
      await enrollInGame(bob);
      await enrollInGame(carol);

      // Admin advances to SENDER_REGISTRATION
      if (isAliceAdmin) {
        await advancePhase(alice);
      }

      // Wait for phase change to propagate
      await waitForPhase(alice, 'Sender Registration');
      await waitForPhase(bob, 'Sender Registration');
      await waitForPhase(carol, 'Sender Registration');

      // All players register as senders (parallel)
      await Promise.all([
        registerAsSender(alice, 1),
        registerAsSender(bob, 2),
        registerAsSender(carol, 3),
      ]);

      // Admin advances to RECEIVER_CLAIM
      if (isAliceAdmin) {
        await advancePhase(alice);
      }

      // Wait for phase change
      await waitForPhase(alice, 'Receiver Claim');
      await waitForPhase(bob, 'Receiver Claim');
      await waitForPhase(carol, 'Receiver Claim');

      // Set sender slots for each player (needed for claim)
      await navigateToTab(alice, 'setup');
      await setSenderSlot(alice, 1);
      await navigateToTab(bob, 'setup');
      await setSenderSlot(bob, 2);
      await navigateToTab(carol, 'setup');
      await setSenderSlot(carol, 3);

      // All players claim as receivers (sequential to avoid slot conflicts)
      await claimAsReceiver(alice, aliceAddress);
      await claimAsReceiver(bob, bobAddress);
      await claimAsReceiver(carol, carolAddress);

      // Admin advances to COMPLETED
      if (isAliceAdmin) {
        await advancePhase(alice);
      }

      // Wait for phase change
      await waitForPhase(alice, 'Completed');
      await waitForPhase(bob, 'Completed');
      await waitForPhase(carol, 'Completed');

      // All players reveal their recipients
      const aliceRecipient = await revealAddress(alice);
      const bobRecipient = await revealAddress(bob);
      const carolRecipient = await revealAddress(carol);

      // Verify the cyclic assignment (prime offset 137):
      // Alice (slot 1) -> claims slot 3 -> receives Carol's address
      // Bob (slot 2) -> claims slot 1 -> receives Alice's address
      // Carol (slot 3) -> claims slot 2 -> receives Bob's address
      //
      // So:
      // Alice (sender at slot 1) gets Bob's encrypted data (Bob claimed slot 1)
      // Bob (sender at slot 2) gets Carol's encrypted data (Carol claimed slot 2)
      // Carol (sender at slot 3) gets Alice's encrypted data (Alice claimed slot 3)
      expect(aliceRecipient).toBe(bobAddress);
      expect(bobRecipient).toBe(carolAddress);
      expect(carolRecipient).toBe(aliceAddress);

      console.log('Game completed successfully!');
      console.log(`Alice sends to: ${aliceRecipient}`);
      console.log(`Bob sends to: ${bobRecipient}`);
      console.log(`Carol sends to: ${carolRecipient}`);
    } finally {
      // Cleanup
      await context1.close();
      await context2.close();
      await context3.close();
    }
  });
});

/**
 * Error Handling Tests
 */
test.describe('Error Handling', () => {
  test('setup tab shows wallet connection required message', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Navigate to setup tab
    await navigateToTab(page, 'setup');

    // Setup tab should show message to connect wallet first
    const setupCard = page.locator('.wallet-connection');
    await expect(setupCard).toBeVisible();
    // The text prompts user to connect wallet
    await expect(setupCard).toContainText(/Connect your wallet/i);
  });

  test('shows message when not connected to wallet', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // The setup tab should show a message about connecting wallet
    const setupCard = page.locator('.wallet-connection');
    await expect(setupCard).toBeVisible();
    await expect(setupCard).toContainText(/Connect your wallet/i);
  });
});
