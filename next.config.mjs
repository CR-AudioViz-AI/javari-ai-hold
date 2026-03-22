/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: true },
  experimental: {
    optimizePackageImports: ['lucide-react'],
    serverActions: { bodySizeLimit: '2mb' },
  },
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },

  // Allow javariai.com to be embedded in craudiovizai.com via iframe.
  // Uses CSP frame-ancestors (modern standard, applied to all routes).
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key:   'Content-Security-Policy',
            value: "frame-ancestors 'self' https://craudiovizai.com https://www.craudiovizai.com;",
          },
        ],
      },
    ]
  },
};
export default nextConfig;
