/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  async rewrites() {
    return [];
  },
  serverExternalPackages: [],
};

export default nextConfig;
