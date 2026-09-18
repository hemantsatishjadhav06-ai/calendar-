'use client';
import { useEffect, useState } from 'react';
import { create } from 'zustand';

interface ToastItem { id: number; message: string; tone?: 'default' | 'success' | 'danger'; action?: { label: string; href?: string; onClick?: () => void }; extensions?: any }
const store = create<{ items: ToastItem[]; push: (t: Omit<ToastItem, 'id'>) => void; dismiss: (id: number) => void }>(set => ({
  items: [],
  push: t => set(s => ({ items: [...s.items, { ...t, id: Date.now() + Math.random() }].slice(-4) })),
  dismiss: id => set(s => ({ items: s.items.filter(i => i.id !== id) })),
}));

export function toast(message: string, opts: Omit<ToastItem, 'id' | 'message'> = {}) {
  const ext = opts.extensions;
  const upgrade = ext?.code === 'ENTITLEMENT' ? { label: 'Upgrade', href: '/billing' } : undefined;
  store.getState().push({ message, ...opts, action: opts.action ?? upgrade });
}

export function Toaster() {
  const { items, dismiss } = store();
  return (
    <ol className="toast-viewport" aria-live="polite" aria-label="Notifications">
      {items.map(t => <ToastRow key={t.id} t={t} onDone={() => dismiss(t.id)} />)}
    </ol>
  );
}
function ToastRow({ t, onDone }: { t: ToastItem; onDone: () => void }) {
  const [hover, setHover] = useState(false);
  useEffect(() => { if (hover) return; const id = setTimeout(onDone, t.action ? 8000 : 5000); return () => clearTimeout(id); }, [hover, onDone, t.action]);
  return (
    <li className="toast" role="status" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ borderLeft: t.tone === 'danger' ? '4px solid #F97066' : t.tone === 'success' ? '4px solid #8FC67D' : undefined }}>
      <span style={{ flex: 1 }}>{t.message}</span>
      {t.action && (t.action.href ? <a href={t.action.href} target={t.action.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" style={{ color: '#fff' }}>{t.action.label}</a> : <button onClick={() => { t.action?.onClick?.(); onDone(); }}>{t.action.label}</button>)}
      <button aria-label="Dismiss" onClick={onDone}>✕</button>
    </li>
  );
}
