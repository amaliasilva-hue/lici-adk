/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  experimental: { serverComponentsExternalPackages: ['google-auth-library'] },
};
module.exports = nextConfig;
