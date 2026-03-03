import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { compression } from 'vite-plugin-compression2';

export default defineConfig({
  plugins: [
    sveltekit(),
    compression({ algorithms: ['gzip', 'brotliCompress'], exclude: [/\.(br|gz)$/] }),
  ],
  build: {
    cssMinify: 'lightningcss',
    minify: 'esbuild',
    target: 'es2020',
  },
  esbuild: {
    drop: ['console', 'debugger'],
    legalComments: 'none',
  },
});
