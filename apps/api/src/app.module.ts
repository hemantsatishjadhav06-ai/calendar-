import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { SessionMiddleware } from './auth/session.middleware.js';
import { OAuthController } from './oauth/oauth.controller.js';
import { ChannelsService } from './channels/channels.service.js';
import { WebhooksController } from './webhooks/webhooks.controller.js';
import { UploadsController } from './uploads/uploads.controller.js';
import { EventsController } from './events/events.controller.js';
import { StripeController } from './billing/stripe.controller.js';
import { BillingService } from './billing/billing.service.js';
import { ShortLinkController } from './links/shortlink.controller.js';
import { HealthController } from './health.controller.js';
import { AiController } from './ai/ai.controller.js';
import { NotifyController } from './notify/notify.controller.js';
import { ShareController } from './share/share.controller.js';
import { ReviewController } from './share/review.controller.js';
import { RedisService } from './infra/redis.service.js';
import { QueuesService } from './infra/queues.service.js';

@Module({
  controllers: [HealthController, AuthController, OAuthController, WebhooksController, UploadsController, EventsController, StripeController, ShortLinkController, AiController, NotifyController, ShareController, ReviewController],
  providers: [RedisService, QueuesService, AuthService, ChannelsService, BillingService, SessionMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // NestJS 11 uses path-to-regexp v8: wildcards are named (`{*path}`), not `(.*)`.
    consumer.apply(SessionMiddleware).exclude('webhooks/{*path}', 'stripe/{*path}', 'r/{*path}', 'health', 'oauth/bluesky/{*path}', 'share/{*path}').forRoutes('{*path}');
  }
}
