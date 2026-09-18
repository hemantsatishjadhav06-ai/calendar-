import pino from 'pino';
import { Queue } from 'bullmq';
import { connection } from './infra.js';
import { dispatcherWorker } from './dispatcher.js';
import { publishWorker } from './publish.processor.js';
import { notifyWorker } from './notify.processor.js';
import { mediaWorker } from './media.processor.js';
import { metricsWorker } from './metrics.processor.js';
import { inboxWorker } from './inbox.processor.js';
import { housekeepingWorker } from './housekeeping.processor.js';
import { aiWorker } from './ai.processor.js';

const log = pino({ name: 'worker' });
const role = process.env.WORKER_ROLE ?? 'all';   // all | publish | media | metrics | inbox | housekeeping — for separate deployments/scaling

const workers = {
  dispatcher: () => dispatcherWorker(),
  publish: () => publishWorker(),
  notify: () => notifyWorker(),
  media: () => mediaWorker(),
  metrics: () => metricsWorker(),
  inbox: () => inboxWorker(),
  housekeeping: () => housekeepingWorker(),
  ai: () => aiWorker(),
};
const enabled = role === 'all' ? Object.keys(workers) : role === 'publish' ? ['dispatcher', 'publish', 'notify'] : [role];
const running = enabled.map(k => (workers as any)[k]());
log.info({ enabled }, 'workers started');

/** Repeatable schedules (idempotent: BullMQ dedupes by jobId). */
async function schedule() {
  const add = async (queue: string, name: string, every: number | string, data: any = {}) => {
    const q = new Queue(queue, { connection });
    await q.add(name, data, { repeat: typeof every === 'number' ? { every } : { pattern: every }, jobId: `${queue}-${name}-repeat` });
    await q.close();
  };
  await add('dispatcher', 'tick', 60_000);
  await add('housekeeping', 'token-health-sweep', '15 3 * * *');
  await add('housekeeping', 'stuck-publishing', 5 * 60_000);
  await add('housekeeping', 'expire-drafts', '0 * * * *');
  await add('housekeeping', 'empty-queue-alerts', '0 9 * * *');
  await add('housekeeping', 'comment-digests', '0 * * * *');
  await add('housekeeping', 'pubsub-renew', '0 */12 * * *');
  await add('metrics', 'schedule-daily', '0 * * * *');            // hourly: enqueue channels whose local time is ~02:00
  await add('metrics', 'refresh-recent-posts', '30 */6 * * *');
  await add('metrics', 'discover-native-posts', '45 4 * * *');
  await add('inbox', 'schedule-polls', 2 * 60_000);
}
schedule().catch(e => log.error(e, 'schedule failed'));

const shutdown = async () => { log.info('shutting down'); await Promise.all(running.map(w => w.close())); process.exit(0); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
