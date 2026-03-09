import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // 로컬 개발 시 /api/* 요청을 Vercel 함수처럼 동작하도록 설정
    // (로컬에서는 실제 Yahoo/CoinGecko를 직접 호출)
    proxy: {}
  }
})
