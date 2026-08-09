import autoRouter from '@onoxm/vite-plugin-auto-router'
import react from '@vitejs/plugin-react'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import Unocss from 'unocss/vite'
import { defineConfig } from 'vite'

const execAsync = promisify(exec)

const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react(),
    Unocss(),
    autoRouter({
      lazy: false,
      onGenerated: filePaths => {
        for (const filePath of filePaths) {
          try {
            execAsync(`npx oxfmt "${filePath}"`)
            console.log(`Formatted: ${filePath}`)
          } catch (error) {
            console.warn(`Failed to format: ${filePath}`)
          }
        }
      }
    })
  ],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**']
    }
  },
  resolve: {
    alias: {
      '@': '/src'
    }
  }
}))
