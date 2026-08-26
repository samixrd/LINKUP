import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => ({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  // In production builds, VITE_API_URL is the Railway backend URL.
  // Set it in Vercel: VITE_API_URL=https://your-app.railway.app
  define:
    command === 'build'
      ? { __API_BASE__: JSON.stringify(process.env.VITE_API_URL ?? '') }
      : { __API_BASE__: JSON.stringify('') },
}))

