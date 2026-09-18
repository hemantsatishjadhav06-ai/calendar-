import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import pino from 'pino';
import { env } from '@cadence/config';
import { AppModule } from './app.module.js';
import { createYoga } from './graphql/yoga.js';
import { DomainExceptionFilter } from './common/domain-exception.filter.js';
import { SessionMiddleware } from './auth/session.middleware.js';

const log = pino({ name: 'api' });

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, cors: { origin: env.APP_URL, credentials: true } });
  app.set('trust proxy', 1);
  app.use(cookieParser(env.SESSION_SECRET));
  // Raw body for webhook signature verification; JSON elsewhere
  app.use('/webhooks', express.raw({ type: '*/*', limit: '5mb' }));
  app.use('/stripe', express.raw({ type: 'application/json', limit: '2mb' }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false }));

  // GraphQL (web app + public API share one endpoint; context decides scopes)
  const yoga = createYoga();
  // Yoga is plain Express middleware, so Nest's route-scoped SessionMiddleware does not cover it.
  // Run it explicitly in front of Yoga so the GraphQL context has the session + tenant (req.rc);
  // without this every authenticated field resolves to "Not authorized".
  const sessionMw = app.get(SessionMiddleware);
  app.use('/graphql', (req: Request, res: Response, next: NextFunction) => sessionMw.use(req, res, next), yoga);

  // Map DomainError / Zod parse errors thrown by REST controllers to proper HTTP statuses
  app.useGlobalFilters(new DomainExceptionFilter());

  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? new URL(env.API_URL).port ?? 4000);
  await app.listen(port);
  log.info({ port }, 'api listening');
}
bootstrap().catch(e => { log.error(e); process.exit(1); });
