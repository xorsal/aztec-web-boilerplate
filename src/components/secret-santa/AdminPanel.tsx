/**
 * AdminPanel Component
 *
 * Provides admin functionality for managing Secret Santa games.
 */

import React, { useState } from 'react';
import { useSecretSanta } from '../../hooks/context/useSecretSanta';
import { useUniversalWallet } from '../../hooks/context/useUniversalWallet';
import { useWriteContract } from '../../hooks/contracts/useWriteContract';
import { SecretSantaContract } from '../../artifacts/SecretSanta';
import { PHASE, PHASE_NAMES } from '../../providers/SecretSantaProvider';

export const AdminPanel: React.FC = () => {
  const {
    contract,
    contractAddress,
    gameId,
    gameState,
    isAdmin,
    refreshGameState,
  } = useSecretSanta();
  const { account, isConnected } = useUniversalWallet();
  const { writeContract, isPending } = useWriteContract();

  // Create game form
  const [minParticipants, setMinParticipants] = useState(3);
  const [maxParticipants, setMaxParticipants] = useState(10);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleCreateGame = async () => {
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
        functionName: 'create_game',
        args: [minParticipants, maxParticipants],
      });

      if (result.success) {
        setSuccess('Game created successfully!');
        await refreshGameState();
      } else {
        setError(result.error || 'Failed to create game');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create game');
    }
  };

  const handleAdvancePhase = async () => {
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
        functionName: 'advance_phase',
        args: [gameId],
      });

      if (result.success) {
        setSuccess('Phase advanced successfully!');
        await refreshGameState();
      } else {
        setError(result.error || 'Failed to advance phase');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to advance phase');
    }
  };

  if (!isConnected) {
    return (
      <div className="card admin-panel">
        <h2>Admin Panel</h2>
        <p>Connect your wallet to access admin functions.</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="card admin-panel">
        <h2>Admin Panel</h2>
        <p className="warning">
          You are not the admin of this contract. Only the admin can manage games.
        </p>
      </div>
    );
  }

  return (
    <div className="card admin-panel">
      <h2>Admin Panel</h2>

      {error && <div className="error-message" data-testid="admin-error">{error}</div>}
      {success && <div className="success-message" data-testid="admin-success">{success}</div>}

      {/* Current Game Info */}
      {gameState && (
        <div className="game-info">
          <h3>Current Game #{String(gameId)}</h3>
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
          <div className="info-row">
            <span className="label">Senders Registered:</span>
            <span className="value">{gameState.senderCount}</span>
          </div>
          <div className="info-row">
            <span className="label">Receivers Claimed:</span>
            <span className="value">{gameState.receiverCount}</span>
          </div>
        </div>
      )}

      {/* Advance Phase */}
      {gameState && gameState.phase < PHASE.COMPLETED && (
        <div className="admin-action">
          <h3>Advance Phase</h3>
          <p data-testid="phase-transition-info">
            Current: {PHASE_NAMES[gameState.phase]} {' -> '}
            Next: {PHASE_NAMES[gameState.phase + 1] || 'N/A'}
          </p>
          <button
            className="btn-warning"
            data-testid="advance-phase-button"
            onClick={handleAdvancePhase}
            disabled={isPending}
          >
            {isPending ? 'Advancing...' : 'Advance to Next Phase'}
          </button>
        </div>
      )}

      {/* Create New Game */}
      <div className="admin-action">
        <h3>Create New Game</h3>
        <div className="form-group">
          <label htmlFor="min-participants">Minimum Participants:</label>
          <input
            type="number"
            id="min-participants"
            data-testid="min-participants-input"
            value={minParticipants}
            onChange={(e) => setMinParticipants(Number(e.target.value))}
            min={2}
            max={50}
          />
        </div>
        <div className="form-group">
          <label htmlFor="max-participants">Maximum Participants:</label>
          <input
            type="number"
            id="max-participants"
            data-testid="max-participants-input"
            value={maxParticipants}
            onChange={(e) => setMaxParticipants(Number(e.target.value))}
            min={2}
            max={50}
          />
        </div>
        <button
          className="btn-primary"
          data-testid="create-game-button"
          onClick={handleCreateGame}
          disabled={isPending}
        >
          {isPending ? 'Creating...' : 'Create Game'}
        </button>
      </div>
    </div>
  );
};
