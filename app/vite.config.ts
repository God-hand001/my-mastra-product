import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发期把对话流(/chat)与后端 REST(/api)代理到 Mastra server,
// 前端不直接处理 CORS(plan N5:前后端仅通过 HTTP 接口交互)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/chat': 'http://localhost:4111',
      '/api': 'http://localhost:4111',
    },
  },
});
