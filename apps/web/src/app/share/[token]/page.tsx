import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Shared post · Relay',
  robots: { index: false, follow: false },
};

const NETWORK_LABEL: Record<string, string> = {
  FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram', THREADS: 'Threads', X: 'X', LINKEDIN: 'LinkedIn',
  TIKTOK: 'TikTok', YOUTUBE: 'YouTube', PINTEREST: 'Pinterest', GOOGLE_BUSINESS: 'Google Business',
  BLUESKY: 'Bluesky', MASTODON: 'Mastodon',
};

async function getPreview(token: string): Promise<any | null> {
  const base = process.env.API_URL || 'http://localhost:4000';
  try {
    const res = await fetch(`${base}/share/${encodeURIComponent(token)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function mediaList(media: unknown): any[] {
  return Array.isArray(media) ? media : [];
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await getPreview(token);

  return (
    <main id="main" style={{ minHeight: '100dvh', background: 'var(--bg, #faf9f7)', padding: '32px 16px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 8, background: '#6DB44F', color: '#0b1b0b', fontWeight: 800 }}>R</span>
          <b style={{ fontSize: 15 }}>Relay</b>
          {data?.org && <span className="subtle" style={{ marginLeft: 'auto' }}>Shared from {data.org}</span>}
        </header>

        {!data ? (
          <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}>
            <h1 style={{ fontSize: 18, margin: '0 0 6px' }}>Link not available</h1>
            <p className="subtle" style={{ margin: 0 }}>This share link is invalid or has expired. Ask the sender for a fresh link.</p>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 14 }}>
              <h1 style={{ fontSize: 18, margin: '0 0 2px' }}>Post preview</h1>
              <p className="subtle" style={{ margin: 0 }}>
                {data.author ? `Prepared by ${data.author} · ` : ''}
                {data.targets?.length ?? 0} channel{(data.targets?.length ?? 0) === 1 ? '' : 's'} · read-only
              </p>
            </div>

            <div style={{ display: 'grid', gap: 14 }}>
              {(data.targets ?? []).map((t: any) => {
                const media = mediaList(t.media);
                const due = t.dueAt ? new Date(t.dueAt) : null;
                return (
                  <article key={t.id} className="card" style={{ padding: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      {t.avatarUrl
                        ? <img src={t.avatarUrl} alt="" width={36} height={36} style={{ borderRadius: '50%', objectFit: 'cover' }} />
                        : <span style={{ width: 36, height: 36, borderRadius: '50%', background: '#e5e3de', display: 'inline-block' }} />}
                      <div style={{ minWidth: 0 }}>
                        <b style={{ display: 'block', lineHeight: 1.2 }}>{t.channel}</b>
                        <span className="subtle" style={{ fontSize: 13 }}>
                          {NETWORK_LABEL[t.network] ?? t.network}{t.handle ? ` · @${t.handle}` : ''}
                        </span>
                      </div>
                      <span className="tag" style={{ marginLeft: 'auto' }}>{due ? due.toLocaleString() : (t.status ?? '').toLowerCase() || 'draft'}</span>
                    </div>

                    {t.text && <p style={{ whiteSpace: 'pre-wrap', margin: '0 0 10px', lineHeight: 1.5 }}>{t.text}</p>}

                    {media.length > 0 && (
                      <ul style={{ listStyle: 'none', margin: '0 0 6px', padding: 0, display: 'grid', gridTemplateColumns: `repeat(${Math.min(media.length, 3)}, 1fr)`, gap: 6 }}>
                        {media.slice(0, 6).map((m: any, i: number) => {
                          const src = m.previewUrl || m.thumbUrl || m.url;
                          return (
                            <li key={i} style={{ aspectRatio: '1 / 1', borderRadius: 8, overflow: 'hidden', background: '#eceae5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {src && m.kind !== 'video'
                                ? <img src={src} alt={m.altText ?? ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                : <span className="subtle" style={{ fontSize: 22 }}>{m.kind === 'video' ? '▶' : m.kind === 'document' ? 'PDF' : '🖼'}</span>}
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    {Array.isArray(t.thread) && t.thread.length > 0 && <p className="subtle" style={{ margin: '4px 0 0', fontSize: 13 }}>+ {t.thread.length} more in thread</p>}
                    {t.firstComment && <p className="subtle" style={{ margin: '6px 0 0', fontSize: 13 }}>💬 First comment: {t.firstComment}</p>}
                  </article>
                );
              })}
            </div>

            <p className="subtle" style={{ textAlign: 'center', marginTop: 22, fontSize: 12 }}>
              This is a read-only preview shared via Relay. Content may still change before it's published.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
