import { poseidon2Hash } from '@aztec/foundation/crypto/poseidon';
import { Fr } from '@aztec/aztec.js/fields';

async function main() {
  const holaSecretKey = await poseidon2Hash([
    Fr.fromBufferReduce(Buffer.from('hola'.padEnd(32, '#'), 'utf8')),
  ]);
  console.log('Secret Key:', holaSecretKey.toString());
}
main();
