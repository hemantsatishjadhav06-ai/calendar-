import { prismaAdmin, type Prisma, type PostTarget, type Channel, type TenantPrisma } from '@cadence/db';
import { rulesFor, validateTarget, hasErrors, type Issue, type MediaLite } from '@cadence/network-rules';
import { QueueOps, assertCan, requiresApproval, DomainError, entitlement, isAdmin, extractHashtags, type TenantContext } from '@cadence/domain';
import { within } from '@cadence/entitlements';
import { QueuesService } from '../infra/queues.service.js';
import { ShortenerService } from '../links/shortener.service.js';
import { events } from '../events/events.bus.js';
import { pushNotification, pushToMany } from '../notifications/notify.js';
import { mail } from '../mail/mail.js';
import { env } from '@cadence/config';

export interface TargetInput {
  channelId: string;
  text?: string | null;               // null/undefined → inherits base text
  media?: MediaLite[] | null;
  thread?: { text: string; media: MediaLite[] }[] | null;
  firstComment?: string | null;
  metadata?: Record<string, any> | null;
  schedulingType?: 'AUTOMATIC' | 'NOTIFICATION' | null;
}
export interface CreatePostInput {
  baseText: string;
  baseMedia?: MediaLite[];
  linkPreview?: { url: string; title?: string; description?: string; imageAssetId?: string } | null;
  targets: TargetInput[];
  mode: 'QUEUE' | 'SHARE_NEXT' | 'CUSTOM' | 'NOW' | 'DRAFT';
  dueAt?: Date | null;                // CUSTOM: same instant for all targets (UI may send per-target overrides)
  dueAtByChannel?: Record<string, Date> | null;
  tagIds?: string[];
  requestApproval?: boolean;
  ideaId?: string | null;
  templateId?: string | null;
  aiAssisted?: boolean;
  autoRepost?: 'OFF' | 'ALWAYS' | 'SMART';
  recurrence?: { freq: 'DAILY' | 'WEEKLY' | 'MONTHLY'; interval?: number; count: number } | null;
}

/** Shift a date forward by n periods of the given frequency (month-aware). */
function addPeriods(base: Date, freq: 'DAILY' | 'WEEKLY' | 'MONTHLY', n: number): Date {
  const d = new Date(base);
  if (freq === 'DAILY') d.setDate(d.getDate() + n);
  else if (freq === 'WEEKLY') d.setDate(d.getDate() + n * 7);
  else d.setMonth(d.getMonth() + n);
  return d;
}

const queues = new QueuesService();
const shortener = new ShortenerService();

export class PostsService {
  constructor(private db: TenantPrisma, private tenant: TenantContext, private account: { id: string; name?: string | null; email: string }) {}

  /** Validate every target without persisting (composer live check on the server, and API pre-flight). */
  async validate(input: CreatePostInput, premiumByChannel: Record<string, boolean> = {}): Promise<Record<string, Issue[]>> {
    const channels = await this.channels(input.targets.map(t => t.channelId));
    const out: Record<string, Issue[]> = {};
    for (const t of input.targets) {
      const ch = channels.get(t.channelId)!;
      const rules = rulesFor(ch.network);
      const draft = { text: t.text ?? input.baseText, media: t.media ?? input.baseMedia ?? [], thread: t.thread ?? [], metadata: t.metadata ?? {}, firstComment: t.firstComment ?? undefined };
      out[t.channelId] = validateTarget(rules, draft, { channel: { meta: ch.meta as any, subtype: ch.subtype }, metadata: draft.metadata, media: draft.media, premium: premiumByChannel[t.channelId] ?? !!(ch.meta as any)?.premium });
    }
    return out;
  }

