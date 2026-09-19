'use client';
import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DateTime } from 'luxon';
import { rulesFor, validateTarget } from '@cadence/network-rules';
import { TopBar } from '@/components/shell/TopBar';
import { useChannel } from '@/lib/hooks';
import { gqlRequest } from '@/lib/api';
import { M } from '@/lib/queries';
import { importUrl } from '@/components/composer/upload';
import { toast } from '@/components/ui/toast';

/** Bulk upload: CSV → preview with per-row validation → create posts (QUEUE when no date, CUSTOM otherwise). Max 200 rows. */
const TEMPLATE = 'text,date,media_url_1,media_url_2,media_url_3,media_url_4,alt_1,alt_2,alt_3,alt_4,first_comment,tags,title,link\n"Hello from bulk upload","2026-10-01 10:00",https://example.com/a.jpg,,,,"A photo",,,,"#hello",,"",""\n';

interface Row { n: number; text: string; date?: string; media: { url: string; alt?: string }[]; firstComment?: string; title?: string; link?: string; issues: string[]; dueAt?: string }

export default function BulkPage() {
  const { id } = useParams<{ id: string }>(); const router = useRouter(); const ch = useChannel(id);
  const [rows, setRows] = useState<Row[]>([]); const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(0);
  const channel = ch.data?.channel;
  const parse = (csv: string) => {
    const lines = parseCsv(csv); const header = lines[0].map(h => h.trim().toLowerCase()); const idx = (k: string) => header.indexOf(k);
    const out: Row[] = lines.slice(1).filter(l => l.some(c => c.trim())).slice(0, 200).map((l, i) => {
      const get = (k: string) => (idx(k) >= 0 ? (l[idx(k)] ?? '').trim() : '');
      const media = [1, 2, 3, 4].map(n => ({ url: get(`media_url_${n}`), alt: get(`alt_${n}`) })).filter(m => m.url);
      const row: Row = { n: i + 2, text: get('text'), date: get('date') || undefined, media, firstComment: get('first_comment') || undefined, title: get('title') || undefined, link: get('link') || undefined, issues: [] };
      if (row.date) { const d = DateTime.fromFormat(row.date, 'yyyy-MM-dd HH:mm', { zone: channel?.timezone ?? 'UTC' }); if (!d.isValid) row.issues.push('Date must be YYYY-MM-DD HH:mm'); else if (d < DateTime.now()) row.issues.push('Date is in the past'); else row.dueAt = d.toUTC().toISO()!; }
      if (channel) { const rules = rulesFor(channel.network); const md: any = { title: row.title, link: row.link, ...(channel.network === 'PINTEREST' ? { boardId: channel.meta?.defaultBoardId ?? '' } : {}), ...(channel.network === 'TIKTOK' ? { privacyLevel: 'PUBLIC_TO_EVERYONE' } : {}) }; const issues = validateTarget(rules, { text: row.text, media: media.map((m, k) => ({ assetId: `pending-${k}`, kind: /\.(mp4|mov|webm)(\?|$)/i.test(m.url) ? 'video' : 'image', altText: m.alt })), metadata: md, firstComment: row.firstComment }, { channel: { meta: channel.meta ?? {}, subtype: channel.subtype }, metadata: md, media: [] }); row.issues.push(...issues.filter(x => x.level === 'error').map(x => x.message)); }
      return row;
    });
    setRows(out);
  };
  const valid = useMemo(() => rows.filter(r => !r.issues.length), [rows]);
  const run = async () => {
    setBusy(true); setProgress(0); let done = 0;
    for (const r of valid) {
      try {
        const media = []; for (const m of r.media) media.push(await importUrl(m.url, 'bulk'));
        const metadata: any = { title: r.title, link: r.link, ...(channel.network === 'TIKTOK' ? { privacyLevel: 'PUBLIC_TO_EVERYONE' } : {}) };
        await gqlRequest(M.createPost, { input: { baseText: r.text, baseMedia: media.map((m, k) => ({ assetId: m.assetId, kind: m.kind, altText: r.media[k]?.alt })), mode: r.dueAt ? 'CUSTOM' : 'QUEUE', dueAt: r.dueAt ?? null, targets: [{ channelId: id, firstComment: r.firstComment ?? null, metadata }] } });
      } catch (e: any) { toast(`Row ${r.n}: ${e.message}`, { tone: 'danger' }); }
      setProgress(++done / valid.length);
    }
    setBusy(false); toast(`${done} posts created`, { tone: 'success' }); router.push(`/channels/${id}/queue`);
  };
  return (
    <>
      <TopBar title={`Bulk upload · ${channel?.displayName ?? ''}`} />
      <main className="content" id="main">
        <div className="card" style={{ marginBottom: 16 }}>
          <p>Upload a CSV with columns <code>text, date (YYYY-MM-DD HH:mm in {channel?.timezone ?? 'channel'} time, optional), media_url_1..4, alt_1..4, first_comment, tags, title, link</code>. Rows without a date go to the next open slots; rows with a date become custom-time posts. Up to 200 rows.</p>
          <div className="row"><input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={e => { const f = e.target.files?.[0]; if (f) f.text().then(parse); }} /><a className="btn ghost sm" href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="relay-bulk-template.csv">Download template</a></div>
        </div>
        {rows.length > 0 && <>
          <div className="row" style={{ marginBottom: 10 }}><b>{rows.length} rows</b><span className="tag brand">{valid.length} ready</span>{rows.length - valid.length > 0 && <span className="tag danger">{rows.length - valid.length} with issues</span>}<span style={{ flex: 1 }} />{busy && <span className="subtle" aria-live="polite">Creating… {Math.round(progress * 100)}%</span>}<button className="btn primary" disabled={!valid.length || busy} onClick={run}>Create {valid.length} posts</button></div>
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}><table className="table"><thead><tr><th>#</th><th>Text</th><th>When</th><th>Media</th><th>Issues</th></tr></thead><tbody>{rows.map(r => <tr key={r.n}><td>{r.n}</td><td style={{ maxWidth: 360, whiteSpace: 'pre-wrap' }}>{r.text}</td><td className="subtle">{r.date ?? 'Next slot'}</td><td className="subtle">{r.media.length || '—'}</td><td>{r.issues.length ? <span style={{ color: 'var(--danger)' }}>{r.issues.join('; ')}</span> : <span className="tag brand">OK</span>}</td></tr>)}</tbody></table></div>
        </>}
      </main>
    </>
  );
}

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, newlines in quotes). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
