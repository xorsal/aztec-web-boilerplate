/**
 * Secret Santa Provider
 *
 * Provides context for Secret Santa game state and interactions.
 */

import React, { createContext, useState, useEffect, useCallback } from 'react';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr, Fq } from '@aztec/foundation/curves/bn254';
import { Grumpkin } from '@aztec/foundation/crypto/grumpkin';
import { deriveSigningKey, derivePublicKeyFromSecretKey } from '@aztec/stdlib/keys';
import { poseidon2Hash } from '@aztec/foundation/crypto/poseidon';
import { getContractInstanceFromInstantiationParams } from '@aztec/aztec.js/contracts';
import {
  SecretSantaContract,
  SecretSantaContractArtifact,
} from '../artifacts/SecretSanta';
import { useUniversalWallet } from '../hooks';
import {
  hasAppManagedPXE,
  isBrowserWalletConnector,
} from '../types/walletConnector';
import type { SimulateViewsOp } from '../types';
import { getNetworkConfig } from '../config/networks';

// Game phase constants
export const PHASE = {
  ENROLLMENT: 1,
  SENDER_REGISTRATION: 2,
  RECEIVER_CLAIM: 3,
  COMPLETED: 4,
} as const;

export const PHASE_NAMES: Record<number, string> = {
  [PHASE.ENROLLMENT]: 'Enrollment',
  [PHASE.SENDER_REGISTRATION]: 'Sender Registration',
  [PHASE.RECEIVER_CLAIM]: 'Receiver Claim',
  [PHASE.COMPLETED]: 'Completed',
};

export interface GameState {
  phase: number;
  participantCount: number;
  maxParticipants: number;
  senderCount: number;
  receiverCount: number;
  senderSlots: number[];
  receiverSlots: number[];
}

export interface SecretSantaContextType {
  // Connection state
  isContractConnected: boolean;
  contractAddress: string | null;
  setContractAddress: (address: string) => void;

  // Game state
  gameId: bigint;
  setGameId: (id: bigint) => void;
  gameState: GameState | null;
  isPolling: boolean;

  // User state
  senderSlot: number | null;
  setSenderSlot: (slot: number) => void;
  secretKey: Fr | null;
  setSecretKeyFromPassphrase: (passphrase: string) => Promise<void>;

  // Contract instance
  contract: SecretSantaContract | null;

  // Actions
  connectToContract: (address: string) => Promise<void>;
  refreshGameState: () => Promise<void>;
  getAvailableSlots: () => number[];
  getClaimableSlots: () => number[];

  // Loading states
  isLoading: boolean;
  error: string | null;
  clearError: () => void;

  // Admin check
  isAdmin: boolean;
}

export const SecretSantaContext = createContext<
  SecretSantaContextType | undefined
>(undefined);

interface SecretSantaProviderProps {
  children: React.ReactNode;
}

