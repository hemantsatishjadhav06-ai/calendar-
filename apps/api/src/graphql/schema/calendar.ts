import { builder } from '../builder.js';

/** Campaign / holiday / launch annotations overlaid on the publishing calendar. */
builder.prismaObject('CalendarEvent', {
  fields: t => ({
    id: t.exposeID('id'),
    title: t.exposeString('title'),
    startDate: t.expose('startDate', { type: 'DateTime' }),
    endDate: t.expose('endDate', { type: 'DateTime' }),
    color: t.exposeString('color'),
    note: t.exposeString('note', { nullable: true }),
  }),
});

const onlyDate = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

builder.queryFields(t => ({
  calendarEvents: t.prismaField({
    type: ['CalendarEvent'], authScopes: { user: true },
    args: { from: t.arg({ type: 'DateTime' }), to: t.arg({ type: 'DateTime' }) },
    resolve: (q, _r, a, ctx) => ctx.db!.calendarEvent.findMany({
      ...q,
      where: {
        organizationId: ctx.tenant!.organizationId,
        ...(a.from || a.to ? { startDate: { lte: a.to ?? undefined }, endDate: { gte: a.from ?? undefined } } : {}),
      },
      orderBy: { startDate: 'asc' },
    }),
  }),
}));

builder.mutationFields(t => ({
  createCalendarEvent: t.prismaField({
    type: 'CalendarEvent', authScopes: { user: true },
    args: { title: t.arg.string({ required: true }), startDate: t.arg({ type: 'DateTime', required: true }), endDate: t.arg({ type: 'DateTime' }), color: t.arg.string(), note: t.arg.string() },
    resolve: (q, _r, a, ctx) => ctx.db!.calendarEvent.create({ ...q, data: { organizationId: ctx.tenant!.organizationId, createdByAccountId: ctx.account!.id, title: a.title.slice(0, 120), startDate: onlyDate(a.startDate), endDate: onlyDate(a.endDate ?? a.startDate), color: (a.color ?? '#F79009').slice(0, 9), note: a.note?.slice(0, 500) ?? null } }),
  }),
  updateCalendarEvent: t.prismaField({
    type: 'CalendarEvent', authScopes: { user: true },
    args: { id: t.arg.id({ required: true }), title: t.arg.string(), startDate: t.arg({ type: 'DateTime' }), endDate: t.arg({ type: 'DateTime' }), color: t.arg.string(), note: t.arg.string() },
    resolve: async (q, _r, a, ctx) => {
      await ctx.db!.calendarEvent.findFirstOrThrow({ where: { id: String(a.id), organizationId: ctx.tenant!.organizationId } });
      return ctx.db!.calendarEvent.update({ ...q, where: { id: String(a.id) }, data: {
        ...(a.title != null ? { title: a.title.slice(0, 120) } : {}),
        ...(a.startDate ? { startDate: onlyDate(a.startDate) } : {}),
        ...(a.endDate ? { endDate: onlyDate(a.endDate) } : {}),
        ...(a.color ? { color: a.color.slice(0, 9) } : {}),
        ...(a.note !== undefined ? { note: a.note?.slice(0, 500) ?? null } : {}),
      } });
    },
  }),
  deleteCalendarEvent: t.boolean({
    authScopes: { user: true }, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => { await ctx.db!.calendarEvent.deleteMany({ where: { id: String(a.id), organizationId: ctx.tenant!.organizationId } }); return true; },
  }),
}));
