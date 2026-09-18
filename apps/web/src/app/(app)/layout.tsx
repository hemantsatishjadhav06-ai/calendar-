'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from '@/components/shell/Sidebar';
import { ComposerHost } from '@/components/composer/ComposerHost';
import { CommandPalette } from '@/components/shell/CommandPalette';
import { useAccount, useRelayEvents } from '@/lib/hooks';
import { setCurrentOrgId, currentOrgId } from '@/lib/api';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const account = useAccount(); const router = useRouter(); const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => { if (account.isError) router.replace(`/login?next=${encodeURIComponent(pathname)}`); }, [account.isError, router, pathname]);
  useEffect(() => { const a = account.data; if (a && !currentOrgId() && a.currentOrganizationId) setCurrentOrgId(a.currentOrganizationId); }, [account.data]);
  useEffect(() => setNavOpen(false), [pathname]);
  useRelayEvents();
  if (!account.data) return <div className="shell"><div className="sidebar" /><div className="main"><div className="topbar" /><div className="content"><div className="skeleton" style={{ height: 240 }} /></div></div></div>;
  return (
    <div className="shell" data-nav-open={navOpen}>
      <Sidebar account={account.data} />
      <div className="main">{children}</div>
      <ComposerHost />
      <CommandPalette />
      <button className="btn secondary icon" style={{ position: 'fixed', left: 12, bottom: 12, zIndex: 31 }} aria-label="Toggle navigation" onClick={() => setNavOpen(o => !o)}>☰</button>
    </div>
  );
}
