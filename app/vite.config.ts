import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [inspectAttr(), react()],
  server: {
    port: 3000,
    proxy: {
      // 开发环境代理到 Pixellab API，绕开浏览器 CORS
      // 前端请求 /pixellab/generate-image-pixflux → https://api.pixellab.ai/v1/generate-image-pixflux
      '/pixellab': {
        target: 'https://api.pixellab.ai',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/pixellab/, '/v1'),
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
