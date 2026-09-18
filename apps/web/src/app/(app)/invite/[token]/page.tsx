'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { gqlRequest, setCurrentOrgId } from '@/lib/api';
import { M } from '@/lib/queries';
import { useQueryClient } from '@tanstack/react-query';

export default function InvitePage() {
  const { token } = useParams<{ token: string }>(); const router = useRouter(); const qc = useQueryClient(); const [error, setError] = useState<string | null>(null);
  useEffect(() => { gqlRequest(M.acceptInvite, { token }).then(r => { setCurrentOrgId(r.acceptInvite.organizationId); qc.clear(); router.replace('/home'); }).catch(e => setError(e.message)); }, [token, router, qc]);
  return <main className="content" id="main"><div className="card" style={{ maxWidth: 480, margin: '40px auto', textAlign: 'center' }}>{error ? <><h2>Invitation problem</h2><p className="subtle">{error}</p><a className="btn secondary" href="/home">Go home</a></> : <><h2>Joining the team…</h2><div className="skeleton" style={{ height: 8, width: 200, margin: '0 auto' }} /></>}</div></main>;
}
