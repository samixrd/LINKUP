import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const RENDER_URL = 'https://linkup-api-e2qb.onrender.com'

export default defineConfig(({ command }) => ({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  // In production builds, VITE_API_URL is the Render backend URL.
  // Falls back to RENDER_URL if env var is empty/missing.
  define:
    command === 'build'
      ? { __API_BASE__: JSON.stringify(process.env.VITE_API_URL || RENDER_URL) }
      : { __API_BASE__: JSON.stringify('') },
}))


