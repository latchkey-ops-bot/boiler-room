import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages export TypeScript source.
  transpilePackages: ['@boiler-room/schema'],
  poweredByHeader: false,
  // `next dev` would otherwise write apps/web/AGENTS.md whenever an AI agent runs it, leaving the
  // tree dirty, and `pnpm web:deploy:*` deploys only a clean tree. The repo's own agent rules live
  // in CLAUDE.md and skills/.
  agentRules: false,
  // Inlined at build time. The deploy script sets BR_BUILD_SHA to the commit it builds.
  env: {
    BR_BUILD_SHA: process.env.BR_BUILD_SHA ?? 'dev',
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: '/sign-in',
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: '/sign-up',
    NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: '/films',
    NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: '/films',
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;

// Gives `next dev` the D1 and R2 bindings from wrangler.jsonc, kept in .wrangler/state.
initOpenNextCloudflareForDev();
