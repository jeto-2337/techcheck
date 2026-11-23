import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
      },
      manifest: {
        name: 'TechCheck',
        short_name: 'TechCheck',
        theme_color: '#0f172a',
        background_color: '#020617',
        display: 'standalone',
      },
    }),react(), tailwindcss()],
})
