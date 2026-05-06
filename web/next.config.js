/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ['google-auth-library'],
    // Allow large PDF uploads (up to 200 MB)
    serverActions: { bodySizeLimit: '200mb' },
  },
};
module.exports = nextConfig;
