/**
 * ClaimReceiver Component
 *
 * Allows registered senders to claim a receiver slot and submit their encrypted delivery address.
 */

import React, { useState } from 'react';
import { useSecretSanta } from '../../hooks/context/useSecretSanta';
import { useUniversalWallet } from '../../hooks/context/useUniversalWallet';
import { useWriteContract } from '../../hooks/contracts/useWriteContract';
import { SecretSantaContract } from '../../artifacts/SecretSanta';
import { PHASE, PHASE_NAMES } from '../../providers/SecretSantaProvider';
import { encryptDeliveryData } from '../../utils/crypto';

// Prime offset for cyclic permutation (same as contract)
const PRIME_OFFSET = 137;

/**
 * Calculate the receiver slot using cyclic permutation.
 * Formula: ((senderSlot - 1 + PRIME_OFFSET) % participantCount) + 1
 */
function calculateReceiverSlot(senderSlot: number, participantCount: number): number {
  return ((senderSlot - 1 + PRIME_OFFSET) % participantCount) + 1;
}

export const ClaimReceiver: React.FC = () => {
  const {
    contract,
    contractAddress,
    gameId,
    gameState,
    senderSlot,
    getClaimableSlots,
    refreshGameState,
  } = useSecretSanta();
  const { account, isConnected } = useUniversalWallet();
  const { writeContract, isPending } = useWriteContract();
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const claimableSlots = getClaimableSlots();

  // Calculate the assigned receiver slot based on cyclic permutation
  const assignedReceiverSlot = senderSlot && gameState
    ? calculateReceiverSlot(senderSlot, gameState.participantCount)
    : null;

  const handleClaim = async () => {
    if (!contract || !contractAddress || !account) {
      setError('Wallet or contract not connected');
      return;
    }

    if (!assignedReceiverSlot) {
      setError('Cannot determine receiver slot. Please set your sender slot.');
      return;
    }

    if (!deliveryAddress.trim()) {
      setError('Please enter your delivery address');
      return;
    }

    if (deliveryAddress.length > 111) {
      setError('Delivery address must be 111 characters or less');
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      // Get the sender's encryption public key for the ASSIGNED slot (cyclic permutation)
      // This ensures we encrypt with the correct sender's key
      const senderPubKey = await contract.methods
        .get_slot_encryption_key(gameId, BigInt(assignedReceiverSlot))
        .simulate({ from: account.getAddress() });

      // Encrypt the delivery address
      const encryptedData = await encryptDeliveryData(deliveryAddress, {
        x: senderPubKey.x,
        y: senderPubKey.y,
        is_infinite: senderPubKey.is_infinite,
      });

      const result = await writeContract({
        contract: SecretSantaContract,
        address: contractAddress,
        functionName: 'claim_receiver',
        args: [gameId, gameState!.participantCount, encryptedData],
      });

      if (result.success) {
        setSuccess(`Successfully claimed receiver slot ${assignedReceiverSlot}!`);
        setDeliveryAddress('');
        setSelectedSlot(null);
        await refreshGameState();
      } else {
        setError(result.error || 'Failed to claim');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to claim');
    }
  };

  if (!isConnected) {
    return (
      <div className="card claim-receiver">
        <h2>Claim as Receiver</h2>
        <p>Connect your wallet to claim as a receiver.</p>
      </div>
    );
  }

  if (!gameState) {
    return (
      <div className="card claim-receiver">
        <h2>Claim as Receiver</h2>
        <p>Loading game state...</p>
      </div>
    );
  }

  if (senderSlot === null) {
    return (
      <div className="card claim-receiver">
        <h2>Claim as Receiver</h2>
        <p className="warning">
          You must be registered as a sender to claim as a receiver.
          Please enter your sender slot in the settings.
        </p>
      </div>
    );
  }

  const isReceiverPhase = gameState.phase === PHASE.RECEIVER_CLAIM;

  return (
    <div className="card claim-receiver">
      <h2>Claim as Receiver</h2>

      <div className="game-info">
        <div className="info-row">
          <span className="label">Phase:</span>
          <span className="value">{PHASE_NAMES[gameState.phase]}</span>
        </div>
        <div className="info-row">
          <span className="label">Receivers Claimed:</span>
          <span className="value">
            {gameState.receiverCount} / {gameState.senderCount}
          </span>
        </div>
        <div className="info-row">
          <span className="label">Your Sender Slot:</span>
          <span className="value highlight">{senderSlot}</span>
        </div>
      </div>

      {/* Slots Grid */}
      <div className="slots-section">
        <h3>Slots</h3>
        <div className="slots-grid">
          {Array.from({ length: gameState.maxParticipants }, (_, i) => {
            const slot = i + 1;
            const hasSender = gameState.senderSlots.includes(slot);
            const hasReceiver = gameState.receiverSlots.includes(slot);
            const isMySlot = senderSlot === slot;
            const isSelected = selectedSlot === slot;
            const isClaimable = hasSender && !hasReceiver && !isMySlot;

            let slotClass = 'slot ';
            if (hasReceiver) {
              slotClass += 'complete';
            } else if (hasSender) {
              slotClass += isMySlot ? 'mine' : 'claimable';
            } else {
              slotClass += 'empty';
            }
            if (isSelected) slotClass += ' selected';

            return (
              <div
                key={slot}
                className={slotClass}
                onClick={() =>
                  isClaimable && isReceiverPhase && setSelectedSlot(slot)
                }
                title={
                  isMySlot
                    ? 'Your slot (cannot claim your own)'
                    : hasReceiver
                      ? 'Already claimed'
                      : hasSender
                        ? 'Click to claim'
                        : 'No sender registered'
                }
              >
                {slot}
              </div>
            );
          })}
        </div>
        <div className="legend">
          <span className="legend-item claimable">Available to Claim</span>
          <span className="legend-item complete">Claimed</span>
          <span className="legend-item mine">Your Slot</span>
          <span className="legend-item empty">No Sender</span>
        </div>
      </div>

      {error && <div className="error-message" data-testid="claim-error">{error}</div>}
      {success && <div className="success-message" data-testid="claim-success">{success}</div>}

      {isReceiverPhase ? (
        claimableSlots.length === 0 ? (
          <p className="info" data-testid="no-slots-available">
            No slots available to claim. All slots have receivers or are your own slot.
          </p>
        ) : (
          <>
            <div className="form-group">
              <label htmlFor="slot-select">Select a slot to claim:</label>
              <select
                id="slot-select"
                data-testid="claim-slot-select"
                value={selectedSlot || ''}
                onChange={(e) => setSelectedSlot(Number(e.target.value))}
              >
                <option value="">Choose a slot...</option>
                {claimableSlots.map((slot) => (
                  <option key={slot} value={slot}>
                    Slot {slot}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="delivery-address">
                Your Delivery Address (max 111 chars):
              </label>
              <textarea
                id="delivery-address"
                data-testid="delivery-address-input"
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                maxLength={111}
                rows={3}
                placeholder="Enter your street address..."
              />
              <div className="char-count">
                {deliveryAddress.length} / 111 characters
              </div>
            </div>

            <button
              className="btn-primary"
              data-testid="claim-button"
              onClick={handleClaim}
              disabled={isPending || !selectedSlot || !deliveryAddress.trim()}
            >
              {isPending ? 'Claiming...' : 'Claim as Receiver'}
            </button>
          </>
        )
      ) : (
        <p className="info" data-testid="claiming-not-active">
          Receiver claiming is not active. Current phase:{' '}
          {PHASE_NAMES[gameState.phase]}
        </p>
      )}
    </div>
  );
};
