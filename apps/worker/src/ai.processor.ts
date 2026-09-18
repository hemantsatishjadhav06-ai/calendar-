import { Worker, type Job } from 'bullmq';
import { prismaAdmin } from '@relay/db';
import { embedText } from '@relay/ai';
import { connection } from './infra.js';

/** Background AI jobs: comment embeddings for "similar replies", weekly takeaways precompute. */
export function aiWorker() {
  return new Worker('ai', async (job: Job) => {
    if (job.name === 'embed-comment') {
      const c = await prismaAdmin.comment.findUnique({ where: { id: job.data.commentId } });
      if (!c || !c.text.trim()) return 'skip';
      const v = await embedText(c.text.slice(0, 2000));
      await prismaAdmin.$executeRaw`UPDATE "Comment" SET embedding = ${JSON.stringify(v)}::vector WHERE id = ${c.id}::uuid`;
      return 'embedded';
    }
    return 'unknown';
  }, { connection, concurrency: 4 });
}
