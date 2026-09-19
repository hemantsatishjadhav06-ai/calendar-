import type { NextConfig } from 'next';

const API = process.env.API_URL ?? 'http://localhost:4000';
const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@cadence/network-rules'],
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }, { protocol: 'http', hostname: 'localhost' }] },
  async rewrites() {
    // Same-origin API calls in the browser (cookies work without CORS tricks)
    return ['graphql', 'auth', 'oauth', 'uploads', 'events', 'billing', 'ai', 'notify', 'r', 'share'].map(p => ({ source: `/api/${p}/:path*`, destination: `${API}/${p}/:path*` })).concat([{ source: '/api/graphql', destination: `${API}/graphql` }, { source: '/api/billing', destination: `${API}/billing` }, { source: '/api/events', destination: `${API}/events` }, { source: '/api/uploads', destination: `${API}/uploads` }]);
  },
  async headers() { return [{ source: '/(.*)', headers: [{ key: 'X-Frame-Options', value: 'DENY' }, { key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }] }]; },
  // The workspace packages use NodeNext-style `.js` import specifiers that point at `.ts` sources;
  // teach webpack to resolve them (tsx/swc already do this at runtime).
  webpack(config) {
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'], '.mjs': ['.mts', '.mjs'] };
    return config;
  },
};
export default config;