  async create(input: CreatePostInput) {
    const tenant = this.tenant;
    if (!input.targets.length) throw new DomainError('VALIDATION', 'Select at least one channel', 'targets');
    const channels = await this.channels(input.targets.map(t => t.channelId));
    for (const ch of channels.values()) {
      assertCan(tenant, 'post.create', ch.id);
      if (ch.status === 'LOCKED') throw new DomainError('ENTITLEMENT', `${ch.displayName} is locked on your current plan`);
    }
    // Entitlements
    const ent = tenant.entitlements;
    if (input.targets.some(t => t.firstComment) && !ent.firstComment) throw entitlement('First comment is available on paid plans', 'firstComment');
    if (input.mode === 'SHARE_NEXT' && !ent.shareNext) throw entitlement('Share next is available on paid plans', 'shareNext');
    const threadCount = input.targets.filter(t => (t.thread?.length ?? 0) > 0).length;
    if (threadCount && ent.threadsScheduledPerQueue !== 'unlimited' && input.mode !== 'DRAFT') {
      for (const t of input.targets) if (t.thread?.length) { const n = await this.db.postTarget.count({ where: { channelId: t.channelId, status: { in: ['QUEUED', 'SCHEDULED'] }, NOT: { thread: { equals: [] } } } }); if (n >= ent.threadsScheduledPerQueue) throw entitlement('Free plans can schedule one thread at a time per channel', 'threads'); }
    }
    if (input.mode !== 'DRAFT') for (const t of input.targets) { const n = await this.db.postTarget.count({ where: { channelId: t.channelId, status: { in: ['QUEUED', 'SCHEDULED'] } } }); if (!within(ent.scheduledPerChannel, n)) throw entitlement(`Your plan allows ${ent.scheduledPerChannel} scheduled posts per channel`, 'scheduledPerChannel'); }
    if (input.tagIds?.length && input.tagIds.length > ent.tags) throw entitlement(`Your plan allows ${ent.tags} tags`, 'tags');

    // Validation (authoritative)
    const issues = await this.validate(input);
    const blocking = Object.entries(issues).filter(([, v]) => hasErrors(v));
    if (blocking.length && input.mode !== 'DRAFT') throw new DomainError('VALIDATION', `Fix ${blocking.length} channel${blocking.length > 1 ? 's' : ''} before scheduling`, 'targets', { issues });

    // Approval routing
    const needsApproval = input.requestApproval || input.targets.some(t => requiresApproval(tenant, t.channelId));
    const mode = input.mode;
    const postStatus = mode === 'DRAFT' ? 'DRAFT' : needsApproval ? 'PENDING_APPROVAL' : mode === 'CUSTOM' || mode === 'NOW' ? 'SCHEDULED' : 'QUEUED';

    const post = await this.db.tx(async tx => {
      const post = await tx.post.create({ data: {
        organizationId: tenant.organizationId, createdByAccountId: this.account.id, status: postStatus, scheduleMode: mode,
        baseText: input.baseText, baseMedia: (input.baseMedia ?? []) as any, linkPreview: input.linkPreview as any ?? undefined, ideaId: input.ideaId ?? undefined, templateId: input.templateId ?? undefined, aiAssisted: !!input.aiAssisted, autoRepost: input.autoRepost ?? 'OFF',
        tags: { create: (input.tagIds ?? []).map(tagId => ({ tagId })) },
        approval: needsApproval && mode !== 'DRAFT' ? { create: { requestedByAccountId: this.account.id } } : undefined,
      } });
      for (const t of input.targets) {
        const ch = channels.get(t.channelId)!;
        const text = t.text ?? input.baseText;
        const media = (t.media ?? input.baseMedia ?? []) as any;
        const metadata = { ...(t.metadata ?? {}), hashtags: extractHashtags(text + ' ' + (t.firstComment ?? '')) };
        const schedulingType = t.schedulingType ?? (ch.notifyByDefault && rulesFor(ch.network).features.notifyMe ? 'NOTIFICATION' : 'AUTOMATIC');
        const targetStatus = postStatus === 'PENDING_APPROVAL' ? 'PENDING_APPROVAL' : postStatus === 'DRAFT' ? 'DRAFT' : mode === 'CUSTOM' || mode === 'NOW' ? 'SCHEDULED' : 'QUEUED';
        const dueAt = mode === 'NOW' ? new Date() : mode === 'CUSTOM' ? (input.dueAtByChannel?.[t.channelId] ?? input.dueAt ?? null) : null;
        if (mode === 'CUSTOM' && !dueAt) throw new DomainError('VALIDATION', 'Choose a date and time', 'dueAt');
        if (mode === 'CUSTOM' && dueAt && dueAt.getTime() < Date.now() - 60_000) throw new DomainError('VALIDATION', 'That time is in the past', 'dueAt');
        await tx.postTarget.create({ data: {
          organizationId: tenant.organizationId, postId: post.id, channelId: ch.id, status: targetStatus, schedulingType, customized: t.text != null || t.media != null || (t.thread?.length ?? 0) > 0,
          isCustomTime: mode === 'CUSTOM' || mode === 'NOW', dueAt, text, media, thread: (t.thread ?? []) as any, firstComment: t.firstComment ?? null, metadata, linkPreviewUrl: input.linkPreview?.url ?? null,
        } });
      }
      return post;
    });

    // Link shortening (per target; needs the target id for click attribution), then queue placement
    const targets = await this.db.postTarget.findMany({ where: { postId: post.id }, include: { channel: true } });
    for (const t of targets) {
      const { text, links } = await shortener.processText(t.text, { organizationId: tenant.organizationId, channel: t.channel, postTargetId: t.id, tagName: undefined });
      if (text !== t.text || links.length) await this.db.postTarget.update({ where: { id: t.id }, data: { text, shortLinks: links as any } });
    }
    await this.place(targets, mode, postStatus);

    if (postStatus === 'PENDING_APPROVAL') await this.notifyApprovers(post.id, targets);
    if (input.ideaId) await this.db.idea.updateMany({ where: { id: input.ideaId }, data: { usedAt: new Date() } });
    for (const ch of channels.values()) events.publish(tenant.organizationId, { type: 'queue.changed', channelId: ch.id });
    await prismaAdmin.auditLog.create({ data: { organizationId: tenant.organizationId, actorAccountId: this.account.id, action: 'post.create', entity: 'Post', entityId: post.id, diff: { mode, channels: [...channels.keys()] } } });

    // Recurrence: materialise the following occurrences up front as independent scheduled posts,
    // shifting each time forward. Only for a fixed-time (CUSTOM) post; bounded to 12 occurrences.
    // Stops quietly if a later occurrence trips a plan cap so we never half-spam the queue.
    const rec = input.recurrence;
    if (rec && mode === 'CUSTOM' && (input.dueAt || input.dueAtByChannel)) {
      const count = Math.min(12, Math.max(2, rec.count));
      const interval = Math.min(30, Math.max(1, rec.interval ?? 1));
      const shiftMap = (n: number) => input.dueAtByChannel ? Object.fromEntries(Object.entries(input.dueAtByChannel).map(([k, v]) => [k, addPeriods(new Date(v as any), rec.freq, n * interval)])) : undefined;
      for (let n = 1; n < count; n++) {
        try {
          await this.create({ ...input, recurrence: null, requestApproval: input.requestApproval, ideaId: null, dueAt: input.dueAt ? addPeriods(new Date(input.dueAt), rec.freq, n * interval) : null, dueAtByChannel: shiftMap(n) });
        } catch { break; }
      }
    }
    return this.db.post.findUniqueOrThrow({ where: { id: post.id }, include: { targets: { include: { channel: true } }, tags: { include: { tag: true } }, approval: true } });
  }

