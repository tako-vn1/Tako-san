import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync, writeFileSync } from 'node:fs';

const appVersion = process.env.npm_package_version || '0.1.0';
const buildCommit = process.env.GIT_COMMIT || process.env.VITE_GIT_COMMIT || 'local';
const buildTimestamp = process.env.BUILD_TIMESTAMP || new Date().toISOString();
const testExecArgv = Number(process.versions.node.split('.')[0]) >= 25
  ? ['--no-experimental-webstorage']
  : [];

function injectServiceWorkerBuildId() {
  return {
    name: 'inject-service-worker-build-id',
    closeBundle() {
      const serviceWorkerPath = path.resolve(__dirname, 'dist/client/sw.js');
      const source = readFileSync(serviceWorkerPath, 'utf8');
      const output = source.replaceAll('__TAKOSAN_BUILD_ID__', buildCommit);
      if (output === source) throw new Error('Service Worker build token was not found');
      writeFileSync(serviceWorkerPath, output);
    },
  };
}

// Records the value Vite actually compiled into the UI (outside the served assets directory)
// so the release guard can prove it matches the Worker var.
function recordCompositionFlag(): Plugin {
  let compiled: string | null = null;
  return {
    name: 'record-composition-flag',
    apply: 'build',
    configResolved(config) {
      compiled = config.env.VITE_MEAL_COMPOSITION_V2_ENABLED ?? null;
    },
    closeBundle() {
      writeFileSync(
        path.resolve(__dirname, 'dist/composition-flags.json'),
        `${JSON.stringify({ VITE_MEAL_COMPOSITION_V2_ENABLED: compiled })}\n`,
      );
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), injectServiceWorkerBuildId(), recordCompositionFlag()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
    'import.meta.env.VITE_GIT_COMMIT': JSON.stringify(buildCommit),
    'import.meta.env.VITE_BUILD_TIMESTAMP': JSON.stringify(buildTimestamp),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/web'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@packages': path.resolve(__dirname, './packages'),
      '@frigo/domain': path.resolve(__dirname, './packages/domain/src/index.ts'),
      '@frigo/recipes': path.resolve(__dirname, './packages/recipes/src/index.ts'),
      '@frigo/ai': path.resolve(__dirname, './packages/ai/src/index.ts'),
      '@frigo/db': path.resolve(__dirname, './packages/db/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://127.0.0.1:8787',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist/client',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query', 'zustand'],
          'vendor-icons': ['lucide-react'],
        },
      },
    },
  },
  test: {
    setupFiles: ['tests/helpers/vitest-event-loop-yield.ts'],
    poolOptions: {
      threads: { execArgv: testExecArgv },
      forks: { execArgv: testExecArgv },
    },
  },
});
