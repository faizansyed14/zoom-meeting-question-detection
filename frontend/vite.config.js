import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  envDir: '..',
  plugins: [react()],
  server: {
    proxy: {
      '/transcribe': {
        target: 'ws://localhost:3001',
        ws: true,
      },
      '/watch': {
        target: 'ws://localhost:3001',
        ws: true,
      },
      '/auth': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/sync': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})

