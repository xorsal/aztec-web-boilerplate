/**
 * GameList Component
 *
 * Displays available games and allows users to select one.
 */

import React, { useState, useEffect } from 'react';
import { useSecretSanta } from '../../hooks/context/useSecretSanta';
import { useUniversalWallet } from '../../hooks/context/useUniversalWallet';
import { PHASE_NAMES } from '../../providers/SecretSantaProvider';

interface Game {
  id: bigint;
  phase: number;
  participantCount: number;
  maxParticipants: number;
}

export const GameList: React.FC = () => {
  const { contract, gameId, setGameId, refreshGameState } = useSecretSanta();
  const { account } = useUniversalWallet();
  const [games, setGames] = useState<Game[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGames = async () => {
    if (!contract || !account) return;

    setIsLoading(true);
    setError(null);

    try {
      const nextId = await contract.methods
        .get_next_game_id()
        .simulate({ from: account.getAddress() });

      const loadedGames: Game[] = [];
      for (let i = 1n; i < BigInt(nextId); i++) {
        try {
          const [phase, participantCount, maxParticipants] = await contract.methods
            .get_game_state(i)
            .simulate({ from: account.getAddress() });

          loadedGames.push({
            id: i,
            phase: Number(phase),
            participantCount: Number(participantCount),
            maxParticipants: Number(maxParticipants),
          });
        } catch {
          // Game might not exist
        }
      }

      setGames(loadedGames);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load games');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadGames();
  }, [contract, account]);

  const handleSelectGame = (id: bigint) => {
    setGameId(id);
    refreshGameState();
  };

  return (
    <div className="card game-list">
      <h2>Available Games</h2>

      {error && <div className="error-message">{error}</div>}

      {isLoading ? (
        <div className="loading">Loading games...</div>
      ) : games.length === 0 ? (
        <p>No games available. Ask an admin to create one!</p>
      ) : (
        <div className="games-grid">
          {games.map((game) => (
            <div
              key={String(game.id)}
              className={`game-item ${game.id === gameId ? 'selected' : ''}`}
              onClick={() => handleSelectGame(game.id)}
            >
              <div className="game-id">Game #{String(game.id)}</div>
              <div className="game-phase">
                {PHASE_NAMES[game.phase] || 'Unknown'}
              </div>
              <div className="game-participants">
                {game.participantCount} / {game.maxParticipants} players
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        className="btn-secondary"
        onClick={loadGames}
        disabled={isLoading}
      >
        {isLoading ? 'Loading...' : 'Refresh'}
      </button>
    </div>
  );
};
