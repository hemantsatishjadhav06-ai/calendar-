'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/primitives';
import { useChannels } from '@/lib/hooks';
import { useComposer } from '@/components/composer/store';

/** ⌘K palette + Buffer-style "G then X" shortcuts and Shift+/ help. */
export function CommandPalette() {
  const router = useRouter(); const channels = useChannels(); const open = useComposer(s => s.open);
  const [show, setShow] = useState(false); const [q, setQ] = useState(''); const [help, setHelp] = useState(false);
  useEffect(() => {
    let g = false;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement; const typing = ['INPUT', 'TEXTAREA'].includes(t.tagName) || t.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setShow(s => !s); return; }
      if (typing) return;
      if (e.shiftKey && e.key === '?') { setHelp(h => !h); return; }
      if (e.key.toLowerCase() === 'g') { g = true; setTimeout(() => (g = false), 1200); return; }
      if (g) { const map: Record<string, string> = { h: '/home', c: '/community', p: '/all-channels', i: '/insights', a: '/calendar/week', s: '/settings' }; if (map[e.key.toLowerCase()]) router.push(map[e.key.toLowerCase()]); g = false; return; }
      if (e.key.toLowerCase() === 'n' && !e.metaKey) open({});
    };
    const onOpen = () => setShow(true);
    window.addEventListener('keydown', onKey); document.addEventListener('relay:palette', onOpen);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('relay:palette', onOpen); };
  }, [router, open]);
  const items = useMemo(() => {
    const base = [{ label: 'New post', run: () => open({}) }, { label: 'Home', run: () => router.push('/home') }, { label: 'Create · Ideas', run: () => router.push('/create') }, { label: 'Publish · All channels', run: () => router.push('/all-channels') }, { label: 'Calendar', run: () => router.push('/calendar/week') }, { label: 'Community', run: () => router.push('/community') }, { label: 'Insights', run: () => router.push('/insights') }, { label: 'Start Page', run: () => router.push('/start-page') }, { label: 'Channels', run: () => router.push('/channels') }, { label: 'Connect a channel', run: () => router.push('/channels/connect') }, { label: 'Settings', run: () => router.push('/settings') }, { label: 'Plans & billing', run: () => router.push('/billing') }];
    for (const c of channels.data?.channels ?? []) base.push({ label: `Queue · ${c.displayName}`, run: () => router.push(`/channels/${c.id}/queue`) });
    return base.filter(i => i.label.toLowerCase().includes(q.toLowerCase())).slice(0, 12);
  }, [q, channels.data, router, open]);
  return (
    <>
      <Modal open={show} onOpenChange={setShow} title="Jump to" size="sm">
        <input className="input" placeholder="Type a page or channel…" value={q} onChange={e => setQ(e.target.value)} autoFocus aria-label="Search commands" onKeyDown={e => { if (e.key === 'Enter' && items[0]) { items[0].run(); setShow(false); } }} />
        <div className="stack" style={{ marginTop: 10 }} role="listbox">{items.map(i => <button key={i.label} className="menu-item" role="option" onClick={() => { i.run(); setShow(false); }}>{i.label}</button>)}</div>
      </Modal>
      <Modal open={help} onOpenChange={setHelp} title="Keyboard shortcuts" size="sm">
        <table className="table"><tbody>
          {[['⌘/Ctrl K', 'Search / jump'], ['N', 'New post'], ['G then H', 'Home'], ['G then P', 'Publish'], ['G then A', 'Calendar'], ['G then C', 'Community'], ['G then I', 'Insights'], ['↑ / ↓', 'Move between comments'], ['R', 'Reply to comment'], ['E', 'Resolve comment'], ['Shift + ?', 'This help']].map(([k, v]) => <tr key={k}><td><span className="kbd">{k}</span></td><td>{v}</td></tr>)}
        </tbody></table>
      </Modal>
    </>
  );
}
