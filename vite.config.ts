import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { forbidSecretsInBundle } from './vite-plugins/forbidSecrets';

export default defineConfig(({ mode, command }) => {
  // loadEnv reads from .env files; process.env has Netlify/system env vars
  const fileEnv = loadEnv(mode, '.', '');

  // Helper: check .env file first, then fall back to system/Netlify env vars
  const getEnv = (key: string) => fileEnv[key] || process.env[key] || '';

  // The Gemini key is only ever exposed to the local dev server (`npm run dev`), where the app
  // talks to Gemini directly. Production builds call the Netlify Functions in netlify/functions,
  // which hold the key server-side, and the build fails if the key leaks into the output.
  const geminiKey = getEnv('GEMINI_API_KEY');
  const devOnlyGeminiKey = command === 'serve' ? geminiKey : '';

  return {
    server: {
      port: 3001,
      host: '0.0.0.0',
    },
    plugins: [react(), tailwindcss(), forbidSecretsInBundle({ GEMINI_API_KEY: geminiKey })],
    define: {
      'process.env.VITE_WS_PROXY_URL': JSON.stringify(getEnv('VITE_WS_PROXY_URL')),
      'process.env.API_KEY': JSON.stringify(devOnlyGeminiKey),
      'process.env.GEMINI_API_KEY': JSON.stringify(devOnlyGeminiKey),
      // Optional model overrides for Lens Teacher and other non-Live features
      'process.env.GEMINI_TEXT_MODEL': JSON.stringify(getEnv('GEMINI_TEXT_MODEL')),
      'process.env.GEMINI_FAST_MODEL': JSON.stringify(getEnv('GEMINI_FAST_MODEL')),
      'process.env.FIREBASE_API_KEY': JSON.stringify(getEnv('FIREBASE_API_KEY')),
      'process.env.FIREBASE_AUTH_DOMAIN': JSON.stringify(getEnv('FIREBASE_AUTH_DOMAIN')),
      'process.env.FIREBASE_PROJECT_ID': JSON.stringify(getEnv('FIREBASE_PROJECT_ID')),
      'process.env.FIREBASE_STORAGE_BUCKET': JSON.stringify(getEnv('FIREBASE_STORAGE_BUCKET')),
      'process.env.FIREBASE_MESSAGING_SENDER_ID': JSON.stringify(getEnv('FIREBASE_MESSAGING_SENDER_ID')),
      'process.env.FIREBASE_APP_ID': JSON.stringify(getEnv('FIREBASE_APP_ID')),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    // ─── VITEST CONFIGURATION ───
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      include: ['./tests/**/*.test.{ts,tsx}'],
      coverage: {
        provider: 'v8',
        include: ['components/**', 'services/**', 'utils/**'],
        thresholds: {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
      },
    },
  };
});
