import { defineConfig } from 'wxt';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  manifest: {
    name: 'Polymarket BTC Execution Terminal',
    description: '5-Minute BTC execution terminal for Polymarket',
    version: '1.0.0',
    permissions: ['storage'],
    host_permissions: ['*://*.polymarket.com/*', '*://polymarket.com/*', 'http://localhost/*', 'ws://localhost/*']
  },
  vite: () => ({
    plugins: [react()],
    build: {
      sourcemap: false
    },
    resolve: {
      alias: {
        '@polymarket-btc/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts')
      }
    }
  }),
});
