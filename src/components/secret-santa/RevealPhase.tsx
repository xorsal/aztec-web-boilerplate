/**
 * RevealPhase Component
 *
 * Displays the reveal phase where senders can view their recipient's delivery address.
 */

import React, { useState } from 'react';
import { deriveSigningKey } from '@aztec/stdlib/keys';
import { useSecretSanta } from '../../hooks/context/useSecretSanta';
import { useUniversalWallet } from '../../hooks/context/useUniversalWallet';
import { PHASE, PHASE_NAMES } from '../../providers/SecretSantaProvider';
import { decryptDeliveryData, isEncryptedDataEmpty } from '../../utils/crypto';

export const RevealPhase: React.FC = () => {
  const {
    contract,
    gameId,
    gameState,
    senderSlot,
    secretKey,
  } = useSecretSanta();
  const { account, isConnected } = useUniversalWallet();
  const [deliveryAddress, setDeliveryAddress] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReveal = async () => {
    if (!contract || !account || !secretKey || !senderSlot) {
      setError('Missing required data');
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      // Get encrypted delivery data for our slot
      const encryptedData = await contract.methods
        .get_slot_delivery_data(gameId, BigInt(senderSlot))
        .simulate({ from: account.getAddress() });

      if (isEncryptedDataEmpty(encryptedData)) {
        setError('No delivery data found for your slot');
        return;
      }

      // Decrypt using our private key
      const privateKey = deriveSigningKey(secretKey);
      const decrypted = await decryptDeliveryData(encryptedData, privateKey);
      setDeliveryAddress(decrypted);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reveal address');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="card reveal-phase">
        <h2>Reveal Recipient</h2>
        <p>Connect your wallet to view your recipient's address.</p>
      </div>
    );
  }

  if (!gameState) {
    return (
      <div className="card reveal-phase">
        <h2>Reveal Recipient</h2>
        <p>Loading game state...</p>
      </div>
    );
  }

  if (senderSlot === null) {
    return (
      <div className="card reveal-phase">
        <h2>Reveal Recipient</h2>
        <p className="warning">
          Please enter your sender slot in the settings to view your recipient.
        </p>
      </div>
    );
  }

  if (!secretKey) {
    return (
      <div className="card reveal-phase">
        <h2>Reveal Recipient</h2>
        <p className="warning">
          Please enter your passphrase in the settings to decrypt the address.
        </p>
      </div>
    );
  }

  const isCompleted = gameState.phase === PHASE.COMPLETED;

  return (
    <div className="card reveal-phase">
      <h2>Reveal Recipient</h2>

      <div className="game-info">
        <div className="info-row">
          <span className="label">Phase:</span>
          <span className="value">{PHASE_NAMES[gameState.phase]}</span>
        </div>
        <div className="info-row">
          <span className="label">Your Sender Slot:</span>
          <span className="value highlight">{senderSlot}</span>
        </div>
      </div>

      {error && <div className="error-message" data-testid="reveal-error">{error}</div>}

      {isCompleted ? (
        <>
          {deliveryAddress ? (
            <div className="delivery-result" data-testid="delivery-result">
              <h3>Your Recipient's Delivery Address:</h3>
              <div className="address-box" data-testid="revealed-address">{deliveryAddress}</div>
              <p className="success">
                Send your gift to this address! Remember to keep the sender anonymous.
              </p>
            </div>
          ) : (
            <>
              <p>
                The game is complete! Click below to reveal your recipient's delivery address.
              </p>
              <button
                className="btn-primary"
                data-testid="reveal-button"
                onClick={handleReveal}
                disabled={isLoading}
              >
                {isLoading ? 'Decrypting...' : 'Reveal Address'}
              </button>
            </>
          )}
        </>
      ) : (
        <p className="info" data-testid="reveal-not-active">
          The reveal phase will be available when the game is completed.
          Current phase: {PHASE_NAMES[gameState.phase]}
        </p>
      )}
    </div>
  );
};
