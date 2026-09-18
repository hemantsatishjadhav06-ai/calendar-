import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
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

  @Post('totp/begin') async totpBegin() { const c = ctx(); if (!c.account) throw new UnauthorizedException(); return this.auth.beginTotp(c.account.id); }
  @Post('totp/confirm') async totpConfirm(@Body() body: { code: string }) { const c = ctx(); if (!c.account) throw new UnauthorizedException(); return { recoveryCodes: await this.auth.confirmTotp(c.account.id, body.code) }; }
  @Post('totp/disable') @HttpCode(204) async totpDisable(@Body() body: { code: string }) { const c = ctx(); if (!c.account) throw new UnauthorizedException(); if (!(await this.auth.verifyTotp(c.account, body.code))) throw new UnauthorizedException('Invalid code'); await this.auth.disableTotp(c.account.id); }

  private async issueCookie(res: Response, accountId: string, req: Request) {
    const sid = await this.auth.createSession(accountId, { ip: req.ip, userAgent: req.headers['user-agent'] });
    res.cookie(SESSION_COOKIE, sid, { httpOnly: true, signed: true, sameSite: 'lax', secure: env.NODE_ENV === 'production', path: '/', maxAge: 30 * 864e5 });
  }
}
