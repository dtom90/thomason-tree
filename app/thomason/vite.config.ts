import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'path'

const root = resolve(import.meta.dirname)

export default defineConfig({
  root,
  plugins: [svelte()],
  server: {
    port: 5173,
  },
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      'family-chart': resolve(root, '../../src/index.ts'),
    },
  },
})
