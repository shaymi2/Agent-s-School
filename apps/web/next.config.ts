import type { NextConfig } from 'next';

const config: NextConfig = {
  // The engine ships as TypeScript source with no build step, so Next compiles
  // it as part of the app. It stays a separate package: the web layer only
  // ever talks to its public exports.
  transpilePackages: ['@gym/engine'],
};

export default config;
