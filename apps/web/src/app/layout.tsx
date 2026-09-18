import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = { title: 'Relay', description: 'Plan, publish and grow on every social channel.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{const t=localStorage.getItem('relay.theme')||'system';const d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch{}` }} />
      </head>
      <body><a href="#main" className="skip-link">Skip to content</a><Providers>{children}</Providers></body>
    </html>
  );
}
