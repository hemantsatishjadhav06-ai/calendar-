import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import pino from 'pino';
import { env } from '@relay/config';

export const log = pino({ name: 'worker', level: process.env.LOG_LEVEL ?? 'info' });
export const connection = { url: env.REDIS_URL } as any;
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
export const WORKER_ID = `${process.env.HOSTNAME ?? 'local'}:${process.pid}`;

const queues = new Map<string, Queue>();
export const queue = (name: string) => { let q = queues.get(name); if (!q) { q = new Queue(name, { connection, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 } }); queues.set(name, q); } return q; };

/** Publish an event to the API's SSE bus (same Redis channel convention as apps/api events.bus.ts). */
export const emit = (organizationId: string, e: Record<string, any>) => redis.publish(`events:${organizationId}`, JSON.stringify({ ...e, at: Date.now() })).catch(() => undefined);
