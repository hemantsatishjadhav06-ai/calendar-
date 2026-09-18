'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Tooltip, Legend, Filler } from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import { Download, Sparkles } from 'lucide-react';
import { TopBar } from '@/components/shell/TopBar';
import { useGql, useChannels, useMe, useTags, Q } from '@/lib/hooks';
import { rest } from '@/lib/api';
import { Menu, MenuItem, UpgradeHint, Avatar } from '@/components/ui/primitives';
import { compact, pct, fmtDate, truncate } from '@/lib/format';
import { toast } from '@/components/ui/toast';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Tooltip, Legend, Filler);

const RANGES: [string, string][] = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['mtd', 'Month to date'], ['lastmonth', 'Last month'], ['custom', 'Custom']];
const COMPARE: [string, string][] = [['none', 'No comparison'], ['prev', 'Previous period'], ['week', 'Same period last week'], ['month', 'Same period last month'], ['year', 'Same period last year']];
const SETS: Record<string, string[]> = { posts: ['posts_published'], impact: ['likes', 'comments', 'shares', 'saves'], audience: ['followers', 'follows'], visibility: ['impressions', 'reach', 'video_views'] };
const LABEL: Record<string, string> = { posts_published: 'Posts', likes: 'Reactions', comments: 'Comments', impressions: 'Impressions', shares: 'Shares', saves: 'Saves', follows: 'New followers', reach: 'Reach', engagement_rate: 'Engagement rate', engagements: 'Engagements', followers: 'Followers', video_views: 'Video views', link_clicks: 'Link clicks', clicks: 'Clicks', profile_views: 'Profile views' };
const TILES = ['posts_published', 'likes', 'comments', 'impressions', 'shares', 'saves', 'follows', 'reach', 'engagement_rate'];