export const SecretSantaProvider: React.FC<SecretSantaProviderProps> = ({
  children,
}) => {
  const { connector, account, isConnected, isInitialized } = useUniversalWallet();

  // Contract state
  const [contractAddress, setContractAddressState] = useState<string | null>(
    () => localStorage.getItem('zk-ss-contract-address')
  );
  const [contract, setContract] = useState<SecretSantaContract | null>(null);
  const [isContractConnected, setIsContractConnected] = useState(false);

  // Game state
  const [gameId, setGameIdState] = useState<bigint>(() => {
    const saved = localStorage.getItem('zk-ss-game-id');
    return saved ? BigInt(saved) : 1n;
  });
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  // User state
  const [senderSlot, setSenderSlotState] = useState<number | null>(() => {
    const saved = localStorage.getItem('zk-ss-sender-slot');
    return saved ? parseInt(saved, 10) : null;
  });
  const [secretKey, setSecretKey] = useState<Fr | null>(null);

  // Admin state
  const [isAdmin, setIsAdmin] = useState(false);

  // Loading/error state
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Persist settings
  const setContractAddress = useCallback((address: string) => {
    setContractAddressState(address);
    localStorage.setItem('zk-ss-contract-address', address);
  }, []);

  const setGameId = useCallback((id: bigint) => {
    setGameIdState(id);
    localStorage.setItem('zk-ss-game-id', id.toString());
  }, []);

  const setSenderSlot = useCallback((slot: number) => {
    setSenderSlotState(slot);
    localStorage.setItem('zk-ss-sender-slot', slot.toString());
  }, []);

  const clearError = useCallback(() => setError(null), []);

  // Convert passphrase to secret key
  const setSecretKeyFromPassphrase = useCallback(async (passphrase: string) => {
    const paddedPassphrase = passphrase.padEnd(32, '#');
    const bytes = Buffer.from(paddedPassphrase, 'utf-8');
    const rawKey = Fr.fromBufferReduce(bytes);
    const sk = await poseidon2Hash([rawKey]);
    setSecretKey(sk);
  }, []);

  // Connect to contract
  const connectToContract = useCallback(
    async (address: string) => {
      if (!connector || !isConnected) {
        setError('Wallet not connected');
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const contractAddr = AztecAddress.fromString(address);

        // Handle browser wallet (Azguard, etc.)
        if (isBrowserWalletConnector(connector)) {
          setContractAddress(address);
          setIsContractConnected(true);

          // Check if admin via browser wallet
          const caipAccount = connector.getCaipAccount();
          if (caipAccount) {
            const operation: SimulateViewsOp = {
              kind: 'simulate_views',
              account: caipAccount,
              calls: [{ kind: 'call', contract: address, method: 'get_admin', args: [] }],
            };
            const result = await connector.executeOperation(operation);
            if (result.status === 'ok' && result.result) {
              const adminAddr = String(result.result);
              const accountAddr = caipAccount.split(':')[2] || '';
              setIsAdmin(accountAddr.toLowerCase() === adminAddr.toLowerCase());
            }
          }
          return;
        }

        // Handle embedded/external signer wallets
        if (!hasAppManagedPXE(connector)) {
          setError('Unsupported wallet type');
          return;
        }

        const wallet = connector.getWallet();
        if (!wallet) {
          throw new Error('Wallet instance not available');
        }

        const pxe = connector.getPXE();
        if (!pxe) {
          throw new Error('PXE not available');
        }

        // Check if contract is already registered in PXE
        let contractRegistered = false;
        try {
          const existing = await pxe.getContractInstance(contractAddr);
          contractRegistered = existing !== undefined;
        } catch {
          // Not registered
        }

        // Register the contract with PXE if not already registered
        if (!contractRegistered) {
          try {
            // Get deployment params from network config
            const networkConfig = getNetworkConfig('sandbox');
            const salt = Fr.fromString(networkConfig.secretSantaDeploymentSalt);
            const admin = AztecAddress.fromString(networkConfig.deployerAddress);

            // Create proper contract instance from instantiation params
            // Note: Uses ZERO deployer because contract was deployed with universalDeploy: true
            const instance = await getContractInstanceFromInstantiationParams(
              SecretSantaContractArtifact,
              {
                salt,
                deployer: AztecAddress.ZERO, // universalDeploy uses ZERO
                constructorArgs: [admin], // admin is the actual deployer
                constructorArtifact: 'constructor',
              }
            );

            await pxe.registerContract({
              instance,
              artifact: SecretSantaContractArtifact,
            });
          } catch (err) {
            console.warn('Failed to register contract:', err);
            // Continue anyway - contract might be registered by EmbeddedContractProvider
          }
        }

        // Create contract instance
        const santaContract = SecretSantaContract.at(contractAddr, wallet);
        setContract(santaContract);
        setContractAddress(address);
        setIsContractConnected(true);

        // Check if admin
        if (account) {
          try {
            const adminAddr = await santaContract.methods
              .get_admin()
              .simulate({ from: account.getAddress() });
            setIsAdmin(
              account.getAddress().toString() === adminAddr.toString()
            );
          } catch {
            // Ignore admin check errors
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to connect to contract');
        setIsContractConnected(false);
      } finally {
        setIsLoading(false);
      }
    },
    [connector, isConnected, account, setContractAddress]
  );

  // Refresh game state
  const refreshGameState = useCallback(async () => {
    if (!isContractConnected || !contractAddress || isPolling) return;

    setIsPolling(true);
    try {
      // Handle browser wallet
      if (isBrowserWalletConnector(connector)) {
        const caipAccount = connector.getCaipAccount();
        if (!caipAccount) return;

        const operation: SimulateViewsOp = {
          kind: 'simulate_views',
          account: caipAccount,
          calls: [
            {
              kind: 'call',
              contract: contractAddress,
              method: 'get_game_state',
              args: [gameId.toString()],
            },
          ],
        };
        const opResult = await connector.executeOperation(operation);
        if (opResult.status !== 'ok' || !opResult.result) {
          console.error('Failed to get game state via browser wallet');
          return;
        }

        const result = opResult.result as any[];
        const [
          phase,
          participantCount,
          max,
          senderCount,
          receiverCount,
          senderSlotsArr,
          receiverSlotsArr,
        ] = result;

        const senderSlots: number[] = [];
        const receiverSlots: number[] = [];
        for (let i = 0; i < Number(max); i++) {
          if (senderSlotsArr[i]) senderSlots.push(i + 1);
          if (receiverSlotsArr[i]) receiverSlots.push(i + 1);
        }

        setGameState({
          phase: Number(phase),
          participantCount: Number(participantCount),
          maxParticipants: Number(max),
          senderCount: Number(senderCount),
          receiverCount: Number(receiverCount),
          senderSlots,
          receiverSlots,
        });
        return;
      }

      // Handle embedded/external signer
      if (!contract || !account) return;

      const result = await contract.methods
        .get_game_state(gameId)
        .simulate({ from: account.getAddress() });

      const [
        phase,
        participantCount,
        max,
        senderCount,
        receiverCount,
        senderSlotsArr,
        receiverSlotsArr,
      ] = result;

      const senderSlots: number[] = [];
      const receiverSlots: number[] = [];
      for (let i = 0; i < Number(max); i++) {
        if (senderSlotsArr[i]) senderSlots.push(i + 1);
        if (receiverSlotsArr[i]) receiverSlots.push(i + 1);
      }

      setGameState({
        phase: Number(phase),
        participantCount: Number(participantCount),
        maxParticipants: Number(max),
        senderCount: Number(senderCount),
        receiverCount: Number(receiverCount),
        senderSlots,
        receiverSlots,
      });
    } catch (err) {
      console.error('Failed to refresh game state:', err);
    } finally {
      setIsPolling(false);
    }
  }, [connector, contract, account, contractAddress, isContractConnected, gameId, isPolling]);

  // Get available slots (not claimed as sender)
  const getAvailableSlots = useCallback((): number[] => {
    if (!gameState) return [];
    const available: number[] = [];
    for (let i = 1; i <= gameState.maxParticipants; i++) {
      if (!gameState.senderSlots.includes(i)) {
        available.push(i);
      }
    }
    return available;
  }, [gameState]);

  // Get claimable slots (has sender, no receiver, not own slot)
  const getClaimableSlots = useCallback((): number[] => {
    if (!gameState) return [];
    return gameState.senderSlots.filter(
      (slot) => slot !== senderSlot && !gameState.receiverSlots.includes(slot)
    );
  }, [gameState, senderSlot]);

  // Auto-connect to saved contract address when wallet connects
  useEffect(() => {
    if (
      isConnected &&
      isInitialized &&
      contractAddress &&
      !isContractConnected &&
      !isLoading
    ) {
      connectToContract(contractAddress);
    }
  }, [
    isConnected,
    isInitialized,
    contractAddress,
    isContractConnected,
    isLoading,
    connectToContract,
  ]);

  // Poll game state when connected
  useEffect(() => {
    if (!isContractConnected || !contract) return;

    refreshGameState();
    const interval = setInterval(refreshGameState, 10000);
    return () => clearInterval(interval);
  }, [isContractConnected, contract, refreshGameState]);

  const contextValue: SecretSantaContextType = {
    isContractConnected,
    contractAddress,
    setContractAddress,
    gameId,
    setGameId,
    gameState,
    isPolling,
    senderSlot,
    setSenderSlot,
    secretKey,
    setSecretKeyFromPassphrase,
    contract,
    connectToContract,
    refreshGameState,
    getAvailableSlots,
    getClaimableSlots,
    isLoading,
    error,
    clearError,
    isAdmin,
  };

  return (
    <SecretSantaContext.Provider value={contextValue}>
      {children}
    </SecretSantaContext.Provider>
  );
};
