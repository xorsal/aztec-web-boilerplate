/**
 * ClearSigningDemo Component
 *
 * Demonstrates EIP-712 clear signing for Aztec transactions.
 * Shows users the 4-step flow:
 * 1. Connect MetaMask
 * 2. Deploy EIP-712 Account
 * 3. Preview Transaction (shows what MetaMask will display)
 * 4. Execute with Clear Signing
 */

import React, { useState, useCallback } from 'react';
import { useAccount } from '../hooks/useAccount';
import { AddressDisplay } from './AddressDisplay';

// Step states for the demo flow
type DemoStep = 'connect' | 'deploy' | 'preview' | 'execute' | 'complete';

interface StepStatus {
  connect: 'pending' | 'active' | 'completed';
  deploy: 'pending' | 'active' | 'completed';
  preview: 'pending' | 'active' | 'completed';
  execute: 'pending' | 'active' | 'completed';
}

// Sample transaction preview data
interface TransactionPreview {
  functionName: string;
  contract: string;
  arguments: { name: string; value: string }[];
}

const SAMPLE_TRANSACTION: TransactionPreview = {
  functionName: 'transfer_private',
  contract: '0x1234...5678 (Token)',
  arguments: [
    { name: 'from', value: 'Your Address' },
    { name: 'to', value: '0xabcd...ef01' },
    { name: 'amount', value: '1000' },
    { name: 'nonce', value: '0' },
  ],
};

const StepIndicator: React.FC<{
  step: number;
  title: string;
  status: 'pending' | 'active' | 'completed';
}> = ({ step, title, status }) => (
  <div className={`step-indicator step-${status}`}>
    <div className="step-number">
      {status === 'completed' ? (
        <span className="check-icon">OK</span>
      ) : (
        step
      )}
    </div>
    <span className="step-title">{title}</span>
  </div>
);

const ConnectStep: React.FC<{
  onConnect: () => Promise<void>;
  isConnecting: boolean;
}> = ({ onConnect, isConnecting }) => (
  <div className="demo-step-content">
    <h3>Step 1: Connect MetaMask</h3>
    <p>
      Connect your MetaMask wallet to derive your Aztec account.
      Your Ethereum private key will be used to create a secp256k1 signing key.
    </p>
    <button
      className="demo-button primary"
      onClick={onConnect}
      disabled={isConnecting}
    >
      {isConnecting ? 'Connecting...' : 'Connect MetaMask'}
    </button>
  </div>
);

const DeployStep: React.FC<{
  ethAddress: string;
  onDeploy: () => Promise<void>;
  isDeploying: boolean;
}> = ({ ethAddress, onDeploy, isDeploying }) => (
  <div className="demo-step-content">
    <h3>Step 2: Deploy EIP-712 Account</h3>
    <p>
      Deploy your EIP-712 enabled account contract. This account will verify
      typed data signatures, allowing MetaMask to show human-readable
      transaction details.
    </p>
    <div className="demo-info-box">
      <strong>Connected Address:</strong>
      <span className="mono">{ethAddress}</span>
    </div>
    <button
      className="demo-button primary"
      onClick={onDeploy}
      disabled={isDeploying}
    >
      {isDeploying ? 'Deploying...' : 'Deploy Account'}
    </button>
    <p className="demo-note">
      Note: Initial deployment uses personal_sign (fallback).
      Future transactions will use EIP-712 clear signing.
    </p>
  </div>
);

