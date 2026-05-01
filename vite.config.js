import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {}
  },
  build: {
    // 코드 스플리팅은 App.jsx 의 React.lazy 가 알아서 별도 청크로 분리합니다.
    // manualChunks 로 react/react-dom 을 분리하면 lucide-react·radix-ui 등이
    // 자체 React 를 import 하면서 인스턴스가 이중화되어 invalid hook call →
    // white screen 이 발생하는 함정이 있어, vendor 강제 분리는 사용하지 않습니다.
    chunkSizeWarningLimit: 1200,
  },
})
