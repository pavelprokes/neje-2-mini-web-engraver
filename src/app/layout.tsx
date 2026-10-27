import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { ServiceWorker } from '@/components/ServiceWorker';
import { I18nProvider } from '@/i18n/I18nProvider';
import './globals.css';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export const metadata: Metadata = {
  title: 'NEJE Web Engraver',
  description: 'Control NEJE Master 2 laser engravers from the browser over USB (Web Serial). Free, open source, works offline.',
  applicationName: 'NEJE Web Engraver',
  manifest: `${basePath}/manifest.webmanifest`,
  icons: { icon: `${basePath}/icon.svg`, apple: `${basePath}/icon-192.png` },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#181b21' },
  ],
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    // English is rendered statically; I18nProvider updates `lang` to the active locale.
    <html lang="en">
      <body>
        <I18nProvider>{children}</I18nProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