  /** Put targets into the queue / schedule according to mode; called after create, approve, re-add. */
  async place(targets: (PostTarget & { channel: Channel })[], mode: CreatePostInput['mode'], status: string) {
    if (status === 'DRAFT' || status === 'PENDING_APPROVAL') return;
    const ops = new QueueOps(prismaAdmin);
    for (const t of targets) {
      if (mode === 'QUEUE') await ops.addToQueue(t.id, t.channelId);
      else if (mode === 'SHARE_NEXT') await ops.moveToTop(t.id, t.channelId);
      else if (mode === 'CUSTOM') await ops.setCustomTime(t.id, t.channelId, t.dueAt!);
      else if (mode === 'NOW') { await ops.shareNow(t.id); await queues.enqueuePublish({ id: t.id, channelId: t.channelId, organizationId: t.organizationId, dueAt: new Date(), schedulingType: t.schedulingType }); }
    }
  }

  async update(postId: string, input: Partial<CreatePostInput> & { targets?: TargetInput[] }) {
    const post = await this.db.post.findFirstOrThrow({ where: { id: postId, organizationId: this.tenant.organizationId, deletedAt: null }, include: { targets: { include: { channel: true } } } });
    for (const t of post.targets) {
      if (t.status === 'PUBLISHED' || t.status === 'PUBLISHING') throw new DomainError('CONFLICT', 'Published posts cannot be edited');
      assertCan(this.tenant, 'post.create', t.channelId);
    }
    if (post.createdByAccountId !== this.account.id && !isAdmin(this.tenant) && post.targets.some(t => !this.canPublish(t.channelId))) throw new DomainError('FORBIDDEN', 'You can only edit your own posts');
    const baseText = input.baseText ?? post.baseText;
    const baseMedia = (input.baseMedia ?? post.baseMedia) as any;
    await this.db.tx(async tx => {
      await tx.post.update({ where: { id: postId }, data: { baseText, baseMedia, ...(input.autoRepost !== undefined ? { autoRepost: input.autoRepost } : {}), ...(input.linkPreview !== undefined ? { linkPreview: input.linkPreview as any } : {}), ...(input.tagIds ? { tags: { deleteMany: {}, create: input.tagIds.map(tagId => ({ tagId })) } } : {}) } });
      for (const t of post.targets) {
        const ti = input.targets?.find(x => x.channelId === t.channelId);
        const text = ti?.text ?? (t.customized ? t.text : baseText);
        const media = (ti?.media ?? (t.customized ? t.media : baseMedia)) as any;
        const ch = t.channel; const rules = rulesFor(ch.network);
        const draft = { text, media, thread: (ti?.thread ?? (t.thread as any)) ?? [], metadata: ti?.metadata ?? (t.metadata as any), firstComment: ti?.firstComment ?? t.firstComment ?? undefined };
        const issues = validateTarget(rules, draft, { channel: { meta: ch.meta as any, subtype: ch.subtype }, metadata: draft.metadata, media, premium: !!(ch.meta as any)?.premium });
        if (hasErrors(issues) && t.status !== 'DRAFT') throw new DomainError('VALIDATION', `Fix issues on ${ch.displayName}`, 'targets', { issues: { [ch.id]: issues } });
        await tx.postTarget.update({ where: { id: t.id }, data: { text, media, thread: draft.thread as any, metadata: { ...draft.metadata, hashtags: extractHashtags(text + ' ' + (draft.firstComment ?? '')) }, firstComment: draft.firstComment ?? null, customized: ti?.text != null || ti?.media != null || t.customized, ...(ti?.schedulingType ? { schedulingType: ti.schedulingType } : {}) } });
      }
    });
    // Targets for channels that were added/removed in the composer
    if (input.targets) {
      const existing = new Set(post.targets.map(t => t.channelId));
      const added = input.targets.filter(t => !existing.has(t.channelId));
      const removed = post.targets.filter(t => !input.targets!.some(x => x.channelId === t.channelId));
      for (const r of removed) { await this.db.postTarget.delete({ where: { id: r.id } }); await new QueueOps(prismaAdmin).reflow(r.channelId); }
      if (added.length) {
        const channels = await this.channels(added.map(a => a.channelId));
        for (const a of added) { const ch = channels.get(a.channelId)!; assertCan(this.tenant, 'post.create', ch.id); const created = await this.db.postTarget.create({ data: { organizationId: this.tenant.organizationId, postId, channelId: ch.id, status: post.status === 'DRAFT' ? 'DRAFT' : 'QUEUED', text: a.text ?? baseText, media: (a.media ?? baseMedia) as any, thread: (a.thread ?? []) as any, firstComment: a.firstComment ?? null, metadata: a.metadata ?? {}, customized: a.text != null }, include: { channel: true } }); if (post.status !== 'DRAFT' && post.status !== 'PENDING_APPROVAL') await new QueueOps(prismaAdmin).addToQueue(created.id, created.channelId); }
      }
    }
    // Optional reschedule from the composer's edit mode
    if (input.mode && input.mode !== 'DRAFT' && !['DRAFT', 'PENDING_APPROVAL'].includes(post.status)) {
      const ops = new QueueOps(prismaAdmin);
      const all = await this.db.postTarget.findMany({ where: { postId, status: { in: ['QUEUED', 'SCHEDULED', 'FAILED'] } } });
      for (const t of all) {
        if (input.mode === 'CUSTOM') { const at = input.dueAtByChannel?.[t.channelId] ?? input.dueAt; if (!at) throw new DomainError('VALIDATION', 'Choose a date and time', 'dueAt'); await ops.setCustomTime(t.id, t.channelId, at); }
        else if (input.mode === 'SHARE_NEXT') await ops.moveToTop(t.id, t.channelId);
        else if (input.mode === 'QUEUE') await ops.addToQueue(t.id, t.channelId);
        else if (input.mode === 'NOW') { await ops.shareNow(t.id); await queues.enqueuePublish({ id: t.id, channelId: t.channelId, organizationId: t.organizationId, dueAt: new Date(), schedulingType: t.schedulingType }); }
      }
      await this.db.post.update({ where: { id: postId }, data: { scheduleMode: input.mode, status: input.mode === 'QUEUE' || input.mode === 'SHARE_NEXT' ? 'QUEUED' : 'SCHEDULED' } });
    }
    for (const t of post.targets) events.publish(this.tenant.organizationId, { type: 'target.updated', targetId: t.id });
    return this.db.post.findUniqueOrThrow({ where: { id: postId }, include: { targets: { include: { channel: true } }, tags: { include: { tag: true } }, approval: true } });
  }

