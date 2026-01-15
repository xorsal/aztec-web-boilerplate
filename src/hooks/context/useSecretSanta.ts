import { useContext } from 'react';
import { SecretSantaContext } from '../../providers/SecretSantaProvider';

export const useSecretSanta = () => {
  const context = useContext(SecretSantaContext);

  if (context === undefined) {
    throw new Error(
      'useSecretSanta must be used within a SecretSantaProvider'
    );
  }

  return context;
};
