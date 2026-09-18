'use client';
import * as React from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tooltip from '@radix-ui/react-tooltip';
import { X as CloseIcon } from 'lucide-react';
import { NETWORK_LABEL, NETWORK_SHORT, initials } from '@/lib/format';

export function Avatar({ src, name, network, size = 'md' }: { src?: string | null; name?: string | null; network?: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`avatar ${size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : ''}`} aria-hidden={!network}>
      {src ? <img src={src} alt="" /> : <span>{initials(name)}</span>}
      {network && <span className="badge" style={{ ['--net' as any]: `var(--net-${network})` }} title={NETWORK_LABEL[network]} role="img" aria-label={NETWORK_LABEL[network]} />}
    </span>
  );
}

export function NetworkIcon({ network, size = 40 }: { network: string; size?: number }) {
  return <span className="net-icon" style={{ width: size, height: size, background: `var(--net-${network})`, fontSize: size * 0.38 }} aria-hidden>{NETWORK_SHORT[network]}</span>;
}

export function Menu({ trigger, children, align = 'end' }: { trigger: React.ReactNode; children: React.ReactNode; align?: 'start' | 'end' }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal><DropdownMenu.Content className="menu" align={align} sideOffset={6}>{children}</DropdownMenu.Content></DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
export const MenuItem = ({ children, onSelect, danger, shortcut, disabled }: { children: React.ReactNode; onSelect?: () => void; danger?: boolean; shortcut?: string; disabled?: boolean }) => (
  <DropdownMenu.Item className={`menu-item ${danger ? 'danger' : ''}`} onSelect={onSelect} disabled={disabled}>{children}{shortcut && <span className="kbd" style={{ marginLeft: 'auto' }}>{shortcut}</span>}</DropdownMenu.Item>
);
export const MenuSep = () => <DropdownMenu.Separator className="menu-sep" />;

export function Modal({ open, onOpenChange, title, children, footer, size }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: React.ReactNode; footer?: React.ReactNode; size?: 'sm' | 'lg' }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className={`dialog ${size === 'sm' ? 'sm' : ''}`} aria-describedby={undefined}>
          <div className="dialog-head"><Dialog.Title asChild><h2>{title}</h2></Dialog.Title><span className="grow" style={{ flex: 1 }} /><Dialog.Close asChild><button className="btn ghost icon" aria-label="Close"><CloseIcon size={18} /></button></Dialog.Close></div>
          <div className="dialog-body">{children}</div>
          {footer && <div className="dialog-foot">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Tip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip.Provider delayDuration={300}><Tooltip.Root><Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal><Tooltip.Content className="menu" style={{ padding: '6px 10px', fontSize: 12 }} sideOffset={6}>{label}</Tooltip.Content></Tooltip.Portal>
    </Tooltip.Root></Tooltip.Provider>
  );
}

export function Confirm({ open, onOpenChange, title, body, confirmLabel = 'Confirm', danger, onConfirm, typed }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; body: React.ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void | Promise<void>; typed?: string }) {
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} size="sm" footer={<><span style={{ flex: 1 }} /><button className="btn secondary" onClick={() => onOpenChange(false)}>Cancel</button><button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={busy || (!!typed && text !== typed)} onClick={async () => { setBusy(true); try { await onConfirm(); onOpenChange(false); } finally { setBusy(false); } }}>{confirmLabel}</button></>}>
      <div className="stack">{body}{typed && <div className="field"><label htmlFor="confirm-typed">Type <b>{typed}</b> to confirm</label><input id="confirm-typed" className="input" value={text} onChange={e => setText(e.target.value)} /></div>}</div>
    </Modal>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: React.ReactNode; action?: React.ReactNode }) {
  return <div className="empty">{icon}<h3>{title}</h3>{body && <p>{body}</p>}{action}</div>;
}

export function UpgradeHint({ feature }: { feature: string }) {
  return <a className="upgrade" href="/billing" title={`${feature} is available on paid plans`}>✦ Upgrade</a>;
}
