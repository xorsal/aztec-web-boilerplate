/**
 * JoinGame Component
 *
 * Allows users to enroll in a Secret Santa game during the enrollment phase.
 */

import React, { useState } from 'react';
import { useSecretSanta } from '../../hooks/context/useSecretSanta';
import { useUniversalWallet } from '../../hooks/context/useUniversalWallet';
import { useWriteContract } from '../../hooks/contracts/useWriteContract';
import { SecretSantaContract } from '../../artifacts/SecretSanta';
import { PHASE, PHASE_NAMES } from '../../providers/SecretSantaProvider';

export const JoinGame: React.FC = () => {
  const {
    contract,
    contractAddress,
    gameId,
    gameState,
    refreshGameState,
  } = useSecretSanta();
  const { account, isConnected } = useUniversalWallet();
  const { writeContract, isPending } = useWriteContract();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleEnroll = async () => {
    if (!contract || !contractAddress || !account) {
      setError('Wallet or contract not connected');
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      const result = await writeContract({
        contract: SecretSantaContract,
        address: contractAddress,
        functionName: 'enroll',
        args: [gameId],
      });

      if (result.success) {
        setSuccess('Successfully enrolled in the game!');
        await refreshGameState();
      } else {
        setError(result.error || 'Failed to enroll');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enroll');
    }
  };

  if (!isConnected) {
    return (
      <div className="card join-game">
        <h2>Join Game</h2>
        <p>Connect your wallet to join a game.</p>
      </div>
    );
  }

  if (!gameState) {
    return (
      <div className="card join-game">
        <h2>Join Game</h2>
        <p>Loading game state...</p>
      </div>
    );
  }

  const isEnrollmentPhase = gameState.phase === PHASE.ENROLLMENT;
  const isFull = gameState.participantCount >= gameState.maxParticipants;

  return (
    <div className="card join-game">
      <h2>Join Game #{String(gameId)}</h2>

      <div className="game-info">
        <div className="info-row">
          <span className="label">Phase:</span>
          <span className="value">{PHASE_NAMES[gameState.phase]}</span>
        </div>
        <div className="info-row">
          <span className="label">Participants:</span>
          <span className="value">
            {gameState.participantCount} / {gameState.maxParticipants}
          </span>
        </div>
      </div>

      {error && <div className="error-message" data-testid="join-error">{error}</div>}
      {success && <div className="success-message" data-testid="join-success">{success}</div>}

      {isEnrollmentPhase ? (
        isFull ? (
          <p className="warning" data-testid="game-full-warning">Game is full. Wait for the next one!</p>
        ) : (
          <>
            <p>Click below to join this Secret Santa game!</p>
            <button
              className="btn-primary"
              data-testid="enroll-button"
              onClick={handleEnroll}
              disabled={isPending}
            >
              {isPending ? 'Enrolling...' : 'Enroll in Game'}
            </button>
          </>
        )
      ) : (
        <p className="info" data-testid="enrollment-closed">
          Enrollment is closed. Current phase: {PHASE_NAMES[gameState.phase]}
        </p>
      )}
    </div>
  );
};
