/** @type {import('next').NextConfig} */
const nextConfig = {
  // Overridable so `npm run verify` (root) can compile into an isolated dir
  // instead of the live .next — mixing `next build` output into a running dev
  // server's .next corrupts Turbopack's chunk manifest (serves font-only CSS).
  distDir: process.env.NEXT_DIST_DIR || '.next',

  // Silence the multi-lockfile root-inference warning (root has its own package-lock)
  turbopack: {
    root: import.meta.dirname,
  },

  // Proxy all /api/* requests to the backend (internal only, port 6800)
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://127.0.0.1:6800/api/:path*',
      },
      {
        source: '/screenshots/:path*',
        destination: 'http://127.0.0.1:6800/screenshots/:path*',
      },
    ];
  },
};

export default nextConfig;
