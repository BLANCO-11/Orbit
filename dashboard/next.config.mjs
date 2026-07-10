/** @type {import('next').NextConfig} */
const nextConfig = {
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
