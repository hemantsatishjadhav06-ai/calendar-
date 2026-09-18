import { Body, Controller, Get, HttpCode, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { env } from '@cadence/config';
import { prismaAdmin } from '@cadence/db';
import { AuthService } from './auth.service.js';
import { SESSION_COOKIE, ctx } from './session.middleware.js';
import { RedisService } from '../infra/redis.service.js';

const Credentials = z.object({ email: z.string().email(), password: z.string().min(1), totp: z.string().optional(), name: z.string().max(80).optional(), timezone: z.string().optional() });

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private redis: RedisService) {}

  @Post('signup') @HttpCode(201)
  async signup(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const input = Credentials.parse(body);
    const account = await this.auth.signUp(input);
    await this.issueCookie(res, account.id, req);
    return { id: account.id, email: account.email };
  }

  @Post('login') @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const input = Credentials.parse(body);
    const key = `login:fail:${req.ip}:${input.email.toLowerCase()}`;
    if (Number(await this.redis.client.get(key)) >= 10) throw new UnauthorizedException('Too many attempts. Try again in 15 minutes.');
    const account = await this.auth.verifyPassword(input.email, input.password);
    if (!account) { await this.redis.client.multi().incr(key).expire(key, 900).exec(); throw new UnauthorizedException('Invalid email or password'); }
    if (account.totpEnabledAt) {
      if (!input.totp) return { requiresTotp: true };
      if (!(await this.auth.verifyTotp(account, input.totp))) throw new UnauthorizedException('Invalid authentication code');
    }
    await this.redis.client.del(key);
    await this.issueCookie(res, account.id, req);
    return { id: account.id, email: account.email, lastOrganizationId: account.lastOrganizationId };
  }

  @Post('logout') @HttpCode(204)
  async logout(@Res({ passthrough: true }) res: Response) {
    const c = ctx(); if (c.sessionId) await this.auth.destroySession(c.sessionId);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Get('me')
  async me() {
    const c = ctx(); if (!c.account) throw new UnauthorizedException();
    const memberships = await prismaAdmin.membership.findMany({ where: { accountId: c.account.id, status: 'ACTIVE' }, include: { organization: { select: { id: true, name: true, slug: true } } } });
    return { id: c.account.id, email: c.account.email, name: c.account.name, avatarUrl: c.account.avatarUrl, timezone: c.account.timezone, totpEnabled: !!c.account.totpEnabledAt, preferences: { weekStartsOn: c.account.weekStartsOn, appearance: c.account.appearance, landingPage: c.account.landingPage, defaultScheduleAction: c.account.defaultScheduleAction }, currentOrganizationId: c.tenant?.organizationId ?? null, organizations: memberships.map(m => ({ ...m.organization, role: m.role })) };
  }

  // ── Social login (Google). Additive: existing email/password login is untouched. Requires
  //    GOOGLE_CLIENT_ID/SECRET and this callback URL registered as an authorized redirect URI.
  @Get('oauth/google/start')
  async googleStart(@Res() res: Response) {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return res.redirect(`${env.APP_URL}/login?error=${encodeURIComponent('Google sign-in is not configured')}`);
    const state = randomBytes(16).toString('hex');
    await this.redis.client.setex(`loginoauth:${state}`, 600, 'google');
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${env.API_URL}/auth/oauth/google/callback`, response_type: 'code', scope: 'openid email profile', access_type: 'online', include_granted_scopes: 'true', state });
    res.redirect(url);
  }

  @Get('oauth/google/callback')
  async googleCallback(@Query() q: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    const fail = (m: string) => res.redirect(`${env.APP_URL}/login?error=${encodeURIComponent(m)}`);
    if (q.error || !q.code || !q.state) return fail(q.error_description ?? q.error ?? 'Google sign-in was cancelled');
    if (!(await this.redis.client.get(`loginoauth:${q.state}`))) return fail('Sign-in expired, please try again');
    await this.redis.client.del(`loginoauth:${q.state}`);
    try {
      const tok: any = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: q.code, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, redirect_uri: `${env.API_URL}/auth/oauth/google/callback`, grant_type: 'authorization_code' }) }).then(r => r.json());
      if (!tok.access_token) return fail('Google sign-in failed');
      const info: any = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tok.access_token}` } }).then(r => r.json());
      if (!info?.id || !info?.email) return fail('Could not read your Google profile');
      if (info.verified_email === false) return fail('Your Google email is not verified');
      const account = await this.auth.findOrCreateFromOAuth('google', String(info.id), info.email, info.name, info.picture);
      await this.issueCookie(res, account.id, req);
      res.redirect(`${env.APP_URL}/home`);
    } catch { return fail('Google sign-in failed'); }
  }

  @Post('totp/begin') async totpBegin() { const c = ctx(); if (!c.account) throw new UnauthorizedException(); return this.auth.beginTotp(c.account.id); }
  @Post('totp/confirm') async totpConfirm(@Body() body: { code: string }) { const c = ctx(); if (!c.account) throw new UnauthorizedException(); return { recoveryCodes: await this.auth.confirmTotp(c.account.id, body.code) }; }
  @Post('totp/disable') @HttpCode(204) async totpDisable(@Body() body: { code: string }) { const c = ctx(); if (!c.account) throw new UnauthorizedException(); if (!(await this.auth.verifyTotp(c.account, body.code))) throw new UnauthorizedException('Invalid code'); await this.auth.disableTotp(c.account.id); }

  private async issueCookie(res: Response, accountId: string, req: Request) {
    const sid = await this.auth.createSession(accountId, { ip: req.ip, userAgent: req.headers['user-agent'] });
    res.cookie(SESSION_COOKIE, sid, { httpOnly: true, signed: true, sameSite: 'lax', secure: env.NODE_ENV === 'production', path: '/', maxAge: 30 * 864e5 });
  }
}
