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

  /**
   * NATIVE MODULES THE BUNDLER MUST NOT TOUCH.
   *
   * @napi-rs/canvas ships a compiled .node binary. Webpack tried to parse it as
   * JavaScript and the production build failed outright:
   *
   *     Module parse failed: Unexpected character '�' (1:0)
   *     ./node_modules/@napi-rs/canvas-darwin-arm64/skia.darwin-arm64.node
   *
   * Listing it here leaves it as a runtime require in the server bundle, which
   * is the only way a platform-specific binary can work — the right one is
   * resolved on the machine that runs it, not baked in at build time.
   *
   * pdfjs-dist is here for the same reason it is everywhere else: it reaches
   * for canvas and worker files that a bundler mangles.
   *
   * Reached from backend/lib/ocr/rasterize.ts, which turns a scanned PDF into
   * page images for OCR.
   */
  serverExternalPackages: ['@napi-rs/canvas', 'pdfjs-dist'],

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'xvucakstcmtfoanmgcql.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        port: '',
        pathname: '/**',
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
