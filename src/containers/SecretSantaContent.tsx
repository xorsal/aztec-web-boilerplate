/**
 * SecretSantaContent Component
 *
 * Main content area for the Secret Santa application.
 */

import React, { useState } from 'react';
import { Tabs } from '../components';
import { useUniversalWallet } from '../hooks';
import { useSecretSanta } from '../hooks/context/useSecretSanta';
import { isEmbeddedConnector } from '../types/walletConnector';
import {
  WalletConnection,
  GameList,
  JoinGame,
  RegisterSender,
  ClaimReceiver,
  RevealPhase,
  AdminPanel,
} from '../components/secret-santa';
import { PHASE, PHASE_NAMES } from '../providers/SecretSantaProvider';
import type { TabConfig, TabType } from '../types';

type SecretSantaTab = 'setup' | 'games' | 'join' | 'sender' | 'receiver' | 'reveal' | 'admin';

export const SecretSantaContent: React.FC = () => {
  const { connector, isConnected } = useUniversalWallet();
  const { isContractConnected, gameState, isAdmin } = useSecretSanta();
  const [activeTab, setActiveTab] = useState<SecretSantaTab>('setup');

  // Determine which tabs to show based on game state
  const getRelevantTab = (): SecretSantaTab => {
    if (!isContractConnected) return 'setup';
    if (!gameState) return 'games';

    switch (gameState.phase) {
      case PHASE.ENROLLMENT:
        return 'join';
      case PHASE.SENDER_REGISTRATION:
        return 'sender';
      case PHASE.RECEIVER_CLAIM:
        return 'receiver';
      case PHASE.COMPLETED:
        return 'reveal';
      default:
        return 'games';
    }
  };

  // Build tabs based on current state
  const buildTabs = (): TabConfig[] => {
    const tabs: TabConfig[] = [
      {
        id: 'setup' as TabType,
        label: 'Setup',
        icon: '⚙️',
        component: <WalletConnection />,
      },
    ];

    if (isContractConnected) {
      tabs.push({
        id: 'games' as TabType,
        label: 'Games',
        icon: '🎮',
        component: <GameList />,
      });

      // Show admin tab for admins even without a game selected (to create first game)
      if (isAdmin && !gameState) {
        tabs.push({
          id: 'admin' as TabType,
          label: 'Admin',
          icon: '👑',
          component: <AdminPanel />,
        });
      }

      if (gameState) {
        // Always show all phase tabs for easy navigation
        tabs.push(
          {
            id: 'join' as TabType,
            label: 'Join',
            icon: '➕',
            component: <JoinGame />,
          },
          {
            id: 'sender' as TabType,
            label: 'Register',
            icon: '🎁',
            component: <RegisterSender />,
          },
          {
            id: 'receiver' as TabType,
            label: 'Claim',
            icon: '📦',
            component: <ClaimReceiver />,
          },
          {
            id: 'reveal' as TabType,
            label: 'Reveal',
            icon: '🔓',
            component: <RevealPhase />,
          }
        );

        if (isAdmin) {
          tabs.push({
            id: 'admin' as TabType,
            label: 'Admin',
            icon: '👑',
            component: <AdminPanel />,
          });
        }
      }
    }

    return tabs;
  };

  const tabs = buildTabs();

  // Show security warning for embedded wallet
  const showSecurityWarning =
    connector?.getStatus().status === 'connected' &&
    isEmbeddedConnector(connector);

  return (
    <main className="main-content secret-santa-content">
      {showSecurityWarning && (
        <div className="security-warning">
          <span className="warning-icon">⚠️</span>
          <span>
            Using embedded wallet. Keys are stored in your browser.
            For larger amounts, consider using a hardware wallet.
          </span>
        </div>
      )}

      {/* Game Status Banner */}
      {isContractConnected && gameState && (
        <div className="game-status-banner">
          <span className="game-id">Game #{String(gameState.participantCount > 0 ? 'Active' : 'None')}</span>
          <span className="phase-badge">
            Phase: {PHASE_NAMES[gameState.phase]}
          </span>
          <span className="participants">
            {gameState.participantCount}/{gameState.maxParticipants} players
          </span>
        </div>
      )}

      <Tabs
        tabs={tabs}
        defaultTab={activeTab as TabType}
        onTabChange={(tab) => setActiveTab(tab as SecretSantaTab)}
      />
    </main>
  );
};
