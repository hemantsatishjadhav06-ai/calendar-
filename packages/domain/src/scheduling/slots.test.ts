import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { assignQueue, nextFreeSlots, slotInstants } from './slots.js';

describe('slotInstants', () => {
  it('yields ascending instants in channel timezone', () => {
    const slots = [{ weekday: 1, minuteOfDay: 9 * 60, enabled: true }, { weekday: 3, minuteOfDay: 17 * 60, enabled: true }];
    const it = slotInstants(slots, 'Asia/Kolkata', new Date('2026-09-14T00:00:00Z'));
    const a = it.next().value!, b = it.next().value!;
    expect(a.setZone('Asia/Kolkata').toFormat('ccc HH:mm')).toBe('Mon 09:00');
    expect(b.setZone('Asia/Kolkata').toFormat('ccc HH:mm')).toBe('Wed 17:00');
    expect(b > a).toBe(true);
  });
  it('handles a DST gap (Europe/London 2026-03-29 01:30 does not exist)', () => {
    const slots = [{ weekday: 0, minuteOfDay: 90, enabled: true }];
    const [first] = slotInstants(slots, 'Europe/London', new Date('2026-03-28T12:00:00Z'));
    expect(DateTime.fromJSDate(first.toJSDate(), { zone: 'Europe/London' }).toFormat('yyyy-MM-dd HH:mm')).toBe('2026-03-29 02:30');
  });
  it('yields nothing when no slots are enabled', () => {
    expect([...slotInstants([{ weekday: 1, minuteOfDay: 0, enabled: false }], 'UTC', new Date())]).toEqual([]);
  });
});

describe('assignQueue', () => {
  const slots = [1, 2, 3].map(weekday => ({ weekday, minuteOfDay: 10 * 60, enabled: true }));
  it('assigns in position order and skips taken instants', () => {
    const now = new Date('2026-09-13T00:00:00Z'); // Sunday
    const monday = DateTime.fromISO('2026-09-14T10:00', { zone: 'UTC' }).toJSDate();
    const out = assignQueue([{ id: 'b', queuePosition: 1 }, { id: 'a', queuePosition: 0 }], [monday], slots, 'UTC', now);
    expect(out.map(o => o.id)).toEqual(['a', 'b']);
    expect(out[0].dueAt!.toISOString()).toBe('2026-09-15T10:00:00.000Z'); // Monday taken → Tuesday
    expect(out[1].dueAt!.toISOString()).toBe('2026-09-16T10:00:00.000Z');
  });
  it('never assigns the same instant twice', () => {
    const out = assignQueue(Array.from({ length: 10 }, (_, i) => ({ id: String(i), queuePosition: i })), [], slots, 'UTC', new Date());
    expect(new Set(out.map(o => o.dueAt!.getTime())).size).toBe(10);
  });
  it('returns null dueAt when there are no slots', () => {
    expect(assignQueue([{ id: 'x', queuePosition: 0 }], [], [], 'UTC', new Date())[0].dueAt).toBeNull();
  });
});

describe('nextFreeSlots', () => {
  it('returns n suggestions', () => {
    const slots = [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, minuteOfDay: 12 * 60, enabled: true }));
    expect(nextFreeSlots(slots, 'UTC', [], new Date(), 5)).toHaveLength(5);
  });
});
