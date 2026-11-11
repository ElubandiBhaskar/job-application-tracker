import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev the React app talks to /api and Vite forwards it to Django,
// so there are no CORS headaches while developing.
const apiTarget = process.env.VITE_PROXY_TARGET || 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': apiTarget } },
  preview: { port: 4173, proxy: { '/api': apiTarget } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    css: false,
  },
})
