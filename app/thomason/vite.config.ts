import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

const root = resolve(import.meta.dirname)

export default defineConfig({
  root,
  plugins: [tailwindcss(), svelte()],
  server: {
    port: 5173,
  },
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      $lib: resolve(root, 'src/lib'),
      'family-chart': resolve(root, '../../src/index.ts'),
    },
  },
})
