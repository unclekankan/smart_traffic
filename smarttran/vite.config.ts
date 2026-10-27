import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import vueDevTools from 'vite-plugin-vue-devtools'
import { viteStaticCopy } from 'vite-plugin-static-copy'

/**
 * Cesium 静态资源（Workers / Assets / Widgets / ThirdParty）无法被打包器直接处理，
 * 按官方推荐方式复制到构建产物中，并通过 define 注入 CESIUM_BASE_URL 供运行时定位。
 */
const cesiumBuild = 'node_modules/cesium/Build/Cesium'
const cesiumBaseUrl = 'cesium'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueJsx(),
    vueDevTools(),
    viteStaticCopy({
      targets: [
        { src: `${cesiumBuild}/ThirdParty`, dest: cesiumBaseUrl },
        { src: `${cesiumBuild}/Workers`, dest: cesiumBaseUrl },
        { src: `${cesiumBuild}/Assets`, dest: cesiumBaseUrl },
        { src: `${cesiumBuild}/Widgets`, dest: cesiumBaseUrl },
      ],
    }),
  ],
  server: {
    proxy: {
      // 前端 /api/* 代理到 FastAPI 后端（后端路由已挂载在 /api 前缀下，透传不 rewrite）
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  define: {
    CESIUM_BASE_URL: JSON.stringify(`/${cesiumBaseUrl}`),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Cesium 体积巨大，单独分包避免主包体积告警
        manualChunks: {
          cesium: ['cesium'],
          openlayers: ['ol'],
        },
      },
    },
    chunkSizeWarningLimit: 4096,
  },
})
