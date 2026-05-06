/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ['google-auth-library'],
    // Increase body size limit for App Router route handlers (PDF uploads up to 30 MB)
    serverActions: { bodySizeLimit: '30mb' },
  },
};
module.exports = nextConfig;
