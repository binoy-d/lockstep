import { defineConfig } from 'vite';

const apiProxyTarget = process.env.VITE_PROXY_TARGET ?? 'http://localhost:8787';

export default defineConfig({
  server: {
    // Required when serving behind Cloudflare on a custom hostname.
    allowedHosts: true,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
  preview: {
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
});