  async delete(postId: string) {
    const post = await this.db.post.findFirstOrThrow({ where: { id: postId, organizationId: this.tenant.organizationId }, include: { targets: true } });
    for (const t of post.targets) if (!(isAdmin(this.tenant) || this.canPublish(t.channelId) || (post.createdByAccountId === this.account.id && ['DRAFT', 'PENDING_APPROVAL'].includes(t.status)))) throw new DomainError('FORBIDDEN', 'You cannot delete this post');
    await this.db.post.update({ where: { id: postId }, data: { deletedAt: new Date(), status: 'CANCELLED' } });
    await this.db.postTarget.updateMany({ where: { postId, status: { notIn: ['PUBLISHED'] } }, data: { status: 'CANCELLED', dueAt: null, queuePosition: null } });
    for (const t of post.targets) { await new QueueOps(prismaAdmin).reflow(t.channelId); events.publish(this.tenant.organizationId, { type: 'queue.changed', channelId: t.channelId }); }
  }

  async duplicate(postId: string, asDraft = true) {
    const post = await this.db.post.findFirstOrThrow({ where: { id: postId, organizationId: this.tenant.organizationId }, include: { targets: true, tags: true } });
    const shareAgainDays = this.tenant.entitlements.shareAgainDays;
    if (shareAgainDays !== 'unlimited') { const limitMs = shareAgainDays * 864e5; if (post.targets.some(t => t.publishedAt && Date.now() - t.publishedAt.getTime() > limitMs)) throw entitlement('Free plans can share again posts from the last 30 days', 'shareAgain'); }
    return this.create({ baseText: post.baseText, baseMedia: post.baseMedia as any, linkPreview: post.linkPreview as any, tagIds: post.tags.map(t => t.tagId), mode: asDraft ? 'DRAFT' : 'QUEUE', targets: post.targets.map(t => ({ channelId: t.channelId, text: t.customized ? t.text : null, media: t.customized ? (t.media as any) : null, thread: t.thread as any, firstComment: t.firstComment, metadata: t.metadata as any, schedulingType: t.schedulingType })) });
  }

