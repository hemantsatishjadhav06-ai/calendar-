'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useComposer } from '@/components/composer/store';

export function TopBar({ title, tabs, actions, channelId }: { title: React.ReactNode; tabs?: { href: string; label: string; count?: number }[]; actions?: React.ReactNode; channelId?: string }) {
  const pathname = usePathname(); const open = useComposer(s => s.open);
  return (
    <header className="topbar">
      <h1>{title}</h1>
      {tabs && <nav className="tabs" aria-label="Sections">{tabs.map(t => <Link key={t.href} className="tab" href={t.href} aria-current={pathname === t.href ? 'page' : undefined}>{t.label}{t.count ? <span className="count" style={{ marginLeft: 6, fontSize: 11, background: 'var(--bg-inset)', borderRadius: 99, padding: '0 6px' }}>{t.count}</span> : null}</Link>)}</nav>}
      <span className="grow" />
      {actions}
      <button className="btn primary sm" onClick={() => open({ channelIds: channelId ? [channelId] : undefined })}><Plus size={14} /> New post</button>
    </header>
  );
}
