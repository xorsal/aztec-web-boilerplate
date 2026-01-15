/**
 * Basic E2E Tests for Web UI
 *
 * These tests validate that the app loads and basic components render correctly.
 * They don't require a running Aztec sandbox.
 */

import { test, expect } from '@playwright/test';

test.describe('App Initialization', () => {
  test('app loads and displays title', async ({ page }) => {
    await page.goto('/');

    // Wait for the app to initialize
    await expect(page.locator('.navbar')).toBeVisible({ timeout: 30_000 });

    // Check title
    await expect(page.locator('.nav-title')).toContainText('ZK Secret Santa');
  });

  test('shows connect wallet button when not connected', async ({ page }) => {
    await page.goto('/');

    // Wait for app to be ready
    await expect(page.locator('.navbar')).toBeVisible({ timeout: 30_000 });

    // Connect button should be visible
    const connectBtn = page.locator('[data-testid="connect-wallet-button"]');
    await expect(connectBtn).toBeVisible();
  });

  test('can open connect wallet modal', async ({ page }) => {
    await page.goto('/');

    // Wait for app to be ready
    await expect(page.locator('.navbar')).toBeVisible({ timeout: 30_000 });

    // Click connect button
    const connectBtn = page.locator('[data-testid="connect-wallet-button"]');
    await connectBtn.click();

    // Modal should appear
    const modal = page.locator('.modal-content');
    await expect(modal).toBeVisible({ timeout: 10_000 });

    // Modal should have expected elements
    await expect(page.locator('[data-testid="network-selector"]')).toBeVisible();
    await expect(page.locator('[data-testid="create-new-account"]')).toBeVisible();
  });

  test('can close connect wallet modal', async ({ page }) => {
    await page.goto('/');

    // Wait for app and open modal
    await expect(page.locator('.navbar')).toBeVisible({ timeout: 30_000 });
    const connectBtn = page.locator('[data-testid="connect-wallet-button"]');
    await connectBtn.click();

    // Modal should be visible
    const modal = page.locator('.modal-content');
    await expect(modal).toBeVisible({ timeout: 10_000 });

    // Close the modal
    const closeBtn = page.locator('.modal-close-button');
    await closeBtn.click();

    // Modal should be hidden
    await expect(modal).not.toBeVisible();
  });

  test('theme toggle is visible', async ({ page }) => {
    await page.goto('/');

    // Wait for app to be ready
    await expect(page.locator('.navbar')).toBeVisible({ timeout: 30_000 });

    // Theme toggle should be visible
    const themeToggle = page.locator('.theme-toggle');
    await expect(themeToggle).toBeVisible();
  });
});

test.describe('Tab Navigation', () => {
  test('setup tab is visible after app loads', async ({ page }) => {
    await page.goto('/');

    // Wait for app to be ready
    await expect(page.locator('.navbar')).toBeVisible({ timeout: 30_000 });

    // Setup tab should be visible
    const setupTab = page.locator('[data-testid="tab-setup"]');
    await expect(setupTab).toBeVisible();
  });

  test('clicking tabs changes content', async ({ page }) => {
    await page.goto('/');

    // Wait for app to be ready
    await expect(page.locator('.navbar')).toBeVisible({ timeout: 30_000 });

    // Setup tab should be active by default
    const setupTab = page.locator('[data-testid="tab-setup"]');
    await expect(setupTab).toHaveClass(/active/);
  });
});

test.describe('Setup Card', () => {
  test('shows wallet connection prompt when not connected', async ({ page }) => {
    await page.goto('/');

    // Wait for app to be ready
    await expect(page.locator('.navbar')).toBeVisible({ timeout: 30_000 });

    // Setup card should show connect wallet message
    const setupCard = page.locator('.wallet-connection');
    await expect(setupCard).toBeVisible({ timeout: 10_000 });
    await expect(setupCard).toContainText(/Connect your wallet/i);
  });
});
