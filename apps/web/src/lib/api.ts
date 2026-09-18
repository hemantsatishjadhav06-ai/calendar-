'use client';
import { GraphQLClient, gql } from 'graphql-request';

export { gql };

export class ApiError extends Error {
  constructor(message: string, public code?: string, public extensions?: any) { super(message); }
}

/** Same-origin via Next rewrites (/api/* → API). Cookies flow automatically. */
export const gqlClient = new GraphQLClient('/api/graphql', { credentials: 'include', headers: () => ({ 'x-organization-id': currentOrgId() ?? '' }) });

export async function gqlRequest<T = any>(doc: string, variables?: Record<string, unknown>): Promise<T> {
  try { return await gqlClient.request<T>(doc, variables); }
  catch (e: any) {
    const err = e?.response?.errors?.[0];
    throw new ApiError(err?.message ?? e.message ?? 'Request failed', err?.extensions?.code, err?.extensions);
  }
}

export async function rest<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, { ...init, credentials: 'include', headers: { ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}), 'x-organization-id': currentOrgId() ?? '', ...(init.headers ?? {}) }, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) throw new ApiError(data?.message ?? data?.error ?? res.statusText, data?.code, data);
  return data as T;
}
const safeJson = (t: string) => { try { return JSON.parse(t); } catch { return { message: t }; } };

const ORG_KEY = 'relay.orgId';
export const currentOrgId = () => (typeof window === 'undefined' ? null : window.localStorage.getItem(ORG_KEY));
export const setCurrentOrgId = (id: string | null) => { if (typeof window !== 'undefined') { if (id) window.localStorage.setItem(ORG_KEY, id); else window.localStorage.removeItem(ORG_KEY); } };

/** Streams the AI assistant (text/event-stream) into a callback. */
export async function streamAssist(body: Record<string, unknown>, onDelta: (t: string) => void, signal?: AbortSignal) {
  const res = await fetch('/api/ai/assist', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', 'x-organization-id': currentOrgId() ?? '' }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) throw new ApiError((await res.json().catch(() => ({})))?.message ?? 'AI request failed');
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx; while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const ev = /^event: (\w+)/m.exec(frame)?.[1]; const data = /^data: (.*)$/m.exec(frame)?.[1];
      if (ev === 'error') throw new ApiError(JSON.parse(data ?? '"AI error"'));
      if (!ev && data) onDelta(JSON.parse(data));
    }
  }
}
