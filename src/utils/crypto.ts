/**
 * Crypto Service - ECIES encryption/decryption for delivery data
 *
 * Uses ECDH on the Grumpkin curve to establish shared secrets,
 * then AES-128-CBC for symmetric encryption.
 *
 * Format of encrypted data (8 field elements):
 * - Field 0: ephemeral public key X coordinate
 * - Field 1: ephemeral public key Y coordinate
 * - Fields 2-7: ciphertext bytes (6 fields * 31 bytes = 186 bytes capacity)
 *
 * Total ciphertext: 112 bytes (7 AES blocks)
 * Max plaintext: 111 bytes (1 length byte + 111 bytes data)
 */

import { Fr, Fq } from '@aztec/foundation/curves/bn254';
import {
  Point,
  type GrumpkinScalar,
} from '@aztec/foundation/curves/grumpkin';
import { Grumpkin } from '@aztec/foundation/crypto/grumpkin';
import { Aes128 } from '@aztec/foundation/crypto/aes128';
import { sha256 } from '@aztec/foundation/crypto/sha256';
import { deriveEcdhSharedSecret } from '@aztec/stdlib/logs';

const aes = new Aes128();

const CIPHERTEXT_SIZE = 112;
const MAX_PLAINTEXT_SIZE = 111;

/**
 * Derive AES key and IV from ECDH shared secret.
 */
async function deriveAesKeyAndIv(
  sharedSecret: Point
): Promise<{ key: Uint8Array; iv: Uint8Array }> {
  const xBuffer = sharedSecret.x.toBuffer();
  const yBuffer = sharedSecret.y.toBuffer();
  const combined = Buffer.concat([xBuffer, yBuffer]);

  const hash = sha256(combined);
  const hashArray = Uint8Array.from(hash);

  return {
    key: hashArray.slice(0, 16),
    iv: hashArray.slice(16, 32),
  };
}

/**
 * Encrypt delivery data using ECIES.
 */
export async function encryptDeliveryData(
  plaintext: string,
  recipientPubKey: { x: bigint; y: bigint; is_infinite: boolean }
): Promise<[Fr, Fr, Fr, Fr, Fr, Fr, Fr, Fr]> {
  const plaintextBytes = Buffer.from(plaintext, 'utf-8');
  if (plaintextBytes.length > MAX_PLAINTEXT_SIZE) {
    throw new Error(
      `Delivery data too long (max ${MAX_PLAINTEXT_SIZE} bytes, got ${plaintextBytes.length})`
    );
  }

  const recipientPoint = new Point(
    new Fr(recipientPubKey.x),
    new Fr(recipientPubKey.y),
    recipientPubKey.is_infinite
  );

  // 1. Generate ephemeral keypair
  const ephemeralPrivateKey: GrumpkinScalar = Fq.random();
  const ephemeralPublicKey = await Grumpkin.mul(
    Grumpkin.generator,
    ephemeralPrivateKey
  );

  // 2. Compute shared secret
  const sharedSecret = await deriveEcdhSharedSecret(
    ephemeralPrivateKey,
    recipientPoint
  );

  // 3. Derive AES key and IV
  const { key, iv } = await deriveAesKeyAndIv(sharedSecret);

  // 4. Prepare plaintext with length prefix
  const paddedPlaintext = new Uint8Array(CIPHERTEXT_SIZE);
  paddedPlaintext[0] = plaintextBytes.length;
  paddedPlaintext.set(plaintextBytes, 1);

  // 5. Encrypt
  const ciphertext = await aes.encryptBufferCBC(paddedPlaintext, iv, key);
  const cipherArray = Uint8Array.from(ciphertext);

  // 6. Pack into 8 field elements
  const packBytesToField = (
    _bytes: Uint8Array,
    offset: number,
    length: number
  ): Fr => {
    const buffer = Buffer.alloc(32);
    const end = Math.min(offset + length, cipherArray.length);
    const actual = cipherArray.slice(offset, end);
    buffer.set(actual, 32 - length);
    return Fr.fromBufferReduce(buffer);
  };

  const cipherField2 = packBytesToField(cipherArray, 0, 31);
  const cipherField3 = packBytesToField(cipherArray, 31, 31);
  const cipherField4 = packBytesToField(cipherArray, 62, 31);
  const cipherField5 = packBytesToField(cipherArray, 93, 19);
  const cipherField6 = new Fr(0n);
  const cipherField7 = new Fr(0n);

  return [
    new Fr(ephemeralPublicKey.x.toBigInt()),
    new Fr(ephemeralPublicKey.y.toBigInt()),
    cipherField2,
    cipherField3,
    cipherField4,
    cipherField5,
    cipherField6,
    cipherField7,
  ];
}

/**
 * Decrypt delivery data using ECIES.
 */
export async function decryptDeliveryData(
  encryptedData: [
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
  ],
  privateKey: GrumpkinScalar
): Promise<string> {
  // 1. Extract ephemeral public key
  const ephemeralPubKeyX = new Fr(encryptedData[0]);
  const ephemeralPubKeyY = new Fr(encryptedData[1]);
  const ephemeralPubKey = new Point(ephemeralPubKeyX, ephemeralPubKeyY, false);

  // 2. Compute shared secret
  const sharedSecret = await deriveEcdhSharedSecret(privateKey, ephemeralPubKey);

  // 3. Derive AES key and IV
  const { key, iv } = await deriveAesKeyAndIv(sharedSecret);

  // 4. Extract ciphertext from fields
  const extractBytesFromField = (
    fieldValue: bigint,
    length: number
  ): Uint8Array => {
    const buffer = new Fr(fieldValue).toBuffer();
    return Uint8Array.from(buffer).slice(32 - length);
  };

  const ciphertext = new Uint8Array(CIPHERTEXT_SIZE);
  ciphertext.set(extractBytesFromField(encryptedData[2], 31), 0);
  ciphertext.set(extractBytesFromField(encryptedData[3], 31), 31);
  ciphertext.set(extractBytesFromField(encryptedData[4], 31), 62);
  ciphertext.set(extractBytesFromField(encryptedData[5], 19), 93);

  // 5. Decrypt
  const decrypted = await aes.decryptBufferCBCKeepPadding(ciphertext, iv, key);

  // 6. Extract actual data using length prefix
  const length = decrypted[0];
  if (length > MAX_PLAINTEXT_SIZE) {
    throw new Error(
      `Invalid decrypted data: length ${length} exceeds max ${MAX_PLAINTEXT_SIZE}`
    );
  }
  const plaintextBytes = decrypted.subarray(1, 1 + length);

  return Buffer.from(plaintextBytes).toString('utf-8');
}

/**
 * Check if encrypted data is empty/unset.
 */
export function isEncryptedDataEmpty(
  data: [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]
): boolean {
  return data.every((v) => v === 0n);
}
