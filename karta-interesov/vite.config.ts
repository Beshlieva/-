import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// Конфигурация для локальной разработки и production-сборки.
// (В исходнике из Figma Make здесь были служебные плагины Figma и порт 8443 —
// они нужны только внутри Figma и вне её не работают.)
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173, // npm run dev      -> http://localhost:5173
  },
  preview: {
    port: 4173, // npm run preview  -> http://localhost:4173
  },
})
