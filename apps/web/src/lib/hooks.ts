'use client';
import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { gqlRequest, rest } from './api';
import { Q, M } from './queries';
import { toast } from '@/components/ui/toast';

export function useGql<T = any>(key: unknown[], doc: string, variables?: Record<string, unknown>, opts: Partial<UseQueryOptions<T>> = {}) {
  return useQuery<T>({ queryKey: key, queryFn: () => gqlRequest<T>(doc, variables), staleTime: 15_000, ...opts } as any);
}
export function useMutate<T = any>(doc: string, opts: { invalidate?: unknown[][]; success?: string; onSuccess?: (d: T) => void } = {}) {
  const qc = useQueryClient();
  return useMutation<T, Error, Record<string, unknown> | void>({
    mutationFn: v => gqlRequest<T>(doc, (v ?? {}) as any),
    onSuccess: d => { for (const k of opts.invalidate ?? []) qc.invalidateQueries({ queryKey: k }); if (opts.success) toast(opts.success); opts.onSuccess?.(d); },
    onError: (e: any) => toast(e.message ?? 'Something went wrong', { tone: 'danger', extensions: e.extensions }),
  });
}

export const useMe = () => useGql<{ me: any; organization: any }>(['me'], Q.me, undefined, { staleTime: 60_000 });
export const useChannels = () => useGql<{ channels: any[] }>(['channels'], Q.channels);
export const useChannel = (id: string, opts: { enabled?: boolean } = {}) => useGql<{ channel: any }>(['channel', id], Q.channel, { id }, { enabled: opts.enabled ?? !!id });
export const useTags = () => useGql<{ tags: any[] }>(['tags'], Q.tags);
export const useNetworks = () => useGql<{ networks: any[] }>(['networks'], Q.networks, undefined, { staleTime: Infinity });
export const useAccount = () => useQuery({ queryKey: ['account'], queryFn: () => rest('/auth/me'), staleTime: 60_000, retry: false });

/** Subscribe to server-sent events for the current organization and invalidate affected queries. */
export function useRelayEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    const es = new EventSource('/api/events', { withCredentials: true });
    es.addEventListener('relay', (ev: MessageEvent) => {
      const e = JSON.parse(ev.data);
      switch (e.type) {
        case 'queue.changed': case 'target.updated': case 'target.failed': qc.invalidateQueries({ queryKey: ['targets'] }); qc.invalidateQueries({ queryKey: ['channels'] }); break;
        case 'target.published': qc.invalidateQueries({ queryKey: ['targets'] }); qc.invalidateQueries({ queryKey: ['channels'] }); toast('Post published', { tone: 'success', action: e.url ? { label: 'View', href: e.url } : undefined }); break;
        case 'channel.updated': qc.invalidateQueries({ queryKey: ['channels'] }); qc.invalidateQueries({ queryKey: ['channel'] }); break;
        case 'comment.new': case 'comment.updated': qc.invalidateQueries({ queryKey: ['comments'] }); break;
        case 'approval.requested': qc.invalidateQueries({ queryKey: ['targets'] }); toast('A post is awaiting approval'); break;
        case 'asset.ready': case 'asset.failed': qc.invalidateQueries({ queryKey: ['asset', e.assetId] }); break;
      }
    });
    return () => es.close();
  }, [qc]);
}
export { Q, M };
