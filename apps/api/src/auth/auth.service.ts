import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { authenticator } from 'otplib';
import { createHash, randomBytes } from 'node:crypto';
import { prismaAdmin, type Account } from '@cadence/db';
import { env } from '@cadence/config';
import { DomainError } from '@cadence/domain';
import { keyProvider, seal, open } from '@cadence/token-vault';

const SESSION_TTL_MS = 30 * 864e5;

@Injectable()
export class AuthService {
  async signUp(input: { email: string; password: string; name?: string; timezone?: string }) {
    const email = input.email.trim().toLowerCase();
    if (await prismaAdmin.account.findUnique({ where: { email } })) throw new DomainError('CONFLICT', 'An account with this email already exists', 'email');
    if (input.password.length < 10) throw new DomainError('VALIDATION', 'Password must be at least 10 characters', 'password');
    const account = await prismaAdmin.account.create({ data: { email, name: input.name, timezone: input.timezone ?? 'UTC', passwordHash: await argon2.hash(input.password, { type: argon2.argon2id }) } });
    // Every new account gets a personal organization on Free so the product is usable immediately
    const slug = await uniqueSlug((input.name ?? email.split('@')[0]).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace');
    const org = await prismaAdmin.organization.create({ data: { name: input.name ? `${input.name}'s workspace` : 'My workspace', slug, ownerAccountId: account.id, memberships: { create: { accountId: account.id, role: 'OWNER' } }, subscription: { create: {} } } });
    await prismaAdmin.account.update({ where: { id: account.id }, data: { lastOrganizationId: org.id } });
    return account;
  }

  async verifyPassword(email: string, password: string): Promise<Account | null> {
    const account = await prismaAdmin.account.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!account?.passwordHash) return null;
    if (env.NODE_ENV !== 'production' && account.passwordHash.startsWith('dev:')) {
      return account.passwordHash === 'dev:' + createHash('sha256').update(password).digest('hex') ? account : null;
    }
    if (!account.passwordHash.startsWith('$')) return null; // not a valid password hash (e.g. a dev-only seed marker); never sign in
    try { return (await argon2.verify(account.passwordHash, password)) ? account : null; }
    catch { return null; }
  }

  async createSession(accountId: string, meta: { ip?: string; userAgent?: string }) {
    const id = randomBytes(32).toString('base64url');
    await prismaAdmin.session.create({ data: { id, accountId, expiresAt: new Date(Date.now() + SESSION_TTL_MS), ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300) } });
    return id;
  }
  async getSession(id: string) {
    const s = await prismaAdmin.session.findUnique({ where: { id }, include: { account: true } });
    if (!s || s.expiresAt < new Date()) return null;
    // Sliding expiry: extend once a day
    if (s.expiresAt.getTime() - Date.now() < SESSION_TTL_MS - 864e5) await prismaAdmin.session.update({ where: { id }, data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) } }).catch(() => undefined);
    return s;
  }
  async destroySession(id: string) { await prismaAdmin.session.deleteMany({ where: { id } }); }

  // ---- TOTP 2FA
  async beginTotp(accountId: string) {
    const account = await prismaAdmin.account.findUniqueOrThrow({ where: { id: accountId } });
    const secret = authenticator.generateSecret();
    const { plaintext: dek, wrapped } = await keyProvider().generateDataKey(`totp:${accountId}`);
    const enc = Buffer.concat([Buffer.from([wrapped.length >> 8, wrapped.length & 255]), wrapped, seal(secret, dek)]);
    await prismaAdmin.account.update({ where: { id: accountId }, data: { totpSecretEnc: enc, totpEnabledAt: null } });
    return { secret, otpauth: authenticator.keyuri(account.email, 'Cadence', secret) };
  }
  private async totpSecret(account: Account) {
    if (!account.totpSecretEnc) return null;
    const buf = Buffer.from(account.totpSecretEnc);
    const len = (buf[0] << 8) | buf[1];
    const wrapped = buf.subarray(2, 2 + len), sealed = buf.subarray(2 + len);
    const dek = await keyProvider().unwrap(wrapped, `totp:${account.id}`);
    try { return open(sealed, dek); } finally { dek.fill(0); }
  }
  async confirmTotp(accountId: string, code: string) {
    const account = await prismaAdmin.account.findUniqueOrThrow({ where: { id: accountId } });
    const secret = await this.totpSecret(account);
    if (!secret || !authenticator.check(code, secret)) throw new DomainError('VALIDATION', 'Invalid code', 'code');
    const codes = Array.from({ length: 10 }, () => randomBytes(5).toString('hex'));
    const { plaintext: dek, wrapped } = await keyProvider().generateDataKey(`recovery:${accountId}`);
    const enc = Buffer.concat([Buffer.from([wrapped.length >> 8, wrapped.length & 255]), wrapped, seal(JSON.stringify(codes.map(c => createHash('sha256').update(c).digest('hex'))), dek)]);
    await prismaAdmin.account.update({ where: { id: accountId }, data: { totpEnabledAt: new Date(), recoveryCodesEnc: enc } });
    return codes;
  }
  async verifyTotp(account: Account, code: string) {
    const secret = await this.totpSecret(account);
    return !!secret && authenticator.check(code, secret);
  }
  async disableTotp(accountId: string) { await prismaAdmin.account.update({ where: { id: accountId }, data: { totpSecretEnc: null, totpEnabledAt: null, recoveryCodesEnc: null } }); }

  // ---- API keys
  async createApiKey(accountId: string, organizationId: string, name: string, scopes: string[]) {
    const raw = 'rly_live_' + randomBytes(24).toString('base64url');
    await prismaAdmin.apiKey.create({ data: { accountId, organizationId, name, prefix: raw.slice(0, 16), hash: createHash('sha256').update(raw).digest('hex'), scopes } });
    return raw; // shown once
  }
  async resolveApiKey(raw: string) {
    const key = await prismaAdmin.apiKey.findUnique({ where: { hash: createHash('sha256').update(raw).digest('hex') } });
    if (!key || key.revokedAt) return null;
    prismaAdmin.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    return key;
  }
}

async function uniqueSlug(base: string) {
  let slug = base, i = 1;
  while (await prismaAdmin.organization.findUnique({ where: { slug } })) slug = `${base}-${++i}`;
  return slug;
}