  // ---- approvals
  async approve(postId: string, decision: { mode: 'QUEUE' | 'CUSTOM' | 'NOW'; dueAt?: Date | null }) {
    const post = await this.db.post.findFirstOrThrow({ where: { id: postId, organizationId: this.tenant.organizationId, status: 'PENDING_APPROVAL' }, include: { targets: { include: { channel: true } }, approval: true } });
    for (const t of post.targets) assertCan(this.tenant, 'post.approve', t.channelId);
    const status = decision.mode === 'QUEUE' ? 'QUEUED' : 'SCHEDULED';
    await this.db.tx(async tx => {
      await tx.post.update({ where: { id: postId }, data: { status, scheduleMode: decision.mode } });
      await tx.postTarget.updateMany({ where: { postId }, data: { status, isCustomTime: decision.mode !== 'QUEUE', dueAt: decision.mode === 'NOW' ? new Date() : decision.mode === 'CUSTOM' ? decision.dueAt : null } });
      await tx.approval.update({ where: { postId }, data: { decidedByAccountId: this.account.id, decidedAt: new Date(), decision: 'APPROVED' } });
    });
    const targets = await this.db.postTarget.findMany({ where: { postId }, include: { channel: true } });
    await this.place(targets, decision.mode, status);
    const requester = await prismaAdmin.account.findUnique({ where: { id: post.approval!.requestedByAccountId } });
    const chNames = targets.map(t => t.channel.displayName).join(', ');
    if (requester) await mail.send({ to: requester.email, template: 'approval_decided', data: { channel: chNames, decision: 'Approved', url: `${env.APP_URL}/channels/${targets[0]?.channelId}/queue` } });
    if (post.approval!.requestedByAccountId !== this.account.id) await pushNotification({ organizationId: this.tenant.organizationId, accountId: post.approval!.requestedByAccountId, type: 'approval.approved', title: 'Post approved', body: `${this.account.name ?? this.account.email} approved your post for ${chNames}`, url: `/channels/${targets[0]?.channelId}/queue` });
    for (const t of targets) events.publish(this.tenant.organizationId, { type: 'queue.changed', channelId: t.channelId });
  }
  async reject(postId: string, reason?: string) {
    const post = await this.db.post.findFirstOrThrow({ where: { id: postId, organizationId: this.tenant.organizationId, status: 'PENDING_APPROVAL' }, include: { targets: { include: { channel: true } }, approval: true } });
    for (const t of post.targets) assertCan(this.tenant, 'post.approve', t.channelId);
    await this.db.tx(async tx => {
      await tx.post.update({ where: { id: postId }, data: { status: 'DRAFT' } });
      await tx.postTarget.updateMany({ where: { postId }, data: { status: 'DRAFT', dueAt: null, queuePosition: null } });
      await tx.approval.update({ where: { postId }, data: { decidedByAccountId: this.account.id, decidedAt: new Date(), decision: 'REJECTED', reason } });
      if (reason) await tx.note.create({ data: { organizationId: this.tenant.organizationId, postId, authorAccountId: this.account.id, body: `Rejected: ${reason}` } });
    });
    const requester = await prismaAdmin.account.findUnique({ where: { id: post.approval!.requestedByAccountId } });
    const chNames = post.targets.map(t => t.channel.displayName).join(', ');
    if (requester) await mail.send({ to: requester.email, template: 'approval_decided', data: { channel: chNames, decision: 'Rejected', reason, url: `${env.APP_URL}/channels/${post.targets[0]?.channelId}/drafts` } });
    if (post.approval!.requestedByAccountId !== this.account.id) await pushNotification({ organizationId: this.tenant.organizationId, accountId: post.approval!.requestedByAccountId, type: 'approval.rejected', title: 'Changes requested', body: `${this.account.name ?? this.account.email} requested changes on your post${reason ? `: ${reason}` : ''}`, url: `/channels/${post.targets[0]?.channelId}/drafts` });
  }
  async requestApproval(postId: string) {
    const post = await this.db.post.findFirstOrThrow({ where: { id: postId, organizationId: this.tenant.organizationId, status: 'DRAFT' }, include: { targets: { include: { channel: true } } } });
    await this.db.tx(async tx => {
      await tx.post.update({ where: { id: postId }, data: { status: 'PENDING_APPROVAL' } });
      await tx.postTarget.updateMany({ where: { postId }, data: { status: 'PENDING_APPROVAL' } });
      await tx.approval.upsert({ where: { postId }, create: { postId, requestedByAccountId: this.account.id }, update: { requestedByAccountId: this.account.id, requestedAt: new Date(), decidedAt: null, decision: null, reason: null } });
    });
    await this.notifyApprovers(postId, post.targets);
  }
  async revertApproval(postId: string) {
    const post = await this.db.post.findFirstOrThrow({ where: { id: postId, organizationId: this.tenant.organizationId, status: 'PENDING_APPROVAL' }, include: { approval: true } });
    if (post.approval?.requestedByAccountId !== this.account.id && !isAdmin(this.tenant)) throw new DomainError('FORBIDDEN', 'Only the requester can revert');
    await this.db.tx(async tx => { await tx.post.update({ where: { id: postId }, data: { status: 'DRAFT' } }); await tx.postTarget.updateMany({ where: { postId }, data: { status: 'DRAFT' } }); await tx.approval.update({ where: { postId }, data: { decision: 'REVERTED', decidedAt: new Date() } }); });
  }

