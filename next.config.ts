import type { NextConfig } from 'next';

// Static export: the app has no server side, so it can be hosted anywhere (Vercel, GitHub Pages,
// any static host) and runs offline. Set NEXT_PUBLIC_BASE_PATH when serving from a sub-path.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
// Versions the offline cache; Vercel provides the commit, elsewhere the build time is unique enough.
const buildId = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? Date.now().toString(36);

const nextConfig: NextConfig = {
  output: 'export',
  basePath,
  trailingSlash: true,
  reactStrictMode: true,
  poweredByHeader: false,
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
};

export default nextConfig;
