'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import * as Popover from '@radix-ui/react-popover';
import { Bell, CheckCheck } from 'lucide-react';
import { useGql, useMutate, M, Q } from '@/lib/hooks';
import { useQueryClient } from '@tanstack/react-query';

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString();
}

export function NotificationBell() {
  const router = useRouter(); const qc = useQueryClient(); const [open, setOpen] = useState(false);
  const data = useGql<{ notifications: any[]; notificationUnreadCount: number }>(['notifications'], Q.notifications, undefined, { refetchInterval: 60_000 });
  const markRead = useMutate(M.markNotificationRead, { invalidate: [['notifications']] });
  const markAll = useMutate(M.markAllNotificationsRead, { invalidate: [['notifications']] });
  const list = data.data?.notifications ?? [];
  const unread = data.data?.notificationUnreadCount ?? 0;

  const onClick = (n: any) => {
    if (!n.readAt) markRead.mutate({ id: n.id });
    if (n.url) { setOpen(false); router.push(n.url); }
  };

  return (
    <Popover.Root open={open} onOpenChange={o => { setOpen(o); if (o) qc.invalidateQueries({ queryKey: ['notifications'] }); }}>
      <Popover.Trigger asChild>
        <button className="btn ghost icon" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} style={{ position: 'relative' }}>
          <Bell size={18} />
          {unread > 0 && <span className="noti-dot" aria-hidden>{unread > 9 ? '9+' : unread}</span>}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="noti-pop" align="end" sideOffset={6}>
          <div className="noti-head">
            <b>Notifications</b>
            {unread > 0 && <button className="btn ghost sm" onClick={() => markAll.mutate({})}><CheckCheck size={13} /> Mark all read</button>}
          </div>
          <div className="noti-list">
            {list.length === 0 && <div className="noti-empty subtle">You're all caught up.</div>}
            {list.map(n => (
              <button key={n.id} className="noti-item" data-unread={!n.readAt} onClick={() => onClick(n)}>
                {!n.readAt && <span className="noti-unread" aria-hidden />}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="noti-title">{n.title}</div>
                  {n.body && <div className="noti-body subtle">{n.body}</div>}
                  <div className="noti-time subtle">{timeAgo(n.createdAt)}</div>
                </div>
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