export default function InsightsPage() {
  const channels = useChannels(); const me = useMe(); const tags = useTags(); const ent = me.data?.organization?.entitlements ?? {};
  const [range, setRange] = useState('30'); const [compare, setCompare] = useState('none');
  useEffect(() => { if (ent.comparisons && compare === 'none' && !touched.current) setCompare('prev'); }, [ent.comparisons]); // eslint-disable-line react-hooks/exhaustive-deps
  const touched = useRef(false); const [chan, setChan] = useState<string[]>([]); const [set, setSet] = useState('impact'); const [custom, setCustom] = useState({ from: DateTime.now().minus({ days: 30 }).toISODate()!, to: DateTime.now().toISODate()! }); const [tagId, setTagId] = useState(''); const [sortBy, setSortBy] = useState('engagements'); const [takeaways, setTakeaways] = useState<string[] | null>(null); const [audienceChannel, setAudienceChannel] = useState('');
  const { from, to, cf, ct } = useMemo(() => {
    const now = DateTime.now().endOf('day'); let f: DateTime, t: DateTime = now;
    if (range === '7') f = now.minus({ days: 7 }); else if (range === '30') f = now.minus({ days: 30 }); else if (range === 'mtd') f = now.startOf('month'); else if (range === 'lastmonth') { f = now.minus({ months: 1 }).startOf('month'); t = now.minus({ months: 1 }).endOf('month'); } else { f = DateTime.fromISO(custom.from); t = DateTime.fromISO(custom.to).endOf('day'); }
    const len = t.diff(f); let cf: DateTime | null = null, ct: DateTime | null = null;
    if (compare === 'prev') { ct = f; cf = f.minus(len); } else if (compare === 'week') { cf = f.minus({ weeks: 1 }); ct = t.minus({ weeks: 1 }); } else if (compare === 'month') { cf = f.minus({ months: 1 }); ct = t.minus({ months: 1 }); } else if (compare === 'year') { cf = f.minus({ years: 1 }); ct = t.minus({ years: 1 }); }
    return { from: f.toISO()!, to: t.toISO()!, cf: cf?.toISO() ?? null, ct: ct?.toISO() ?? null };
  }, [range, compare, custom]);
  const rangeInput = { channelIds: chan.length ? chan : undefined, from, to, compareFrom: cf, compareTo: ct, tagId: tagId || undefined };
  const summary = useGql<any>(['insights', 'summary', rangeInput], Q.insightsSummary, { range: rangeInput });
  const series = useGql<any>(['insights', 'series', rangeInput, set], Q.insightsSeries, { range: { ...rangeInput, compareFrom: null, compareTo: null }, metrics: SETS[set], bucket: DateTime.fromISO(to).diff(DateTime.fromISO(from), 'days').days > 60 ? 'week' : 'day' });
  const prevSeries = useGql<any>(['insights', 'series-prev', rangeInput, set], Q.insightsSeries, { range: { channelIds: rangeInput.channelIds, from: cf, to: ct }, metrics: SETS[set] }, { enabled: !!cf });
  const posts = useGql<any>(['insights', 'posts', rangeInput, sortBy], Q.insightsPosts, { range: { ...rangeInput, compareFrom: null, compareTo: null }, sortBy, first: 25 });
  const hashtags = useGql<any>(['insights', 'hashtags', rangeInput], Q.insightsHashtags, { range: { ...rangeInput, compareFrom: null, compareTo: null } });
  const audience = useGql<any>(['insights', 'audience', audienceChannel], Q.insightsAudience, { channelId: audienceChannel }, { enabled: !!audienceChannel });
  const m = (k: string) => summary.data?.insightsSummary?.find((x: any) => x.metric === k);
  const locked = (k: 'customDateRanges' | 'comparisons') => !ent[k];

  const chart = useMemo(() => {
    const rows: any[] = series.data?.insightsSeries ?? []; const days = Array.from(new Set(rows.map(r => r.day))).sort();
    const prevRows: any[] = prevSeries.data?.insightsSeries ?? []; const prevDays = Array.from(new Set(prevRows.map(r => r.day))).sort();
    const palette = ['#6DB44F', '#2C4BFF', '#F79009', '#7C3AED', '#0E9384'];
    const datasets = SETS[set].flatMap((metric, i) => [
      { label: LABEL[metric], data: days.map(d => rows.find(r => r.day === d && r.metric === metric)?.value ?? 0), borderColor: palette[i], backgroundColor: palette[i] + '33', fill: SETS[set].length === 1, tension: .3, pointRadius: 2 },
      ...(cf ? [{ label: `${LABEL[metric]} (previous)`, data: prevDays.map(d => prevRows.find(r => r.day === d && r.metric === metric)?.value ?? 0), borderColor: palette[i], borderDash: [4, 4], backgroundColor: 'transparent', tension: .3, pointRadius: 0 }] : []),
    ]);
    return { labels: days.map(d => fmtDate(d)), datasets };
  }, [series.data, prevSeries.data, set, cf]);

  const exportCsv = (kind: 'summary' | 'posts' | 'series') => {
    let csv = '';
    if (kind === 'summary') csv = 'metric,current,previous,change\n' + (summary.data?.insightsSummary ?? []).map((r: any) => `${r.metric},${r.current ?? ''},${r.previous ?? ''},${r.change ?? ''}`).join('\n');
    if (kind === 'series') csv = 'day,metric,value\n' + (series.data?.insightsSeries ?? []).map((r: any) => `${r.day},${r.metric},${r.value}`).join('\n');
    if (kind === 'posts') csv = 'published,channel,text,' + Object.keys(LABEL).join(',') + '\n' + (posts.data?.insightsPosts.edges ?? []).map((e: any) => { const t = e.node; return `${t.publishedAt},${t.channel.displayName},"${(t.text ?? '').replace(/"/g, '""').replace(/\n/g, ' ')}",${Object.keys(LABEL).map(k => t.metrics?.[k] ?? '').join(',')}`; }).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `relay-insights-${kind}-${from.slice(0, 10)}_${to.slice(0, 10)}.csv`; a.click();
  };
  const exportMd = () => { const md = `# Insights ${from.slice(0, 10)} → ${to.slice(0, 10)}\n\n| Metric | Current | Previous | Change |\n|---|---|---|---|\n` + (summary.data?.insightsSummary ?? []).map((r: any) => `| ${LABEL[r.metric] ?? r.metric} | ${r.current ?? '—'} | ${r.previous ?? '—'} | ${r.change != null ? Math.round(r.change * 100) + '%' : '—'} |`).join('\n'); navigator.clipboard.writeText(md); toast('Markdown copied to clipboard'); };
  const loadTakeaways = async () => { try { const r = await rest('/ai/takeaways', { method: 'POST', json: { channelIds: chan } }); setTakeaways(r.takeaways); } catch (e: any) { toast(e.message, { tone: 'danger' }); } };

  return (
    <>
      <TopBar title="Insights" actions={<Menu trigger={<button className="btn secondary sm"><Download size={13} /> Export ▾</button>}><MenuItem onSelect={() => exportCsv('summary')}>Summary CSV</MenuItem><MenuItem onSelect={() => exportCsv('posts')}>Posts CSV</MenuItem><MenuItem onSelect={() => exportCsv('series')}>Time series CSV</MenuItem><MenuItem onSelect={exportMd}>Copy as Markdown</MenuItem><MenuItem onSelect={() => window.print()}>PDF (print){!ent.brandedReports && <UpgradeHint feature="Branded reports" />}</MenuItem></Menu>} />
      <main className="content" id="main" style={{ maxWidth: 'none' }}>
        <div className="row" style={{ flexWrap: 'wrap', marginBottom: 14 }} role="toolbar" aria-label="Insights filters">
          <Menu trigger={<button className="btn secondary sm">Channels {chan.length ? `(${chan.length})` : '(all)'} ▾</button>}><MenuItem onSelect={() => setChan([])}>All channels</MenuItem>{(channels.data?.channels ?? []).map((c: any) => <MenuItem key={c.id} onSelect={() => setChan(s => (s.includes(c.id) ? s.filter(x => x !== c.id) : [...s, c.id]))}>{chan.includes(c.id) ? '✓ ' : ''}{c.displayName}</MenuItem>)}</Menu>
          <select className="select" style={{ width: 'auto', padding: '5px 10px' }} value={range} onChange={e => { const v = e.target.value; if ((v === 'custom' || v === 'lastmonth') && locked('customDateRanges')) return toast('Custom date ranges are available on paid plans', { extensions: { code: 'ENTITLEMENT' } }); setRange(v); }} aria-label="Date range">{RANGES.map(([v, l]) => <option key={v} value={v}>{l}{(v === 'custom' || v === 'lastmonth') && locked('customDateRanges') ? ' ✦' : ''}</option>)}</select>
          {range === 'custom' && <><input type="date" className="input" style={{ width: 'auto', padding: '5px 10px' }} value={custom.from} onChange={e => setCustom(c => ({ ...c, from: e.target.value }))} aria-label="From" /><input type="date" className="input" style={{ width: 'auto', padding: '5px 10px' }} value={custom.to} onChange={e => setCustom(c => ({ ...c, to: e.target.value }))} aria-label="To" /></>}
          <select className="select" style={{ width: 'auto', padding: '5px 10px' }} value={compare} onChange={e => { touched.current = true; if (e.target.value !== 'none' && locked('comparisons')) return toast('Comparisons are available on paid plans', { extensions: { code: 'ENTITLEMENT' } }); setCompare(e.target.value); }} aria-label="Compare to">{COMPARE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          {!!tags.data?.tags?.length && <select className="select" style={{ width: 'auto', padding: '5px 10px' }} value={tagId} onChange={e => setTagId(e.target.value)} aria-label="Tag report"><option value="">All posts</option>{tags.data.tags.map((t: any) => <option key={t.id} value={t.id}>Tag: {t.name}</option>)}</select>}
          <span className="subtle" style={{ marginLeft: 'auto' }}>Data can lag up to 48h · UTC days</span>
        </div>
        {summary.error && <div className="banner warn">{(summary.error as any).message} {(summary.error as any).code === 'ENTITLEMENT' && <UpgradeHint feature="History" />}</div>}
        <div className="tiles">{TILES.map(k => { const x = m(k); const d = x?.change; return <div key={k} className="tile" role="group" aria-label={`${LABEL[k]}: ${x?.current ?? 'no data'}`}><div className="label">{LABEL[k]}</div><div className="value">{x?.current == null ? '—' : k === 'engagement_rate' ? pct(x.current) : compact(x.current)}</div>{cf && <div className={`delta ${d == null ? 'flat' : d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}`}>{d == null ? '—' : `${d > 0 ? '▲' : d < 0 ? '▼' : '•'} ${Math.abs(Math.round(d * 100))}%`}</div>}</div>; })}</div>

        <div className="grid" style={{ gridTemplateColumns: '2fr 1fr', marginTop: 18 }}>
          <section className="chart-box" aria-label="Metrics chart">
            <div className="row" style={{ marginBottom: 8 }}><b style={{ fontSize: 14 }}>Metrics</b><div className="tabs" role="radiogroup" aria-label="Metric set">{Object.keys(SETS).map(s => <button key={s} role="radio" aria-checked={set === s} className="tab" style={{ border: 0, cursor: 'pointer', background: set === s ? 'var(--bg-inset)' : 'none' }} onClick={() => setSet(s)}>{{ posts: 'Posts', impact: 'Content impact', audience: 'Audience growth', visibility: 'Visibility' }[s]}</button>)}</div>{!ent.customMetricSets && <UpgradeHint feature="Custom metric sets" />}</div>
            <div style={{ height: 240 }}><Line data={chart} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,.06)' } }, x: { grid: { display: false } } } }} aria-label="Metrics over time" role="img" /></div>
            <details style={{ marginTop: 6 }}><summary className="subtle" style={{ cursor: 'pointer' }}>View as table</summary><table className="table"><thead><tr><th>Day</th>{SETS[set].map(k => <th key={k}>{LABEL[k]}</th>)}</tr></thead><tbody>{chart.labels.map((d, i) => <tr key={d}><td>{d}</td>{SETS[set].map((k, j) => <td key={k}>{(chart.datasets[cf ? j * 2 : j]?.data as number[])[i] ?? 0}</td>)}</tr>)}</tbody></table></details>
          </section>
          <section className="card" aria-labelledby="tk"><div className="row" style={{ justifyContent: 'space-between' }}><h2 id="tk" style={{ margin: 0, fontSize: 14 }}>✦ Takeaways</h2><button className="btn ghost sm" onClick={loadTakeaways}><Sparkles size={13} /> {takeaways ? 'Refresh' : 'Generate'}</button></div>{takeaways ? <ul style={{ paddingLeft: 18, fontSize: 13 }}>{takeaways.map((t, i) => <li key={i} style={{ marginBottom: 6 }}>{t}</li>)}{!takeaways.length && <li className="subtle">Nothing notable — keep posting consistently.</li>}</ul> : <p className="subtle">Plain-language observations about posting frequency, best slots and content worth reposting. Numbers come from your data; AI only phrases them.</p>}</section>
        </div>

        <section style={{ marginTop: 18 }} aria-labelledby="pp"><div className="row" style={{ justifyContent: 'space-between' }}><h2 id="pp" style={{ fontSize: 15, margin: 0 }}>Performance per post</h2><select className="select" style={{ width: 'auto', padding: '5px 10px' }} value={sortBy} onChange={e => setSortBy(e.target.value)} aria-label="Sort posts by">{['engagements', 'impressions', 'likes', 'comments', 'shares', 'saves', 'video_views', 'link_clicks'].map(k => <option key={k} value={k}>Sort: {LABEL[k]}</option>)}</select></div>
          <div className="card" style={{ padding: 0, marginTop: 10, overflowX: 'auto' }}><table className="table"><thead><tr><th>Post</th><th>Published</th><th>Impressions</th><th>Reactions</th><th>Comments</th><th>Shares</th><th>Saves</th><th>Clicks</th><th>Eng. rate</th></tr></thead><tbody>{(posts.data?.insightsPosts.edges ?? []).map((e: any) => { const t = e.node, mm = t.metrics ?? {}; const eng = (mm.likes ?? 0) + (mm.comments ?? 0) + (mm.shares ?? 0) + (mm.saves ?? 0); const media = (t.customized ? t.media : t.post?.baseMedia ?? t.media)?.[0]; return <tr key={t.id}><td><div className="row"><Avatar src={t.channel.avatarUrl} name={t.channel.displayName} network={t.channel.network} size="sm" />{media?.thumbUrl && <img src={media.thumbUrl} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover' }} />}<span title={t.text}>{truncate(t.text, 60)}</span>{t.externalUrl && <a href={t.externalUrl} target="_blank" rel="noreferrer" className="subtle">↗</a>}</div></td><td className="subtle">{fmtDate(t.publishedAt)}</td><td>{compact(mm.impressions)}</td><td>{compact(mm.likes)}</td><td>{compact(mm.comments)}</td><td>{compact(mm.shares)}</td><td>{compact(mm.saves)}</td><td>{compact(mm.link_clicks ?? mm.clicks)}</td><td>{mm.impressions ? pct(eng / mm.impressions) : '—'}</td></tr>; })}{posts.data && !posts.data.insightsPosts.edges.length && <tr><td colSpan={9} className="subtle" style={{ textAlign: 'center', padding: 24 }}>No published posts in this range.</td></tr>}</tbody></table></div>
        </section>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 18 }}>
          <section className="card" aria-labelledby="ht"><h2 id="ht" style={{ marginTop: 0, fontSize: 15 }}>Hashtag performance</h2>{hashtags.data?.insightsHashtags?.length ? <div style={{ height: 220 }}><Bar data={{ labels: hashtags.data.insightsHashtags.map((h: any) => h.hashtag), datasets: [{ label: 'Engagements', data: hashtags.data.insightsHashtags.map((h: any) => h.engagements), backgroundColor: '#6DB44F' }] }} options={{ indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} role="img" aria-label="Engagements by hashtag" /></div> : <p className="subtle">Use hashtags in captions or first comments to see which ones drive engagement.</p>}</section>
          <section className="card" aria-labelledby="au"><div className="row" style={{ justifyContent: 'space-between' }}><h2 id="au" style={{ marginTop: 0, fontSize: 15 }}>Audience</h2><select className="select" style={{ width: 'auto', padding: '4px 8px' }} value={audienceChannel} onChange={e => setAudienceChannel(e.target.value)} aria-label="Audience channel"><option value="">Choose channel…</option>{(channels.data?.channels ?? []).filter((c: any) => ['INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'YOUTUBE', 'THREADS'].includes(c.network)).map((c: any) => <option key={c.id} value={c.id}>{c.displayName}</option>)}</select></div>{audience.data?.insightsAudience?.length ? <AudienceCharts rows={audience.data.insightsAudience} /> : <p className="subtle">Age, gender and location breakdowns for Instagram, Facebook Pages, LinkedIn Pages, YouTube and Threads (needs ≥ 100 followers).</p>}</section>
        </div>
      </main>
    </>
  );
}

function AudienceCharts({ rows }: { rows: any[] }) {
  const dim = (d: string) => rows.filter(r => r.dimension === d).sort((a, b) => b.value - a.value);
  const age = dim('age'), gender = dim('gender'), city = dim('city').slice(0, 6), country = dim('country').slice(0, 6);
  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      {!!age.length && <div style={{ height: 160 }}><Bar data={{ labels: age.map(a => a.bucket), datasets: [{ label: 'Age', data: age.map(a => a.value), backgroundColor: '#2C4BFF' }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} role="img" aria-label="Followers by age" /></div>}
      {!!gender.length && <div style={{ height: 160 }}><Doughnut data={{ labels: gender.map(g => ({ F: 'Women', M: 'Men', U: 'Unknown' } as any)[g.bucket] ?? g.bucket), datasets: [{ data: gender.map(g => g.value), backgroundColor: ['#6DB44F', '#2C4BFF', '#CFCAC0'] }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 10 } } } }} role="img" aria-label="Followers by gender" /></div>}
      {!!city.length && <div><b style={{ fontSize: 12 }}>Top cities</b>{city.map(c => <div key={c.bucket} className="row subtle" style={{ justifyContent: 'space-between' }}><span>{c.bucket}</span><span>{compact(c.value)}</span></div>)}</div>}
      {!!country.length && <div><b style={{ fontSize: 12 }}>Top countries</b>{country.map(c => <div key={c.bucket} className="row subtle" style={{ justifyContent: 'space-between' }}><span>{c.bucket}</span><span>{compact(c.value)}</span></div>)}</div>}
    </div>
  );
}