  private async notifyApprovers(postId: string, targets: (PostTarget & { channel: Channel })[]) {
    const members = await prismaAdmin.membership.findMany({ where: { organizationId: this.tenant.organizationId, status: 'ACTIVE' }, include: { account: true, channelGrants: true } });
    const approvers = members.filter(m => m.role !== 'MEMBER' || targets.every(t => m.channelGrants.find(g => g.channelId === t.channelId)?.publish === 'FULL'));
    const preview = targets[0]?.text.slice(0, 120) ?? '';
    const chNames = targets.map(t => t.channel.displayName).join(', ');
    for (const m of approvers) if (m.accountId !== this.account.id) await mail.send({ to: m.account.email, template: 'approval_requested', data: { requester: this.account.name ?? this.account.email, channel: chNames, preview, url: `${env.APP_URL}/channels/${targets[0]?.channelId}/approvals` } });
    await pushToMany(approvers.map(m => m.accountId), { organizationId: this.tenant.organizationId, type: 'approval.requested', title: 'Approval requested', body: `${this.account.name ?? this.account.email} needs your approval for ${chNames}`, url: `/channels/${targets[0]?.channelId}/approvals` }, this.account.id);
    events.publish(this.tenant.organizationId, { type: 'approval.requested', postId });
  }

  private canPublish(channelId: string) { return isAdmin(this.tenant) || this.tenant.channelPermissions[channelId]?.publish === 'FULL'; }
  private async channels(ids: string[]) {
    const rows = await this.db.channel.findMany({ where: { id: { in: ids }, organizationId: this.tenant.organizationId, deletedAt: null } });
    if (rows.length !== new Set(ids).size) throw new DomainError('NOT_FOUND', 'One or more channels were not found');
    return new Map(rows.map(r => [r.id, r]));
  }
}
export type { Prisma };
