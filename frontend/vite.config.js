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
    },
  },
})

