import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  preview: {
    host: '0.0.0.0',
    port: parseInt(process.env.PORT) || 4173,
    strictPort: false,
    allowedHosts: 'all',
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
