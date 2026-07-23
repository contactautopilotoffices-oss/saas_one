import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow localtunnel domains in dev
  allowedDevOrigins: ['*.loca.lt', '192.168.0.224:3000', '192.168.0.224'],

  // Optimized standalone output for Vercel deployment
  // output: 'standalone',

  // Enforce strict TypeScript checks in production builds
  typescript: { ignoreBuildErrors: false },

  // Disable x-powered-by header for security
  poweredByHeader: false,

  // React strict mode for catching potential problems
  reactStrictMode: true,

  // Silence Turbopack warning in dev (serwist adds a webpack config)
  turbopack: {},

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'xvucakstcmtfoanmgcql.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },

  // Security headers (additional to middleware)
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
        ],
      },
    ];
  },
};

export default nextConfig;
