/** @type {import('next').NextConfig} */

const nextConfig = {
  reactStrictMode: true,
  i18n: {
    locales: ['en', 'de'],
    defaultLocale: 'en',
    localeDetection: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '8082',
        pathname: '/media/public/**',
      },
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
        pathname: '/v0/b/**',
      },
    ],
  },
  webpack: (config, { isServer }) => {
    // Fixes npm packages that depend on `node:` protocol
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        assert: 'assert',
        buffer: 'buffer',
        crypto: 'crypto-browserify',
        stream: 'stream-browserify',
        util: 'util',
      };
    }
    return config;
  },
};

export default nextConfig;
