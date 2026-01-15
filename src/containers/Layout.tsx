import React from 'react';
import { useUniversalWallet } from '../hooks';
import { SecretSantaContent } from './SecretSantaContent';

export const Layout: React.FC = () => {
  const { isInitialized, isConnected } = useUniversalWallet();

  // Show layout even if not connected - the SecretSantaContent will handle the connection flow
  const showLayout = isInitialized || isConnected;

  if (!showLayout) {
    return null;
  }

  return (
    <div className="layout-container">
      <SecretSantaContent />
    </div>
  );
};
