'use client';

import { useEffect } from 'react';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * Registers the offline service worker (production builds only) and hands it the assets this
 * page already loaded, so the very first visit is enough to work offline afterwards.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register(`${basePath}/sw.js?v=${process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev'}`, { scope: `${basePath}/` })
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => {
        const urls = performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .filter((url) => url.startsWith(location.origin));
        registration.active?.postMessage({ type: 'warm', urls: [location.href, ...urls] });
      })
      .catch((error: unknown) => console.warn('Offline mode unavailable:', error));
  }, []);
  return null;
}