const PreviewStep: React.FC<{
  transaction: TransactionPreview;
  onProceed: () => void;
}> = ({ transaction, onProceed }) => (
  <div className="demo-step-content">
    <h3>Step 3: Transaction Preview</h3>
    <p>
      This is what MetaMask will display when you sign the transaction.
      Unlike raw hash signing, you can see exactly what you're authorizing.
    </p>

    <div className="metamask-preview">
      <div className="metamask-header">
        <span className="metamask-logo">MetaMask</span>
        <span className="metamask-title">Signature Request</span>
      </div>

      <div className="metamask-body">
        <div className="typed-data-section">
          <div className="typed-data-domain">
            <strong>Domain:</strong> Aztec
            <br />
            <strong>Chain ID:</strong> 31337
          </div>

          <div className="typed-data-message">
            <div className="message-type">EntrypointAuthorization</div>
            <div className="function-call">
              <div className="function-name">
                Function: <span className="highlight">{transaction.functionName}</span>
              </div>
              <div className="function-contract">
                Contract: <span className="mono">{transaction.contract}</span>
              </div>
              <div className="function-args">
                <strong>Arguments:</strong>
                <ul>
                  {transaction.arguments.map((arg, idx) => (
                    <li key={idx}>
                      <span className="arg-name">{arg.name}:</span>{' '}
                      <span className="arg-value">{arg.value}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="metamask-footer">
        <button className="mm-button reject">Reject</button>
        <button className="mm-button sign" onClick={onProceed}>
          Sign
        </button>
      </div>
    </div>

    <p className="demo-benefit">
      <strong>Benefits of Clear Signing:</strong>
      <ul>
        <li>See function names instead of raw selectors</li>
        <li>Verify argument values before signing</li>
        <li>Confirm the target contract address</li>
        <li>Understand exactly what you're authorizing</li>
      </ul>
    </p>
  </div>
);

const ExecuteStep: React.FC<{
  onExecute: () => Promise<void>;
  isExecuting: boolean;
}> = ({ onExecute, isExecuting }) => (
  <div className="demo-step-content">
    <h3>Step 4: Execute Transaction</h3>
    <p>
      Now execute the transaction with EIP-712 clear signing.
      MetaMask will show the typed data as previewed above.
    </p>
    <button
      className="demo-button primary"
      onClick={onExecute}
      disabled={isExecuting}
    >
      {isExecuting ? 'Executing...' : 'Execute with Clear Signing'}
    </button>
  </div>
);

const CompleteStep: React.FC<{
  txHash: string;
  onReset: () => void;
}> = ({ txHash, onReset }) => (
  <div className="demo-step-content">
    <h3>Transaction Complete!</h3>
    <div className="demo-success">
      <span className="success-icon">OK</span>
      <p>Your transaction was successfully executed with EIP-712 clear signing.</p>
    </div>
    <div className="demo-info-box">
      <strong>Transaction Hash:</strong>
      <span className="mono">{txHash}</span>
    </div>
    <button className="demo-button secondary" onClick={onReset}>
      Try Another Transaction
    </button>
  </div>
);

export const ClearSigningDemo: React.FC = () => {
  const { wallet, isConnected, ethAddress } = useAccount();
  const [currentStep, setCurrentStep] = useState<DemoStep>('connect');
  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Calculate step statuses
  const getStepStatus = useCallback(
    (step: DemoStep): 'pending' | 'active' | 'completed' => {
      const stepOrder: DemoStep[] = ['connect', 'deploy', 'preview', 'execute', 'complete'];
      const currentIndex = stepOrder.indexOf(currentStep);
      const stepIndex = stepOrder.indexOf(step);

      if (stepIndex < currentIndex) return 'completed';
      if (stepIndex === currentIndex) return 'active';
      return 'pending';
    },
    [currentStep]
  );

  const stepStatus: StepStatus = {
    connect: getStepStatus('connect'),
    deploy: getStepStatus('deploy'),
    preview: getStepStatus('preview'),
    execute: getStepStatus('execute'),
  };

  // Handlers
  const handleConnect = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Connection is handled by the wallet hook
      // Just advance to next step if already connected
      if (isConnected) {
        setCurrentStep('deploy');
      } else {
        // Trigger wallet connection through the account hook
        setError('Please connect your wallet using the header button');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeploy = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // In a real implementation, this would:
      // 1. Create Eip712AccountContract with public key
      // 2. Deploy via AccountManager
      // For demo, we'll simulate
      await new Promise((resolve) => setTimeout(resolve, 2000));
      setCurrentStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deployment failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleProceed = () => {
    setCurrentStep('execute');
  };

  const handleExecute = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // In a real implementation, this would:
      // 1. Set pending tx context on Eip712AuthWitnessProvider
      // 2. Call wallet method (triggers EIP-712 signing)
      // 3. Clear context after tx
      await new Promise((resolve) => setTimeout(resolve, 2000));
      setTxHash('0x' + Array(64).fill(0).map(() =>
        Math.floor(Math.random() * 16).toString(16)
      ).join(''));
      setCurrentStep('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Execution failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setCurrentStep(isConnected ? 'deploy' : 'connect');
    setTxHash('');
    setError(null);
  };

  // Update step if wallet connection state changes
  React.useEffect(() => {
    if (isConnected && currentStep === 'connect') {
      setCurrentStep('deploy');
    }
  }, [isConnected, currentStep]);

  return (
    <div className="clear-signing-demo">
      <div className="demo-header">
        <h2>EIP-712 Clear Signing Demo</h2>
        <p>
          Experience human-readable transaction signing for Aztec Protocol.
          See exactly what you're authorizing before you sign.
        </p>
      </div>

      {/* Progress Steps */}
      <div className="demo-progress">
        <StepIndicator step={1} title="Connect" status={stepStatus.connect} />
        <div className="step-connector" />
        <StepIndicator step={2} title="Deploy" status={stepStatus.deploy} />
        <div className="step-connector" />
        <StepIndicator step={3} title="Preview" status={stepStatus.preview} />
        <div className="step-connector" />
        <StepIndicator step={4} title="Execute" status={stepStatus.execute} />
      </div>

      {/* Error Display */}
      {error && (
        <div className="demo-error">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Step Content */}
      <div className="demo-content">
        {currentStep === 'connect' && (
          <ConnectStep onConnect={handleConnect} isConnecting={isLoading} />
        )}
        {currentStep === 'deploy' && (
          <DeployStep
            ethAddress={ethAddress || '0x...'}
            onDeploy={handleDeploy}
            isDeploying={isLoading}
          />
        )}
        {currentStep === 'preview' && (
          <PreviewStep
            transaction={SAMPLE_TRANSACTION}
            onProceed={handleProceed}
          />
        )}
        {currentStep === 'execute' && (
          <ExecuteStep onExecute={handleExecute} isExecuting={isLoading} />
        )}
        {currentStep === 'complete' && (
          <CompleteStep txHash={txHash} onReset={handleReset} />
        )}
      </div>

      {/* Info Section */}
      <div className="demo-info">
        <h4>How It Works</h4>
        <div className="info-grid">
          <div className="info-item">
            <span className="info-icon">1</span>
            <div>
              <strong>EIP-712 Typed Data</strong>
              <p>Transaction details are structured as typed data that MetaMask can display.</p>
            </div>
          </div>
          <div className="info-item">
            <span className="info-icon">2</span>
            <div>
              <strong>Human-Readable</strong>
              <p>Function names, arguments, and contract addresses are shown clearly.</p>
            </div>
          </div>
          <div className="info-item">
            <span className="info-icon">3</span>
            <div>
              <strong>Capsule Delivery</strong>
              <p>Signed data is injected via capsule oracle for the Noir contract to verify.</p>
            </div>
          </div>
          <div className="info-item">
            <span className="info-icon">4</span>
            <div>
              <strong>ECDSA Verification</strong>
              <p>The account contract verifies the signature matches the typed data hash.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClearSigningDemo;
