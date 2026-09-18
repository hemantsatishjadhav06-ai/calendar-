import { DateTime } from 'luxon';

export interface Slot { weekday: number; minuteOfDay: number; enabled: boolean }

/** Luxon weekday is 1=Mon..7=Sun; we store 0=Sun..6=Sat. */
const toOurWeekday = (luxonWeekday: number) => luxonWeekday % 7;

/** Lazily yields slot instants (UTC DateTime) for a channel schedule from `from`, ascending. */
export function* slotInstants(slots: Slot[], zone: string, from: Date): Generator<DateTime> {
  const enabled = slots.filter(s => s.enabled).sort((a, b) => a.weekday - b.weekday || a.minuteOfDay - b.minuteOfDay);
  if (enabled.length === 0) return;
  const start = DateTime.fromJSDate(from, { zone });
  let day = start.startOf('day');
  for (let i = 0; i < 366 * 5; i++) {
    const wd = toOurWeekday(day.weekday);
    for (const s of enabled) {
      if (s.weekday !== wd) continue;
      // plus() on a local-day start handles DST gaps/overlaps (01:30 on a spring-forward day resolves to the next valid instant)
      const t = day.plus({ minutes: s.minuteOfDay });
      if (t >= start) yield t.toUTC();
    }
    day = day.plus({ days: 1 });
  }
}

export interface QueueAssignment { id: string; dueAt: Date | null }

/**
 * Assign dueAt to QUEUE-mode targets in queuePosition order, skipping instants taken by custom-time targets.
 * Targets that cannot be placed (no slots) get dueAt=null so the UI can show "Add posting times".
 */
export function assignQueue(
  queued: { id: string; queuePosition: number }[],
  taken: Date[],
  slots: Slot[],
  zone: string,
  now: Date,
): QueueAssignment[] {
  const takenSet = new Set(taken.map(d => d.getTime()));
  const it = slotInstants(slots, zone, new Date(now.getTime() + 60_000)); // never assign a slot within the next minute
  const out: QueueAssignment[] = [];
  for (const t of [...queued].sort((a, b) => a.queuePosition - b.queuePosition)) {
    let next = it.next();
    while (!next.done && takenSet.has(next.value.toMillis())) next = it.next();
    if (next.done) { out.push({ id: t.id, dueAt: null }); continue; }
    takenSet.add(next.value.toMillis());
    out.push({ id: t.id, dueAt: next.value.toJSDate() });
  }
  return out;
}

/** Next N free slot instants for the "✨ suggested times" picker. */
export function nextFreeSlots(slots: Slot[], zone: string, taken: Date[], now: Date, n = 5): Date[] {
  const takenSet = new Set(taken.map(d => d.getTime()));
  const out: Date[] = [];
  for (const t of slotInstants(slots, zone, now)) {
    if (takenSet.has(t.toMillis())) continue;
    out.push(t.toJSDate());
    if (out.length >= n) break;
  }
  return out;
}

/** Group posting slots as the settings UI shows them: { weekday -> ["09:00","17:30"] } */
export function groupSlotsByDay(slots: Slot[]) {
  const byDay: Record<number, string[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const s of slots.filter(s => s.enabled)) byDay[s.weekday].push(`${String(Math.floor(s.minuteOfDay / 60)).padStart(2, '0')}:${String(s.minuteOfDay % 60).padStart(2, '0')}`);
  for (const k of Object.keys(byDay)) byDay[+k].sort();
  return byDay;
}

export const DEFAULT_SLOTS: Slot[] = [1, 2, 3, 4, 5].flatMap(weekday => [{ weekday, minuteOfDay: 10 * 60, enabled: true }, { weekday, minuteOfDay: 15 * 60, enabled: true }]);
