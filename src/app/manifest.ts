import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'NEJE Web Engraver',
    short_name: 'NEJE',
    description: 'Control NEJE Master 2 laser engravers from the browser. Works offline.',
    id: `${basePath}/`,
    start_url: `${basePath}/`,
    scope: `${basePath}/`,
    display: 'standalone',
    background_color: '#181b21',
    theme_color: '#181b21',
    icons: [
      { src: `${basePath}/icon.svg`, sizes: 'any', type: 'image/svg+xml' },
      { src: `${basePath}/icon-192.png`, sizes: '192x192', type: 'image/png' },
      { src: `${basePath}/icon-512.png`, sizes: '512x512', type: 'image/png' },
      { src: `${basePath}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
