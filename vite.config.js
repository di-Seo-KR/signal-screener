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
    // 청크 분리: 변경이 잦은 앱 코드와 거의 변하지 않는 외부 라이브러리를
    // 별도 청크로 두어 재방문 시 vendor 캐시를 그대로 재사용
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'chart-vendor': ['lightweight-charts', 'recharts'],
          'supabase-vendor': ['@supabase/supabase-js', '@vercel/kv'],
          'ui-vendor': ['lucide-react', 'sonner', 'class-variance-authority', 'tailwind-merge', 'clsx'],
          'strategies': ['./src/strategies.js'],
        },
      },
    },
    // 청크 크기 경고 임계값 상향 (전략/차트 모듈은 본질적으로 큼)
    chunkSizeWarningLimit: 800,
  },
})
