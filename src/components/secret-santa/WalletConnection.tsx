/**
 * WalletConnection Component
 *
 * Handles wallet connection and contract setup for Secret Santa.
 */

import React, { useState } from 'react';
import { useSecretSanta } from '../../hooks/context/useSecretSanta';
import { useUniversalWallet } from '../../hooks/context/useUniversalWallet';

export const WalletConnection: React.FC = () => {
  const { isConnected, isInitialized } = useUniversalWallet();
  const {
    isContractConnected,
    contractAddress,
    setContractAddress,
    gameId,
    setGameId,
    senderSlot,
    setSenderSlot,
    setSecretKeyFromPassphrase,
    connectToContract,
    isLoading,
    error,
    clearError,
  } = useSecretSanta();

  const [localContractAddress, setLocalContractAddress] = useState(
    contractAddress || ''
  );
  const [localGameId, setLocalGameId] = useState(String(gameId));
  const [passphrase, setPassphrase] = useState('');
  const [localSenderSlot, setLocalSenderSlot] = useState(
    senderSlot ? String(senderSlot) : ''
  );
  const [settingsSaved, setSettingsSaved] = useState(false);

  const handleConnect = async () => {
    if (!localContractAddress) return;
    clearError();
    await connectToContract(localContractAddress);
    if (localGameId) {
      setGameId(BigInt(localGameId));
    }
  };

  const handleSaveSettings = async () => {
    if (passphrase) {
      await setSecretKeyFromPassphrase(passphrase);
    }
    if (localSenderSlot) {
      setSenderSlot(Number(localSenderSlot));
    }
    if (localGameId) {
      setGameId(BigInt(localGameId));
    }
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 3000);
  };

  if (!isConnected || !isInitialized) {
    return (
      <div className="card wallet-connection">
        <h2>Setup</h2>
        <p>Connect your wallet using the button in the header to get started.</p>
      </div>
    );
  }

  return (
    <div className="card wallet-connection">
      <h2>Secret Santa Setup</h2>

      {error && <div className="error-message">{error}</div>}
      {settingsSaved && <div className="success-message">Settings saved!</div>}

      <div className="form-group">
        <label htmlFor="contract-address">Contract Address:</label>
        <input
          type="text"
          id="contract-address"
          data-testid="contract-address-input"
          value={localContractAddress}
          onChange={(e) => setLocalContractAddress(e.target.value)}
          placeholder="0x..."
        />
      </div>

      <div className="form-group">
        <label htmlFor="game-id">Game ID:</label>
        <input
          type="number"
          id="game-id"
          data-testid="game-id-input"
          value={localGameId}
          onChange={(e) => setLocalGameId(e.target.value)}
          placeholder="1"
          min={1}
        />
      </div>

      {!isContractConnected && (
        <button
          className="btn-primary"
          data-testid="connect-contract-button"
          onClick={handleConnect}
          disabled={isLoading || !localContractAddress}
        >
          {isLoading ? 'Connecting...' : 'Connect to Contract'}
        </button>
      )}

      {isContractConnected && (
        <>
          <div className="connection-status success" data-testid="contract-connected">
            Connected to contract!
          </div>

          <hr />

          <h3>Game Settings</h3>

          <div className="form-group">
            <label htmlFor="passphrase">
              Passphrase (for encryption/decryption):
            </label>
            <input
              type="password"
              id="passphrase"
              data-testid="passphrase-input"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Enter your secret passphrase..."
            />
            <p className="help-text">
              Used to derive your encryption key for receiving gifts.
            </p>
          </div>

          <div className="form-group">
            <label htmlFor="sender-slot">Your Sender Slot (if registered):</label>
            <input
              type="number"
              id="sender-slot"
              data-testid="sender-slot-input"
              value={localSenderSlot}
              onChange={(e) => setLocalSenderSlot(e.target.value)}
              placeholder="Enter your slot number"
              min={1}
            />
            <p className="help-text">
              Enter the slot you registered as sender to view your recipient.
            </p>
          </div>

          <button
            className="btn-secondary"
            data-testid="save-settings-button"
            onClick={handleSaveSettings}
            disabled={isLoading}
          >
            Save Settings
          </button>
        </>
      )}
    </div>
  );
};
