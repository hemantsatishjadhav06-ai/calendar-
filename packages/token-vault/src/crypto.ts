import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { KMSClient, GenerateDataKeyCommand, DecryptCommand } from '@aws-sdk/client-kms';
import { env } from '@relay/config';

/** AES-256-GCM: [12-byte iv][16-byte tag][ciphertext] */
export function seal(plain: string, dek: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', dek, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]);
}
export function open(blob: Buffer, dek: Buffer): string {
  const iv = blob.subarray(0, 12), tag = blob.subarray(12, 28), enc = blob.subarray(28);
  const d = createDecipheriv('aes-256-gcm', dek, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

export interface KeyProvider {
  generateDataKey(context: string): Promise<{ plaintext: Buffer; wrapped: Buffer }>;
  unwrap(wrapped: Buffer, context: string): Promise<Buffer>;
}

/** Production: AWS KMS envelope encryption with EncryptionContext bound to the record id. */
class KmsKeyProvider implements KeyProvider {
  private kms = new KMSClient({});
  constructor(private keyId: string) {}
  async generateDataKey(context: string) {
    const r = await this.kms.send(new GenerateDataKeyCommand({ KeyId: this.keyId, KeySpec: 'AES_256', EncryptionContext: { ctx: context } }));
    return { plaintext: Buffer.from(r.Plaintext!), wrapped: Buffer.from(r.CiphertextBlob!) };
  }
  async unwrap(wrapped: Buffer, context: string) {
    const r = await this.kms.send(new DecryptCommand({ CiphertextBlob: wrapped, EncryptionContext: { ctx: context } }));
    return Buffer.from(r.Plaintext!);
  }
}

/** Development/CI: wrap DEKs with a local 32-byte master key (never use in production). */
class LocalKeyProvider implements KeyProvider {
  constructor(private master: Buffer) { if (master.length !== 32) throw new Error('LOCAL_MASTER_KEY_HEX must be 32 bytes'); }
  async generateDataKey(context: string) {
    const plaintext = randomBytes(32);
    return { plaintext, wrapped: seal(plaintext.toString('base64') + '|' + context, this.master) };
  }
  async unwrap(wrapped: Buffer, context: string) {
    const [b64, ctx] = open(wrapped, this.master).split('|');
    if (ctx !== context) throw new Error('DEK context mismatch');
    return Buffer.from(b64, 'base64');
  }
}

let provider: KeyProvider | undefined;
export function keyProvider(): KeyProvider {
  if (provider) return provider;
  if (env.KMS_TOKEN_KEY_ARN) provider = new KmsKeyProvider(env.KMS_TOKEN_KEY_ARN);
  else if (env.LOCAL_MASTER_KEY_HEX) { if (env.NODE_ENV === 'production') throw new Error('Refusing to use LOCAL_MASTER_KEY_HEX in production'); provider = new LocalKeyProvider(Buffer.from(env.LOCAL_MASTER_KEY_HEX, 'hex')); }
  else throw new Error('Configure KMS_TOKEN_KEY_ARN or LOCAL_MASTER_KEY_HEX');
  return provider;
}
