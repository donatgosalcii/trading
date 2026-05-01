import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const optionsChainProxy = {
  target: 'https://www.gosalci.com',
  changeOrigin: true,
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    allowedHosts: true,
    proxy: {
      '/api/options-chain': optionsChainProxy,
    },
  },
  preview: {
    proxy: {
      '/api/options-chain': optionsChainProxy,
    },
  },
})
