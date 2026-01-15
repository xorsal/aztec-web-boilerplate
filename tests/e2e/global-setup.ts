/**
 * Playwright Global Setup
 *
 * This script runs once before all tests to ensure contracts are deployed.
 * It calls the existing deploy script which handles Dripper, Token, and SecretSanta.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || 'http://localhost:8080';
const CONFIG_PATH = path.join(__dirname, '../../src/config/deployments/sandbox.json');

async function checkSandboxRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${AZTEC_NODE_URL}/status`);
    return response.ok;
  } catch {
    return false;
  }
}

async function checkContractsDeployed(): Promise<boolean> {
  if (!fs.existsSync(CONFIG_PATH)) {
    return false;
  }

  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    // Check if all contracts are deployed
    return !!(
      config.dripperContract?.address &&
      config.tokenContract?.address &&
      config.secretSantaContract?.address
    );
  } catch {
    return false;
  }
}

function runDeployScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('   🚀 Running deploy script...\n');

    const proc = spawn('tsx', ['scripts/deploy.ts', '--network', 'sandbox'], {
      cwd: path.join(__dirname, '../..'),
      stdio: 'inherit',
      env: {
        ...process.env,
        VITE_PROVER_ENABLED: 'false',
      },
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Deploy script exited with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

async function globalSetup() {
  console.log('\n🔧 E2E Test Global Setup');
  console.log(`   Node URL: ${AZTEC_NODE_URL}\n`);

  // Check if sandbox is running
  const sandboxRunning = await checkSandboxRunning();
  if (!sandboxRunning) {
    console.log('⚠️  Sandbox not running - contract tests will be skipped\n');
    return;
  }

  console.log('   ✅ Sandbox is running');

  // Check if contracts are already deployed
  const contractsDeployed = await checkContractsDeployed();
  if (contractsDeployed) {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    console.log(`   ✅ Contracts already deployed`);
    console.log(`      SecretSanta: ${config.secretSantaContract.address}\n`);
    return;
  }

  // Deploy contracts
  try {
    await runDeployScript();
    console.log('\n✅ Global setup complete\n');
  } catch (error) {
    console.error('\n❌ Contract deployment failed:', error);
    console.log('   Contract tests will be skipped\n');
  }
}

export default globalSetup;
