import { ClerkProvider } from '@clerk/nextjs';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { clerkAppearance } from '../lib/clerk-appearance.ts';
import { fontVariables } from './fonts.ts';
import '../styles/tokens.css';
import '../styles/components.css';
import '../styles/app.css';

export const metadata: Metadata = {
  title: { default: 'Boiler Room: launch films for founders', template: '%s · Boiler Room' },
  description:
    'Give us a URL. A small crew of agents reads your site, writes the script, animates it and cuts it for every channel. You approve the script.',
};

export const viewport: Viewport = { themeColor: '#FFFBEF' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <ClerkProvider appearance={clerkAppearance}>{children}</ClerkProvider>
      </body>
    </html>
  );
}
