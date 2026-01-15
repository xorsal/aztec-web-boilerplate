/**
 * RegisterSender Component
 *
 * Allows enrolled participants to claim a sender slot during the sender registration phase.
 */

import React, { useState } from 'react';
import { Fr, Fq } from '@aztec/foundation/curves/bn254';
import { deriveSigningKey, derivePublicKeyFromSecretKey } from '@aztec/stdlib/keys';
import { useSecretSanta } from '../../hooks/context/useSecretSanta';
import { useUniversalWallet } from '../../hooks/context/useUniversalWallet';
import { useWriteContract } from '../../hooks/contracts/useWriteContract';
import { SecretSantaContract } from '../../artifacts/SecretSanta';
import { PHASE, PHASE_NAMES } from '../../providers/SecretSantaProvider';

export const RegisterSender: React.FC = () => {
  const {
    contract,
    contractAddress,
    gameId,
    gameState,
    secretKey,
    senderSlot,
    setSenderSlot,
    getAvailableSlots,
    refreshGameState,
  } = useSecretSanta();
  const { account, isConnected } = useUniversalWallet();
  const { writeContract, isPending } = useWriteContract();
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const availableSlots = getAvailableSlots();

  const handleRegister = async () => {
    if (!contract || !contractAddress || !account || !secretKey) {
      setError('Wallet, contract, or secret key not available');
      return;
    }

    if (!selectedSlot) {
      setError('Please select a slot');
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      // Derive encryption public key from secret key
      const signingKey = deriveSigningKey(secretKey);
      const publicKey = await derivePublicKeyFromSecretKey(signingKey);

      const encryptionKey = {
        x: new Fr(publicKey.x.toBigInt()),
        y: new Fr(publicKey.y.toBigInt()),
        is_infinite: publicKey.isInfinite,
      };

      const result = await writeContract({
        contract: SecretSantaContract,
        address: contractAddress,
        functionName: 'register_as_sender',
        args: [gameId, selectedSlot, encryptionKey],
      });

      if (result.success) {
        setSenderSlot(selectedSlot);
        setSuccess(`Successfully registered as sender in slot ${selectedSlot}!`);
        await refreshGameState();
      } else {
        setError(result.error || 'Failed to register');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register');
    }
  };

  if (!isConnected) {
    return (
      <div className="card register-sender">
        <h2>Register as Sender</h2>
        <p>Connect your wallet to register as a sender.</p>
      </div>
    );
  }

  if (!gameState) {
    return (
      <div className="card register-sender">
        <h2>Register as Sender</h2>
        <p>Loading game state...</p>
      </div>
    );
  }

  if (!secretKey) {
    return (
      <div className="card register-sender">
        <h2>Register as Sender</h2>
        <p className="warning">
          Please enter your passphrase in the settings to generate your secret key.
        </p>
      </div>
    );
  }

  const isRegistrationPhase = gameState.phase === PHASE.SENDER_REGISTRATION;
  const alreadyRegistered = senderSlot !== null;

  return (
    <div className="card register-sender">
      <h2>Register as Sender</h2>

      <div className="game-info">
        <div className="info-row">
          <span className="label">Phase:</span>
          <span className="value">{PHASE_NAMES[gameState.phase]}</span>
        </div>
        <div className="info-row">
          <span className="label">Registered Senders:</span>
          <span className="value">
            {gameState.senderCount} / {gameState.maxParticipants}
          </span>
        </div>
        {alreadyRegistered && (
          <div className="info-row">
            <span className="label">Your Slot:</span>
            <span className="value highlight">{senderSlot}</span>
          </div>
        )}
      </div>

      {/* Slots Grid */}
      <div className="slots-section">
        <h3>Slots</h3>
        <div className="slots-grid">
          {Array.from({ length: gameState.maxParticipants }, (_, i) => {
            const slot = i + 1;
            const isClaimed = gameState.senderSlots.includes(slot);
            const isSelected = selectedSlot === slot;
            const isMySlot = senderSlot === slot;

            return (
              <div
                key={slot}
                className={`slot ${isClaimed ? 'claimed' : 'available'} ${isSelected ? 'selected' : ''} ${isMySlot ? 'mine' : ''}`}
                onClick={() => !isClaimed && isRegistrationPhase && setSelectedSlot(slot)}
                title={
                  isMySlot
                    ? 'Your slot'
                    : isClaimed
                      ? 'Already claimed'
                      : 'Click to select'
                }
              >
                {slot}
              </div>
            );
          })}
        </div>
        <div className="legend">
          <span className="legend-item available">Available</span>
          <span className="legend-item claimed">Claimed</span>
          <span className="legend-item mine">Your Slot</span>
        </div>
      </div>

      {error && <div className="error-message" data-testid="register-error">{error}</div>}
      {success && <div className="success-message" data-testid="register-success">{success}</div>}

      {isRegistrationPhase ? (
        alreadyRegistered ? (
          <p className="success" data-testid="already-registered">
            You are registered as sender in slot {senderSlot}!
          </p>
        ) : availableSlots.length === 0 ? (
          <p className="warning" data-testid="all-slots-taken">All slots are taken!</p>
        ) : (
          <>
            <div className="form-group">
              <label htmlFor="slot-select">Select a slot:</label>
              <select
                id="slot-select"
                data-testid="slot-select"
                value={selectedSlot || ''}
                onChange={(e) => setSelectedSlot(Number(e.target.value))}
              >
                <option value="">Choose a slot...</option>
                {availableSlots.map((slot) => (
                  <option key={slot} value={slot}>
                    Slot {slot}
                  </option>
                ))}
              </select>
            </div>
            <button
              className="btn-primary"
              data-testid="register-button"
              onClick={handleRegister}
              disabled={isPending || !selectedSlot}
            >
              {isPending ? 'Registering...' : 'Register as Sender'}
            </button>
          </>
        )
      ) : (
        <p className="info" data-testid="registration-not-active">
          Sender registration is not active. Current phase:{' '}
          {PHASE_NAMES[gameState.phase]}
        </p>
      )}
    </div>
  );
};
