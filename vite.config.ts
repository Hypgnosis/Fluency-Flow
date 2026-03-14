import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  // loadEnv reads from .env files; process.env has Netlify/system env vars
  const fileEnv = loadEnv(mode, '.', '');

  // Helper: check .env file first, then fall back to system/Netlify env vars
  const getEnv = (key: string) => fileEnv[key] || process.env[key] || '';

  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.API_KEY': JSON.stringify(getEnv('GEMINI_API_KEY')),
      'process.env.GEMINI_API_KEY': JSON.stringify(getEnv('GEMINI_API_KEY')),
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
    }
  };
});
