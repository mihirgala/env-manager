import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

// NOTE: `test` is read by vitest at runtime (vitest bundles its own Vite to
// run unit tests). It is deliberately kept out of the object literal passed
// to `defineConfig` so `tsc` validates against this project's Vite 8 types.
const config = {
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      // libsodium-wrappers-sumo@0.7.16 ships a broken ESM wrapper (it does
      // `import "./libsodium-sumo.mjs"`, a file missing from its own dist).
      // Alias to the working CJS build; Vite pre-bundles it for the browser.
      'libsodium-wrappers-sumo': path.resolve(
        import.meta.dirname,
        './node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js',
      ),
    },
  },
  // Tauri: fixed port + strictPort so `tauri dev` can find Vite reliably.
  server: {
    port: 1420,
    strictPort: true,
  },
  test: {
    include: ['src/**/*.{test,spec}.ts', 'src/**/*.{test,spec}.tsx'],
  },
}

// https://vite.dev/config/
export default defineConfig(config)
